import { NextResponse } from "next/server";
import { CategoryType } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { prisma } from "@/lib/prisma";

const CreateCategorySchema = z.object({
  name: z.string().min(2).max(40),
  type: z.enum(["EXPENSE", "INCOME"]),
  icon: z.string().max(80).optional(),
  color: z.string().max(20).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { status: "error", message: "No autorizado." },
        { status: 401 },
      );
    }

    const body = await request.json().catch(() => null);
    const validation = CreateCategorySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          status: "error",
          message: "Revisa los datos de la categoría.",
          errors: validation.error.issues,
        },
        { status: 400 },
      );
    }

    const data = validation.data;

    const category = await prisma.category.create({
      data: {
        userId: user.id,
        name: data.name.trim(),
        type: data.type as CategoryType,
        icon: data.icon ?? null,
        color: data.color ?? null,
      },
      select: {
        id: true,
        name: true,
        type: true,
        icon: true,
        color: true,
        code: true,
        parentId: true,
        sortOrder: true,
      },
    });

    return NextResponse.json({ status: "ok", data: category }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        {
          status: "error",
          message: "Ya tienes una categoría con ese nombre.",
          errors: { name: "Nombre duplicado." },
        },
        { status: 409 },
      );
    }

    console.error("Error al crear categoría:", error);
    return NextResponse.json(
      { status: "error", message: "No se pudo crear la categoría." },
      { status: 500 },
    );
  }
}
