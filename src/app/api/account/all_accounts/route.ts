import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "../../auth/session";
import { use } from "react";
import { success } from "zod";
import { message } from "telegraf/filters";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Requieres iniciar sesion para esta consulta",
        },
        { status: 400 },
      );
    }

    const allAccounts = await prisma.account.findMany();

    return NextResponse.json({
      success: true,
      message: "Datos obtenidos correctamente",
      data: allAccounts,
    });
  } catch (error) {}
}
