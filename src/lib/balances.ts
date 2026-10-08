import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type InitialAccount = { id: string; openingBalance: Prisma.Decimal | number };
// Agrupar en PostgreSQL evita cargar todo el historial de movimientos a Node.
export async function getAccountBalances(userId: string, accounts: InitialAccount[], excludeTransactionId?: string) {
  const balances = new Map<string, number>(accounts.map(a => [a.id, Number(a.openingBalance)]));
  if (!accounts.length) return balances;
  const totals = await prisma.transaction.groupBy({
    by: ["type", "sourceAccountId", "targetAccountId"],
    where: {
      userId, voidedAt: null, status: "POSTED",
      ...(excludeTransactionId ? { id: { not: excludeTransactionId } } : {}),
    },
    _sum: { amount: true },
  });
  for (const item of totals) {
    const value = Number(item._sum.amount ?? 0);
    const source = item.sourceAccountId;
    const target = item.targetAccountId;
    if (source && balances.has(source)) {
      const sign = item.type === "INCOME" ? 1 : item.type === "EXPENSE" || item.type === "TRANSFER" || item.type === "CREDIT_CARD_PAYMENT" ? -1 : 0;
      balances.set(source, (balances.get(source) ?? 0) + sign * value);
    }
    if (target && balances.has(target) && (item.type === "TRANSFER" || item.type === "CREDIT_CARD_PAYMENT")) {
      balances.set(target, (balances.get(target) ?? 0) + value);
    }
  }
  return balances;
}
