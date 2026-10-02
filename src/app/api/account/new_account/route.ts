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
          message: "Debes iniciar sesion para poder crear una cuenta",
        },
        { status: 401 },
      );
    }
    const body = await request.json();

    const data = createAccountSchema.parse(body);

    if (data.type === "CREDIT_CARD" && !data.creditLimit) {
      return NextResponse.json(
        {
          success: false,
          message: "Las tarjetas de credito requieren asignar un limite",
        },
        {
          status: 400,
        },
      );
    }

    const account = await prisma.account.create({
      data: {
        userId: data.userId,
        name: data.name,
        type: data.type,
        institution: data.institution ?? null,
        lastFourDigits: data.lastFourDigits ?? null,
        currency: data.currency,
        openingBalance: data.openingBalance,
        creditLimit: data.creditLimit ?? null,
        color: data.color ?? null,
        icon: data.icon ?? null,
        isDefault: data.isDefault,
        isActive: data.isActive,
        includeInNetWorth: data.includeInNetWorth,
      },
      select: {
        name: true,
        type: true,
        openingBalance: true,
        creditLimit: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Cuenta creada correctamente",
      new_account: {
        name: account.name,
        // si es tarjeta de crédito muestra el límite, si no el saldo inicial
        amount:
          account.type === "CREDIT_CARD"
            ? account.creditLimit
            : account.openingBalance,
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      status: 500,
      message: "Error al crear cuenta",
      error: error,
    });
  }
}
