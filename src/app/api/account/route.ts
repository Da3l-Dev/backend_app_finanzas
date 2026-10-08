import { getAccountBalances } from "@/lib/balances";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAccountSchema } from "@/lib/validations/accounts";
import { getAuthenticatedUser } from "../auth/session";

// ═══════════════════════════════════════════════════════════════
// POST — Crear cuenta
// ═══════════════════════════════════════════════════════════════
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

    // ¿Es la primera cuenta del usuario? Entonces es default.
    const existingCount = await prisma.account.count({
      where: { userId: user.id, archivedAt: null },
    });

    const isDefault = existingCount === 0 ? true : (data.isDefault ?? false);

    const account = await prisma.account.create({
      data: {
        // 🔒 El userId SIEMPRE viene del token, nunca del body
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
        isDefault,
        isActive: true,
        includeInNetWorth: data.includeInNetWorth ?? true,
      },
      select: {
        id: true,
        name: true,
        type: true,
        currency: true,
        institution: true,
        lastFourDigits: true,
        openingBalance: true,
        creditLimit: true,
        color: true,
        icon: true,
        isDefault: true,
        includeInNetWorth: true,
        createdAt: true,
      },
    });

    // Si esta cuenta es default, quitamos el default de las demás
    if (isDefault) {
      await prisma.account.updateMany({
        where: {
          userId: user.id,
          id: { not: account.id },
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

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
    // Nombre duplicado (P2002 en @@unique([userId, name]))
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Ya tienes una cuenta con ese nombre.",
          errors: { name: "Nombre duplicado." },
        },
        { status: 409 },
      );
    }

    console.error("Error al crear cuenta:", error);
    return NextResponse.json(
      { success: false, message: "Error al crear cuenta." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { success: false, message: "No autorizado." },
        { status: 401 },
      );
    }

    // Recupera también cuentas archivadas solo cuando se solicita expresamente.
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const accounts = await prisma.account.findMany({
        where: { userId: user.id, ...(includeArchived ? {} : { archivedAt: null }) },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          type: true,
          currency: true,
          institution: true,
          lastFourDigits: true,
          openingBalance: true,
          creditLimit: true,
          color: true,
          icon: true,
          isDefault: true,
          isActive: true,
          archivedAt: true,
          includeInNetWorth: true,
          createdAt: true,
        },
      });

    const balanceMap = await getAccountBalances(user.id, accounts);

    return NextResponse.json({
      success: true,
      data: accounts.map((a) => {
        const currentBalance = balanceMap.get(a.id) ?? Number(a.openingBalance);
        const creditLimit = a.creditLimit ? Number(a.creditLimit) : null;
        const creditAvailable =
          a.type === "CREDIT_CARD" && creditLimit != null
            ? Math.max(0, creditLimit - Math.abs(Math.min(0, currentBalance)))
            : null;

        return {
          ...a,
          openingBalance: Number(a.openingBalance),
          currentBalance,
          creditLimit,
          creditAvailable,
        };
      }),
    });
  } catch (error) {
    console.error("Error al listar cuentas:", error);
    return NextResponse.json(
      { success: false, message: "No se pudieron cargar las cuentas." },
      { status: 500 },
    );
  }
}
