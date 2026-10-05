import { Prisma } from "@prisma/client";

export function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

export function toNumber(
  value: Prisma.Decimal | number | null | undefined,
): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value.toString());
}
