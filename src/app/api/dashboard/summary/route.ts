import { getAccountBalances } from "@/lib/balances";
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
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfWeek.getDate() - 7);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

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

    // ─── 2. Agregados del mes en curso ───────────
    // Usamos groupBy en lugar de findMany + loop: más eficiente y menos
    // propenso a errores con Decimal.
    const monthAgg = await prisma.transaction.groupBy({
      by: ["type"],
      where: {
        userId: user.id,
        voidedAt: null,
        occurredAt: { gte: startOfMonth, lt: startOfNextMonth },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    let monthlyIncome = 0;
    let monthlyExpense = 0;
    let monthCount = 0;
    for (const agg of monthAgg) {
      const total = Number(agg._sum.amount ?? 0);
      monthCount += agg._count._all;
      if (agg.type === "INCOME") monthlyIncome = total;
      if (agg.type === "EXPENSE") monthlyExpense = total;
    }
    const monthlyNet = monthlyIncome - monthlyExpense;

    // ─── 3. Gastos por categoría del mes ─────────
    const categoryAgg = await prisma.transaction.groupBy({
      by: ["categoryId"],
      where: {
        userId: user.id,
        voidedAt: null,
        type: "EXPENSE",
        categoryId: { not: null },
        occurredAt: { gte: startOfMonth, lt: startOfNextMonth },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const categoryIds = categoryAgg
      .map((c) => c.categoryId)
      .filter((id): id is string => !!id);

    const categories = categoryIds.length
      ? await prisma.category.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true, color: true, icon: true },
        })
      : [];
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    const spendingByCategory = categoryAgg
      .map((agg) => {
        const cat = agg.categoryId ? categoryMap.get(agg.categoryId) : null;
        return {
          categoryId: agg.categoryId ?? "unknown",
          name: cat?.name ?? "Sin categoría",
          color: cat?.color ?? null,
          icon: cat?.icon ?? null,
          total: Number(agg._sum.amount ?? 0),
          count: agg._count._all,
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // ─── 4. Balance real por cuenta ──────────────
    const accountBalanceMap = await getAccountBalances(user.id, accounts);

    const accountsWithBalance = accounts.map((a) => ({
      ...a,
      openingBalance: Number(a.openingBalance),
      creditLimit: a.creditLimit ? Number(a.creditLimit) : null,
      currentBalance: accountBalanceMap.get(a.id) ?? Number(a.openingBalance),
    }));

    const totalBalance = accountsWithBalance.reduce((sum, a) => {
      if (a.type === "CREDIT_CARD") {
        return sum + Math.min(0, a.currentBalance);
      }
      return sum + a.currentBalance;
    }, 0);

    // ─── 5. Últimas transacciones ────────────────
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
        category: {
          select: { id: true, name: true, color: true, icon: true },
        },
        sourceAccount: { select: { id: true, name: true } },
      },
    });

    // ─── 6. Comparación de gasto semanal ─────────
    const weekAgg = await prisma.transaction.groupBy({
      by: ["type"],
      where: {
        userId: user.id,
        voidedAt: null,
        type: "EXPENSE",
        occurredAt: { gte: startOfLastWeek, lt: startOfWeek },
      },
      _sum: { amount: true },
    });
    const lastWeekSpent = Number(weekAgg[0]?._sum.amount ?? 0);

    const thisWeekAgg = await prisma.transaction.groupBy({
      by: ["type"],
      where: {
        userId: user.id,
        voidedAt: null,
        type: "EXPENSE",
        occurredAt: { gte: startOfWeek, lt: startOfNextMonth },
      },
      _sum: { amount: true },
    });
    const thisWeekSpent = Number(thisWeekAgg[0]?._sum.amount ?? 0);

    const weekDelta =
      lastWeekSpent > 0
        ? ((thisWeekSpent - lastWeekSpent) / lastWeekSpent) * 100
        : null;

    // ─── 7. Gasto de hoy ─────────────────────────
    const todayAgg = await prisma.transaction.groupBy({
      by: ["type"],
      where: {
        userId: user.id,
        voidedAt: null,
        type: "EXPENSE",
        occurredAt: { gte: startOfToday, lt: startOfTomorrow },
      },
      _sum: { amount: true },
    });
    const todaySpent = Number(todayAgg[0]?._sum.amount ?? 0);

    return NextResponse.json({
      success: true,
      data: {
        totalBalance,
        monthlyIncome,
        monthlyExpense,
        monthlyNet,
        monthCount,
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
