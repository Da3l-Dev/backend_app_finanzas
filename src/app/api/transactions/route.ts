import {
  TransactionType,
  TransactionStatus,
  TransactionOrigin,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { toDecimal, toNumber } from "@/lib/money";
import { getOrCreateMerchant } from "@/lib/merchant";

const CreateTransactionSchema = z.object({
  type: z.enum([
    "EXPENSE",
    "INCOME",
    "TRANSFER",
    "CREDIT_CARD_PAYMENT",
    "ADJUSTMENT",
  ]),
  amount: z.number().positive(),
  categoryId: z.string().uuid().optional(),
  sourceAccountId: z.string().uuid().optional(),
  targetAccountId: z.string().uuid().optional(),
  merchantName: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  occurredAt: z.string().datetime().optional(),
});

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      { status: "error", message: "No autorizado." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const validation = CreateTransactionSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      {
        status: "error",
        message: "Revisa los datos enviados.",
        errors: validation.error.issues,
      },
      { status: 400 },
    );
  }

  const data = validation.data;

  // Validaciones por tipo
  if (
    data.type === "TRANSFER" &&
    (!data.sourceAccountId || !data.targetAccountId)
  ) {
    return NextResponse.json(
      {
        status: "error",
        message: "Una transferencia requiere cuenta origen y destino.",
      },
      { status: 400 },
    );
  }

  if (
    (data.type === "EXPENSE" || data.type === "INCOME") &&
    !data.sourceAccountId
  ) {
    return NextResponse.json(
      { status: "error", message: "Selecciona una cuenta." },
      { status: 400 },
    );
  }

  // Verificar que categoría y cuentas pertenezcan al usuario
  if (data.categoryId) {
    const cat = await prisma.category.findFirst({
      where: { id: data.categoryId, userId: user.id },
      select: { id: true, type: true },
    });
    if (!cat) {
      return NextResponse.json(
        { status: "error", message: "Categoría no válida." },
        { status: 400 },
      );
    }
    if (
      (data.type === "EXPENSE" && cat.type !== "EXPENSE") ||
      (data.type === "INCOME" && cat.type !== "INCOME")
    ) {
      return NextResponse.json(
        {
          status: "error",
          message: "La categoría no corresponde al tipo de transacción.",
        },
        { status: 400 },
      );
    }
  }

  if (data.sourceAccountId) {
    const acc = await prisma.account.findFirst({
      where: { id: data.sourceAccountId, userId: user.id, archivedAt: null },
      select: { id: true },
    });
    if (!acc) {
      return NextResponse.json(
        { status: "error", message: "Cuenta origen no válida." },
        { status: 400 },
      );
    }
  }

  if (data.targetAccountId) {
    const acc = await prisma.account.findFirst({
      where: { id: data.targetAccountId, userId: user.id, archivedAt: null },
      select: { id: true },
    });
    if (!acc) {
      return NextResponse.json(
        { status: "error", message: "Cuenta destino no válida." },
        { status: 400 },
      );
    }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const merchant = data.merchantName
        ? await getOrCreateMerchant(tx, user.id, data.merchantName)
        : null;

      return tx.transaction.create({
        data: {
          userId: user.id,
          type: data.type as TransactionType,
          status: TransactionStatus.POSTED,
          origin: TransactionOrigin.MOBILE,
          amount: toDecimal(data.amount),
          categoryId: data.categoryId ?? null,
          merchantId: merchant?.id ?? null,
          sourceAccountId: data.sourceAccountId ?? null,
          targetAccountId: data.targetAccountId ?? null,
          description: data.description ?? null,
          notes: data.notes ?? null,
          occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
        },
        include: {
          category: {
            select: { id: true, name: true, color: true, icon: true },
          },
          merchant: { select: { id: true, name: true } },
          sourceAccount: { select: { id: true, name: true } },
          targetAccount: { select: { id: true, name: true } },
        },
      });
    });

    return NextResponse.json(
      {
        status: "ok",
        message: "Transacción registrada.",
        data: {
          ...created,
          amount: toNumber(created.amount),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creando transacción:", error);
    return NextResponse.json(
      { status: "error", message: "No fue posible registrar la transacción." },
      { status: 500 },
    );
  }
}

// ================= GET: listar con filtros =================

const ListQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  type: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(200).optional().default(50),
  skip: z.coerce.number().int().min(0).optional().default(0),
});

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      { status: "error", message: "No autorizado." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const parsed = ListQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { status: "error", message: "Parámetros inválidos." },
      { status: 400 },
    );
  }

  const { from, to, type, categoryId, accountId, take, skip } = parsed.data;

  const where = {
    userId: user.id,
    voidedAt: null,
    ...(from || to
      ? {
          occurredAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
    ...(type ? { type: type as TransactionType } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(accountId
      ? {
          OR: [{ sourceAccountId: accountId }, { targetAccountId: accountId }],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take,
      skip,
      include: {
        category: { select: { id: true, name: true, color: true, icon: true } },
        merchant: { select: { id: true, name: true } },
        sourceAccount: { select: { id: true, name: true } },
        targetAccount: { select: { id: true, name: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  return NextResponse.json({
    status: "ok",
    data: {
      items: items.map((t) => ({ ...t, amount: toNumber(t.amount) })),
      total,
      take,
      skip,
    },
  });
}
