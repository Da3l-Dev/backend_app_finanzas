import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "No autorizado." },
        { status: 401 },
      );
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // domingo
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    // ─── 1. Cuentas ──────────────────────────────
    const accounts = await prisma.account.findMany({
      where: { userId: user.id, archivedAt: null },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        type: true,
        currency: true,
        openingBalance: true,
        creditLimit: true,
        color: true,
        icon: true,
        isDefault: true,
      },
    });

    // ─── 2. Transacciones del mes en curso ───────
    const monthTransactions = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        voidedAt: null,
        occurredAt: { gte: startOfMonth, lt: startOfNextMonth },
      },
      select: {
        id: true,
        type: true,
        amount: true,
        occurredAt: true,
        categoryId: true,
        sourceAccountId: true,
      },
    });

    let monthlyIncome = 0;
    let monthlyExpense = 0;
    const byCategoryMap = new Map<string, { total: number; count: number }>();

    for (const t of monthTransactions) {
      const amt = Number(t.amount);
      if (t.type === "INCOME") monthlyIncome += amt;
      if (t.type === "EXPENSE") {
        monthlyExpense += amt;
        if (t.categoryId) {
          const prev = byCategoryMap.get(t.categoryId) ?? {
            total: 0,
            count: 0,
          };
          byCategoryMap.set(t.categoryId, {
            total: prev.total + amt,
            count: prev.count + 1,
          });
        }
      }
    }

    // ─── 3. Total por cuenta (balance real) ──────
    // Suma ingresos - gastos por cuenta para calcular el saldo actual.
    const allTransactionsForBalance = await prisma.transaction.findMany({
      where: { userId: user.id, voidedAt: null },
      select: {
        type: true,
        amount: true,
        sourceAccountId: true,
        targetAccountId: true,
      },
    });

    const accountBalanceMap = new Map<string, number>();
    for (const a of accounts) {
      accountBalanceMap.set(a.id, Number(a.openingBalance));
    }

    for (const t of allTransactionsForBalance) {
      const amt = Number(t.amount);
      const src = t.sourceAccountId;
      const dst = t.targetAccountId;

      if (t.type === "EXPENSE" && src) {
        accountBalanceMap.set(src, (accountBalanceMap.get(src) ?? 0) - amt);
      } else if (t.type === "INCOME" && src) {
        accountBalanceMap.set(src, (accountBalanceMap.get(src) ?? 0) + amt);
      } else if (t.type === "TRANSFER") {
        if (src)
          accountBalanceMap.set(src, (accountBalanceMap.get(src) ?? 0) - amt);
        if (dst)
          accountBalanceMap.set(dst, (accountBalanceMap.get(dst) ?? 0) + amt);
      } else if (t.type === "CREDIT_CARD_PAYMENT") {
        // Sale de source, entra a target (la tarjeta)
        if (src)
          accountBalanceMap.set(src, (accountBalanceMap.get(src) ?? 0) - amt);
        if (dst)
          accountBalanceMap.set(dst, (accountBalanceMap.get(dst) ?? 0) + amt);
      }
    }

    const accountsWithBalance = accounts.map((a) => ({
      ...a,
      openingBalance: Number(a.openingBalance),
      creditLimit: a.creditLimit ? Number(a.creditLimit) : null,
      currentBalance: accountBalanceMap.get(a.id) ?? Number(a.openingBalance),
    }));

    // Total: sumamos assets, restamos deuda de tarjetas de crédito
    const totalBalance = accountsWithBalance.reduce((sum, a) => {
      if (a.type === "CREDIT_CARD") {
        // Saldo negativo en tarjeta = deuda
        return sum + Math.min(0, a.currentBalance);
      }
      return sum + a.currentBalance;
    }, 0);

    // ─── 4. Top categorías de gasto del mes ──────
    const categoryIds = [...byCategoryMap.keys()];
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true, color: true, icon: true },
    });
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    const spendingByCategory = [...byCategoryMap.entries()]
      .map(([catId, data]) => ({
        categoryId: catId,
        name: categoryMap.get(catId)?.name ?? "Sin categoría",
        color: categoryMap.get(catId)?.color ?? null,
        icon: categoryMap.get(catId)?.icon ?? null,
        total: data.total,
        count: data.count,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // ─── 5. Últimas transacciones ─────────────────
    const recentTransactions = await prisma.transaction.findMany({
      where: { userId: user.id, voidedAt: null },
      orderBy: { occurredAt: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        amount: true,
        occurredAt: true,
        description: true,
        category: { select: { id: true, name: true, color: true, icon: true } },
        sourceAccount: { select: { id: true, name: true } },
      },
    });

    // ─── 6. Comparación con semana anterior ──────
    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfWeek.getDate() - 7);

    const weekTx = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        voidedAt: null,
        type: "EXPENSE",
        occurredAt: { gte: startOfLastWeek, lt: startOfNextMonth },
      },
      select: { amount: true, occurredAt: true },
    });

    let thisWeekSpent = 0;
    let lastWeekSpent = 0;
    for (const t of weekTx) {
      const amt = Number(t.amount);
      if (t.occurredAt >= startOfWeek) thisWeekSpent += amt;
      else lastWeekSpent += amt;
    }

    const weekDelta =
      lastWeekSpent > 0
        ? ((thisWeekSpent - lastWeekSpent) / lastWeekSpent) * 100
        : null;

    // ─── 7. Gasto de hoy ─────────────────────────
    const todaySpent = monthTransactions
      .filter(
        (t) =>
          t.type === "EXPENSE" &&
          t.occurredAt >= startOfToday &&
          t.occurredAt < startOfNextMonth,
      )
      .reduce((sum, t) => sum + Number(t.amount), 0);

    return NextResponse.json({
      success: true,
      data: {
        totalBalance,
        monthlyIncome,
        monthlyExpense,
        monthlyNet: monthlyIncome - monthlyExpense,
        todaySpent,
        thisWeekSpent,
        lastWeekSpent,
        weekDelta,
        accounts: accountsWithBalance,
        spendingByCategory,
        recentTransactions: recentTransactions.map((t) => ({
          ...t,
          amount: Number(t.amount),
        })),
      },
    });
  } catch (error) {
    console.error("Error en dashboard summary:", error);
    return NextResponse.json(
      { success: false, message: "No se pudo cargar el resumen." },
      { status: 500 },
    );
  }
}
