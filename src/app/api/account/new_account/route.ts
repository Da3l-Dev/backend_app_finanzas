import { prisma } from "@/lib/prisma";
import { createAccountSchema } from "@/lib/validations/accounts";
import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../auth/session";

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Debes iniciar sesión para poder crear una cuenta.",
        },
        { status: 401 },
      );
    }

    const body = await request.json().catch(() => null);

    const validation = createAccountSchema.safeParse(body);

    if (!validation.success) {
      const errors = validation.error.issues.reduce<Record<string, string>>(
        (acc, issue) => {
          const field = String(issue.path[0] ?? "general");
          if (!acc[field]) acc[field] = issue.message;
          return acc;
        },
        {},
      );

      return NextResponse.json(
        {
          success: false,
          message: "Revisa los datos de la cuenta.",
          errors,
        },
        { status: 400 },
      );
    }

    const data = validation.data;

    if (data.type === "CREDIT_CARD" && !data.creditLimit) {
      return NextResponse.json(
        {
          success: false,
          message: "Las tarjetas de crédito requieren un límite.",
          errors: { creditLimit: "Asigna un límite." },
        },
        { status: 400 },
      );
    }

    // Si es la primera cuenta del usuario, la marcamos como default.
    const existingCount = await prisma.account.count({
      where: { userId: user.id, archivedAt: null },
    });

    const account = await prisma.account.create({
      data: {
        // 🔒 SIEMPRE el user autenticado, nunca del body
        userId: user.id,
        name: data.name,
        type: data.type,
        institution: data.institution ?? null,
        lastFourDigits: data.lastFourDigits ?? null,
        currency: data.currency ?? "MXN",
        openingBalance: data.openingBalance,
        creditLimit: data.creditLimit ?? null,
        color: data.color ?? null,
        icon: data.icon ?? null,
        isDefault: existingCount === 0 ? true : (data.isDefault ?? false),
        isActive: true,
        includeInNetWorth: data.includeInNetWorth ?? true,
      },
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
        createdAt: true,
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: "Cuenta creada correctamente.",
        data: {
          ...account,
          openingBalance: Number(account.openingBalance),
          creditLimit: account.creditLimit ? Number(account.creditLimit) : null,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error al crear cuenta:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Error al crear cuenta.",
      },
      { status: 500 },
    );
  }
}

// GET: listar cuentas del usuario
export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "No autorizado." },
      { status: 401 },
    );
  }

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
      institution: true,
      color: true,
      icon: true,
      isDefault: true,
      isActive: true,
      includeInNetWorth: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    success: true,
    data: accounts.map((a) => ({
      ...a,
      openingBalance: Number(a.openingBalance),
      creditLimit: a.creditLimit ? Number(a.creditLimit) : null,
    })),
  });
}
