import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { fail, internal, invalid, ok } from "@/lib/api-response";

type Context = { params: Promise<{ id: string }> };
const editSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  type: z.enum(["CASH", "DEBIT_CARD", "CREDIT_CARD", "SAVINGS", "INVESTMENT"]).optional(),
  openingBalance: z.number().nonnegative().max(999999999).optional(),
  color: z.string().max(20).nullish(),
  icon: z.string().max(50).nullish(),
  institution: z.string().trim().max(40).nullish(),
  lastFourDigits: z.union([z.string().regex(/^\d{4}$/), z.null()]).optional(),
  isDefault: z.boolean().optional(),
  includeInNetWorth: z.boolean().optional(),
  creditLimit: z.number().positive().nullable().optional(),
  restore: z.boolean().optional(),
}).strict();

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return fail("No autorizado.", 401);
    const { id } = await params;
    const account = await prisma.account.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true, name: true, type: true, currency: true, institution: true,
        lastFourDigits: true, openingBalance: true, creditLimit: true,
        color: true, icon: true, isDefault: true, isActive: true,
        includeInNetWorth: true, archivedAt: true, createdAt: true, updatedAt: true,
      },
    });
    if (!account) return fail("Cuenta no encontrada.", 404);
    return ok({
      ...account,
      openingBalance: Number(account.openingBalance),
      creditLimit: account.creditLimit === null ? null : Number(account.creditLimit),
    });
  } catch (error) { return internal(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return fail("No autorizado.", 401);
    const { id } = await params;
    const parsed = editSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error);
    const existing = await prisma.account.findFirst({
      where: { id, userId: user.id },
      select: { id: true, isDefault: true, archivedAt: true },
    });
    if (!existing) return fail("Cuenta no encontrada.", 404);
    const { restore, ...changes } = parsed.data;
    if (Object.keys(changes).length === 0 && !restore) return fail("No se enviaron cambios.", 400);
    const updated = await prisma.$transaction(async (tx) => {
      if (changes.isDefault === true) {
        await tx.account.updateMany({ where: { userId: user.id, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      }
      return tx.account.update({
        where: { id },
        data: {
          ...changes,
          ...(restore ? { archivedAt: null, isActive: true } : {}),
        },
        select: {
          id: true, name: true, type: true, currency: true, institution: true,
          lastFourDigits: true, openingBalance: true, creditLimit: true,
          icon: true, color: true, isDefault: true, isActive: true,
          includeInNetWorth: true, archivedAt: true, createdAt: true,
        },
      });
    });
    return ok({
      ...updated,
      openingBalance: Number(updated.openingBalance),
      creditLimit: updated.creditLimit === null ? null : Number(updated.creditLimit),
    }, restore ? "Cuenta restaurada." : "Cuenta actualizada.");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("Ya existe otra cuenta con ese nombre.", 409, { name: "Nombre duplicado." });
    }
    return internal(error);
  }
}
export const PUT = PATCH;

// DELETE real. Si hay movimientos, exige ?force=true y una confirmación adicional desde la app.
export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return fail("No autorizado.", 401);
    const { id } = await params;
    const existing = await prisma.account.findFirst({
      where: { id, userId: user.id },
      select: { id: true, isDefault: true },
    });
    if (!existing) return fail("Cuenta no encontrada.", 404);

    const force = new URL(request.url).searchParams.get("force") === "true";
    const referenceWhere = { userId: user.id, OR: [{ sourceAccountId: id }, { targetAccountId: id }] };
    const transactions = await prisma.transaction.count({ where: referenceWhere });
    if (transactions > 0 && !force) {
      return fail(
        `Esta cuenta tiene ${transactions} movimiento(s). Para borrarla definitivamente también deberás eliminar esos movimientos.`,
        409,
        { transactions: String(transactions), requiresConfirmation: "true" },
      );
    }

    await prisma.$transaction(async (tx) => {
      // El usuario autoriza explícitamente la destrucción de los movimientos dependientes.
      if (force && transactions > 0) {
        const ids = (await tx.transaction.findMany({
          where: referenceWhere,
          select: { id: true },
        })).map((item) => item.id);
        if (ids.length > 0) {
          await tx.goalContribution.deleteMany({ where: { transactionId: { in: ids } } });
          await tx.debtPayment.deleteMany({ where: { transactionId: { in: ids } } });
          // Los desgloses TransactionSplit se eliminan mediante CASCADE.
          await tx.transaction.deleteMany({ where: { id: { in: ids }, userId: user.id } });
        }
      }
      await tx.account.delete({ where: { id, userId: user.id } });
      if (existing.isDefault) {
        const next = await tx.account.findFirst({
          where: { userId: user.id, archivedAt: null, isActive: true },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (next) await tx.account.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
    return ok({ id, deleted: true, deletedTransactions: force ? transactions : 0 }, "Cuenta eliminada definitivamente de la base de datos.");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return fail("La cuenta todavía tiene registros asociados que impiden eliminarla. Vuelve a intentar o revisa los movimientos.", 409);
    }
    return internal(error);
  }
}
