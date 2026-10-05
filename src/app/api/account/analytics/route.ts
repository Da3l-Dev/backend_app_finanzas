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

    // ─── 1. Cuentas ─────────────────────────────
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

    if (accounts.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          totalBalance: 0,
          accounts: [],
          monthlySpending: [],
          totals: {
            monthSpent: 0,
            monthIncome: 0,
            monthCount: 0,
            avgPerTx: 0,
          },
          topSpendingAccountId: null,
        },
      });
    }

    // ─── 2. Últimos 6 meses (rangos) ────────────
    const months: Array<{
      year: number;
      month: number;
      label: string;
      start: Date;
      end: Date;
    }> = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      months.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        label: start.toLocaleDateString("es-MX", { month: "short" }),
        start,
        end,
      });
    }

    const startOfWindow = months[0].start;
    const endOfWindow = months[months.length - 1].end;

    // ─── 3. Transacciones en la ventana ─────────
    const tx = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        voidedAt: null,
        occurredAt: { gte: startOfWindow, lt: endOfWindow },
      },
      select: {
        id: true,
        type: true,
        amount: true,
        occurredAt: true,
        sourceAccountId: true,
        targetAccountId: true,
      },
    });

    // Todas las transacciones históricas para calcular balance real
    const allTx = await prisma.transaction.findMany({
      where: { userId: user.id, voidedAt: null },
      select: {
        type: true,
        amount: true,
        sourceAccountId: true,
        targetAccountId: true,
      },
    });

    // ─── 4. Balance actual por cuenta ───────────
    const balanceMap = new Map<string, number>();
    for (const a of accounts) {
      balanceMap.set(a.id, Number(a.openingBalance));
    }

    for (const t of allTx) {
      const amt = Number(t.amount);
      if (t.type === "EXPENSE" && t.sourceAccountId) {
        balanceMap.set(
          t.sourceAccountId,
          (balanceMap.get(t.sourceAccountId) ?? 0) - amt,
        );
      } else if (t.type === "INCOME" && t.sourceAccountId) {
        balanceMap.set(
          t.sourceAccountId,
          (balanceMap.get(t.sourceAccountId) ?? 0) + amt,
        );
      } else if (
        (t.type === "TRANSFER" || t.type === "CREDIT_CARD_PAYMENT") &&
        t.sourceAccountId &&
        t.targetAccountId
      ) {
        balanceMap.set(
          t.sourceAccountId,
          (balanceMap.get(t.sourceAccountId) ?? 0) - amt,
        );
        balanceMap.set(
          t.targetAccountId,
          (balanceMap.get(t.targetAccountId) ?? 0) + amt,
        );
      }
    }

    // ─── 5. Métricas por cuenta ─────────────────
    type AccountMetric = {
      id: string;
      name: string;
      type: string;
      currency: string;
      color: string | null;
      icon: string | null;
      isDefault: boolean;
      currentBalance: number;
      creditLimit: number | null;
      creditUsedPct: number | null;

      // Últimos 6 meses
      spent6m: number;
      income6m: number;
      txCount6m: number;
      avgTx: number;
      monthlyAvg: number;
      lastUsedAt: string | null;

      // Este mes
      monthSpent: number;
      monthIncome: number;
      monthCount: number;
    };

    const metricsMap = new Map<string, AccountMetric>();
    for (const a of accounts) {
      metricsMap.set(a.id, {
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        color: a.color,
        icon: a.icon,
        isDefault: a.isDefault,
        currentBalance: balanceMap.get(a.id) ?? Number(a.openingBalance),
        creditLimit: a.creditLimit ? Number(a.creditLimit) : null,
        creditUsedPct: null,
        spent6m: 0,
        income6m: 0,
        txCount6m: 0,
        avgTx: 0,
        monthlyAvg: 0,
        lastUsedAt: null,
        monthSpent: 0,
        monthIncome: 0,
        monthCount: 0,
      });
    }

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Agrupado mensual (total del usuario)
    const monthlyTotals = new Map<
      string,
      { spent: number; income: number; count: number }
    >();
    for (const m of months) {
      monthlyTotals.set(`${m.year}-${m.month}`, {
        spent: 0,
        income: 0,
        count: 0,
      });
    }

    let monthSpentTotal = 0;
    let monthIncomeTotal = 0;
    let monthCountTotal = 0;

    for (const t of tx) {
      const amt = Number(t.amount);
      const key = `${t.occurredAt.getFullYear()}-${t.occurredAt.getMonth()}`;
      const bucket = monthlyTotals.get(key);

      // Cuenta origen (donde sale el dinero en gastos y transferencias)
      if (t.sourceAccountId) {
        const metric = metricsMap.get(t.sourceAccountId);
        if (metric) {
          if (t.type === "EXPENSE") {
            metric.spent6m += amt;
            metric.txCount6m += 1;
          } else if (t.type === "INCOME") {
            metric.income6m += amt;
          }
          if (
            !metric.lastUsedAt ||
            t.occurredAt > new Date(metric.lastUsedAt)
          ) {
            metric.lastUsedAt = t.occurredAt.toISOString();
          }
          if (t.occurredAt >= startOfMonth) {
            metric.monthCount += 1;
            if (t.type === "EXPENSE") metric.monthSpent += amt;
            if (t.type === "INCOME") metric.monthIncome += amt;
          }
        }
      }

      // Cuenta destino (donde entra el dinero)
      if (t.targetAccountId) {
        const metric = metricsMap.get(t.targetAccountId);
        if (metric && t.type === "INCOME") {
          metric.income6m += amt;
          metric.txCount6m += 1;
          if (
            !metric.lastUsedAt ||
            t.occurredAt > new Date(metric.lastUsedAt)
          ) {
            metric.lastUsedAt = t.occurredAt.toISOString();
          }
          if (t.occurredAt >= startOfMonth) {
            metric.monthCount += 1;
            metric.monthIncome += amt;
          }
        }
      }

      // Totales mensuales
      if (bucket) {
        if (t.type === "EXPENSE") {
          bucket.spent += amt;
          bucket.count += 1;
        }
        if (t.type === "INCOME") bucket.income += amt;
      }

      if (t.occurredAt >= startOfMonth) {
        if (t.type === "EXPENSE") {
          monthSpentTotal += amt;
          monthCountTotal += 1;
        }
        if (t.type === "INCOME") monthIncomeTotal += amt;
      }
    }

    // Calcular derivados
    for (const m of metricsMap.values()) {
      m.avgTx = m.txCount6m > 0 ? m.spent6m / m.txCount6m : 0;
      m.monthlyAvg = m.spent6m / 6;
      if (m.type === "CREDIT_CARD" && m.creditLimit && m.creditLimit > 0) {
        const used = Math.abs(Math.min(0, m.currentBalance));
        m.creditUsedPct = Math.min(100, (used / m.creditLimit) * 100);
      }
    }

    const accountMetrics = [...metricsMap.values()].sort(
      (a, b) => b.spent6m - a.spent6m,
    );

    const topSpendingAccountId =
      accountMetrics[0]?.spent6m > 0 ? accountMetrics[0].id : null;

    // Balance total (con tarjetas restando)
    const totalBalance = accountMetrics.reduce((sum, a) => {
      if (a.type === "CREDIT_CARD") return sum + Math.min(0, a.currentBalance);
      return sum + a.currentBalance;
    }, 0);

    const monthlySpending = months.map((m) => {
      const bucket = monthlyTotals.get(`${m.year}-${m.month}`)!;
      return {
        year: m.year,
        month: m.month,
        label: m.label,
        spent: bucket.spent,
        income: bucket.income,
        count: bucket.count,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        totalBalance,
        accounts: accountMetrics,
        monthlySpending,
        totals: {
          monthSpent: monthSpentTotal,
          monthIncome: monthIncomeTotal,
          monthCount: monthCountTotal,
          avgPerTx: monthCountTotal > 0 ? monthSpentTotal / monthCountTotal : 0,
        },
        topSpendingAccountId,
      },
    });
  } catch (error) {
    console.error("Error en accounts analytics:", error);
    return NextResponse.json(
      { success: false, message: "No se pudo cargar el análisis." },
      { status: 500 },
    );
  }
}
