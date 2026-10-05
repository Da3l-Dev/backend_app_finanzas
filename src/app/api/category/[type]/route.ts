import { NextResponse } from "next/server";
import { CategoryType } from "@prisma/client";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ type: string }> }, // 👈 Promise
) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { status: "error", message: "No autorizado." },
        { status: 401 },
      );
    }

    // 👇 await antes de leer
    const { type: rawParam } = await params;

    // Normaliza a mayúsculas y valida contra el enum
    const rawType = rawParam.toUpperCase();

    if (rawType !== "EXPENSE" && rawType !== "INCOME") {
      return NextResponse.json(
        {
          status: "error",
          message: "Tipo inválido. Usa EXPENSE o INCOME.",
        },
        { status: 400 },
      );
    }

    const type = rawType as CategoryType;

    const categories = await prisma.category.findMany({
      where: {
        userId: user.id,
        type,
        isActive: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        type: true,
        color: true,
        icon: true,
        code: true,
        parentId: true,
        sortOrder: true,
      },
    });

    return NextResponse.json({
      status: "ok",
      data: categories,
    });
  } catch (error) {
    console.error("Error al obtener categorías:", error);
    return NextResponse.json(
      { status: "error", message: "No fue posible obtener las categorías." },
      { status: 500 },
    );
  }
}
