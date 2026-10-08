import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { toDecimal, toNumber } from "@/lib/money";
import { getAccountBalances } from "@/lib/balances";
import { fail, internal, invalid, ok } from "@/lib/api-response";

type RouteContext = { params: Promise<{ id: string }> };
const updateSchema = z.object({
  type: z.enum(["EXPENSE", "INCOME"]).optional(),
  amount: z.number().positive().max(999999999).optional(),
  categoryId: z.uuid().nullable().optional(),
  sourceAccountId: z.uuid().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  occurredAt: z.iso.datetime().optional(),
}).strict();
const transactionSelect = {
  id: true, userId: true, type: true, amount: true, occurredAt: true, description: true, notes: true,
  categoryId: true, sourceAccountId: true, targetAccountId: true,
  category: { select: { id: true, name: true, icon: true, color: true } },
  merchant: { select: { id: true, name: true } },
  sourceAccount: { select: { id: true, name: true } },
  targetAccount: { select: { id: true, name: true } },
} as const;

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return fail("No autorizado.", 401);
    const { id } = await params;
    const transaction = await prisma.transaction.findFirst({ where: { id, userId: auth.id, voidedAt: null }, select: transactionSelect });
    return transaction ? ok({ ...transaction, amount: toNumber(transaction.amount) }) : fail("Movimiento no encontrado.", 404);
  } catch (error) { return internal(error); }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return fail("No autorizado.", 401);
    const { id } = await params;
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error);
    const original = await prisma.transaction.findFirst({ where: { id, userId: auth.id, voidedAt: null }, select: { id: true, type: true, amount: true, sourceAccountId: true, categoryId: true } });
    if (!original) return fail("Movimiento no encontrado.", 404);
    if (original.type !== "INCOME" && original.type !== "EXPENSE") return fail("Este tipo de movimiento no se puede editar desde la app.", 400);
    const newType = parsed.data.type ?? original.type;
    const newAmount = parsed.data.amount ?? Number(original.amount);
    const newAccountId = parsed.data.sourceAccountId === undefined ? original.sourceAccountId : parsed.data.sourceAccountId;
    const newCategoryId = parsed.data.categoryId === undefined ? original.categoryId : parsed.data.categoryId;
    if (!newAccountId) return fail("Selecciona una cuenta.", 400, { sourceAccountId: "Campo obligatorio." });
    const account = await prisma.account.findFirst({ where: { id: newAccountId, userId: auth.id, archivedAt: null }, select: { id: true, openingBalance: true, creditLimit: true, type: true } });
    if (!account) return fail("Cuenta no válida o archivada.", 400, { sourceAccountId: "Cuenta no disponible." });
    if (newCategoryId) {
      const category = await prisma.category.findFirst({ where: { id: newCategoryId, userId: auth.id }, select: { id: true, type: true, isActive: true } });
      if (!category || category.type !== newType || (!category.isActive && newCategoryId !== original.categoryId)) return fail("Categoría no válida para el tipo elegido.", 400, { categoryId: "Selecciona otra categoría." });
    }
    if (newType === "EXPENSE") {
      const balances = await getAccountBalances(auth.id, [account], original.id);
      const balance = balances.get(account.id) ?? Number(account.openingBalance);
      const available = account.type === "CREDIT_CARD" ? Number(account.creditLimit ?? 0) + Math.min(0, balance) : balance;
      if (newAmount > available + 0.00001) return fail(`Saldo o crédito insuficiente (${available.toFixed(2)}).`, 400, { amount: "Monto mayor al disponible." });
    }
    const updated = await prisma.transaction.update({
      where: { id },
      data: {
        type: newType,
        amount: toDecimal(newAmount),
        categoryId: newCategoryId,
        sourceAccountId: newAccountId,
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        ...(parsed.data.occurredAt ? { occurredAt: new Date(parsed.data.occurredAt) } : {}),
      },
      select: transactionSelect,
    });
    return ok({ ...updated, amount: toNumber(updated.amount) }, "Movimiento actualizado.");
  } catch (error) { return internal(error); }
}
export const PUT = PATCH;

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return fail("No autorizado.", 401);
    const { id } = await params;
    const existing = await prisma.transaction.findFirst({ where: { id, userId: auth.id, voidedAt: null }, select: { id: true, goalContribution: { select: { id: true } }, debtPayment: { select: { id: true } } } });
    if (!existing) return fail("Movimiento no encontrado o anulado.", 404);
    if (existing.goalContribution || existing.debtPayment) return fail("Este movimiento está relacionado con una meta o deuda; debes gestionarlo desde su módulo.", 409);
    await prisma.transaction.update({ where: { id }, data: { status: "VOIDED", voidedAt: new Date() }, select: { id: true } });
    return ok({ id, voided: true }, "Movimiento anulado.");
  } catch (error) { return internal(error); }
}
