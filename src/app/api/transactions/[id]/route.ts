import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { toDecimal, toNumber } from "@/lib/money";

// ═══════════════════════════════════════════════════════════════
// GET — una transacción
// ═══════════════════════════════════════════════════════════════
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      { status: "error", message: "No autorizado." },
      { status: 401 },
    );
  }

  const { id } = await params;

  const tx = await prisma.transaction.findFirst({
    where: { id, userId: user.id },
    include: {
      category: { select: { id: true, name: true, icon: true, color: true } },
      merchant: { select: { id: true, name: true } },
      sourceAccount: { select: { id: true, name: true } },
      targetAccount: { select: { id: true, name: true } },
    },
  });

  if (!tx) {
    return NextResponse.json(
      { status: "error", message: "Movimiento no encontrado." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    status: "ok",
    data: { ...tx, amount: toNumber(tx.amount) },
  });
}

// ═══════════════════════════════════════════════════════════════
// PATCH — actualizar
// ═══════════════════════════════════════════════════════════════
const UpdateSchema = z.object({
  type: z.enum(["EXPENSE", "INCOME"]).optional(),
  amount: z.number().positive().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  sourceAccountId: z.string().uuid().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { status: "error", message: "No autorizado." },
        { status: 401 },
      );
    }

    const { id } = await params;

    // Verificar que la transacción existe y es del usuario
    const existing = await prisma.transaction.findFirst({
      where: { id, userId: user.id, voidedAt: null },
      select: {
        id: true,
        type: true,
        sourceAccountId: true,
        categoryId: true,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { status: "error", message: "Movimiento no encontrado." },
        { status: 404 },
      );
    }

    const body = await request.json().catch(() => null);
    const validation = UpdateSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          status: "error",
          message: "Revisa los datos.",
          errors: validation.error.issues,
        },
        { status: 400 },
      );
    }

    const data = validation.data;

    // Validaciones de seguridad por si cambian monto o cuenta
    const nuevoMonto = data.amount;
    const nuevaCuentaId = data.sourceAccountId ?? existing.sourceAccountId;
    const nuevoTipo = data.type ?? existing.type;

    // Si es gasto y hay cuenta, verificar saldo (excluyendo esta misma tx)
    if (nuevoTipo === "EXPENSE" && nuevaCuentaId && nuevoMonto !== undefined) {
      const account = await prisma.account.findFirst({
        where: { id: nuevaCuentaId, userId: user.id, archivedAt: null },
        select: {
          id: true,
          type: true,
          openingBalance: true,
          creditLimit: true,
        },
      });
      if (!account) {
        return NextResponse.json(
          { status: "error", message: "Cuenta no válida." },
          { status: 400 },
        );
      }

      // Traer todas las transacciones de esta cuenta (menos la que estamos editando)
      const txs = await prisma.transaction.findMany({
        where: {
          userId: user.id,
          voidedAt: null,
          id: { not: id },
          OR: [
            { sourceAccountId: nuevaCuentaId },
            { targetAccountId: nuevaCuentaId },
          ],
        },
        select: {
          type: true,
          amount: true,
          sourceAccountId: true,
          targetAccountId: true,
        },
      });

      let balance = Number(account.openingBalance);
      for (const t of txs) {
        const amt = Number(t.amount);
        if (t.type === "EXPENSE" && t.sourceAccountId === nuevaCuentaId) {
          balance -= amt;
        } else if (t.type === "INCOME" && t.sourceAccountId === nuevaCuentaId) {
          balance += amt;
        } else if (
          (t.type === "TRANSFER" || t.type === "CREDIT_CARD_PAYMENT") &&
          t.sourceAccountId === nuevaCuentaId
        ) {
          balance -= amt;
        } else if (
          (t.type === "TRANSFER" || t.type === "CREDIT_CARD_PAYMENT") &&
          t.targetAccountId === nuevaCuentaId
        ) {
          balance += amt;
        }
      }

      if (account.type === "CREDIT_CARD") {
        const creditAvailable = Math.max(
          0,
          (Number(account.creditLimit) ?? 0) - Math.abs(Math.min(0, balance)),
        );
        if (nuevoMonto > creditAvailable) {
          return NextResponse.json(
            {
              status: "error",
              message: `Excedes el crédito disponible ($${creditAvailable.toFixed(2)}).`,
              errors: { amount: "Monto excede el crédito." },
            },
            { status: 400 },
          );
        }
      } else {
        if (nuevoMonto > Math.max(0, balance)) {
          return NextResponse.json(
            {
              status: "error",
              message: `Saldo insuficiente ($${Math.max(0, balance).toFixed(2)}).`,
              errors: { amount: "Monto excede el saldo." },
            },
            { status: 400 },
          );
        }
      }
    }

    const updated = await prisma.transaction.update({
      where: { id },
      data: {
        ...(data.type ? { type: data.type } : {}),
        ...(data.amount !== undefined
          ? { amount: toDecimal(data.amount) }
          : {}),
        ...(data.categoryId !== undefined
          ? { categoryId: data.categoryId }
          : {}),
        ...(data.sourceAccountId !== undefined
          ? { sourceAccountId: data.sourceAccountId }
          : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.occurredAt ? { occurredAt: new Date(data.occurredAt) } : {}),
      },
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        sourceAccount: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      status: "ok",
      message: "Movimiento actualizado.",
      data: { ...updated, amount: toNumber(updated.amount) },
    });
  } catch (error) {
    console.error("Error al actualizar transacción:", error);
    return NextResponse.json(
      { status: "error", message: "No se pudo actualizar." },
      { status: 500 },
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// DELETE — anular (soft delete)
// ═══════════════════════════════════════════════════════════════
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      { status: "error", message: "No autorizado." },
      { status: 401 },
    );
  }

  const { id } = await params;

  const tx = await prisma.transaction.findFirst({
    where: { id, userId: user.id },
    select: { id: true, voidedAt: true },
  });

  if (!tx) {
    return NextResponse.json(
      { status: "error", message: "Movimiento no encontrado." },
      { status: 404 },
    );
  }

  if (tx.voidedAt) {
    return NextResponse.json(
      { status: "error", message: "Ya estaba anulado." },
      { status: 409 },
    );
  }

  await prisma.transaction.update({
    where: { id },
    data: { status: "VOIDED", voidedAt: new Date() },
  });

  return NextResponse.json({
    status: "ok",
    message: "Movimiento anulado.",
  });
}
