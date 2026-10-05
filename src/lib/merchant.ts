import { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

export function normalizeMerchantName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function getOrCreateMerchant(
  tx: Tx,
  userId: string,
  displayName: string,
) {
  const normalized = normalizeMerchantName(displayName);
  const existing = await tx.merchant.findFirst({
    where: { userId, normalizedName: normalized },
  });
  if (existing) return existing;
  return tx.merchant.create({
    data: {
      userId,
      name: displayName.trim(),
      normalizedName: normalized,
    },
  });
}
