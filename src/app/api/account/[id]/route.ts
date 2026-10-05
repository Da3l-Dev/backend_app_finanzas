import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";

// ═══════════════════════════════════════════════════════════════
// GET /api/account/[id] — Obtener una cuenta
// ═══════════════════════════════════════════════════════════════
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "No autorizado." },
        { status: 401 },
      );
    }

    const { id } = await params;

    const account = await prisma.account.findFirst({
      where: { id, userId: user.id },
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
        includeInNetWorth: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!account) {
      return NextResponse.json(
        { success: false, message: "Cuenta no encontrada." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...account,
        openingBalance: Number(account.openingBalance),
        creditLimit: account.creditLimit ? Number(account.creditLimit) : null,
      },
    });
  } catch (error) {
    console.error("Error al obtener cuenta:", error);
    return NextResponse.json(
      { success: false, message: "No se pudo cargar la cuenta." },
      { status: 500 },
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// PATCH /api/account/[id] — Actualizar cuenta
// ═══════════════════════════════════════════════════════════════
const UpdateAccountSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  color: z.string().max(20).nullable().optional(),
  icon: z.string().max(80).nullable().optional(),
  institution: z.string().trim().max(40).nullable().optional(),
  lastFourDigits: z
    .string()
    .regex(/^\d{4}$/)
    .nullable()
    .optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  includeInNetWorth: z.boolean().optional(),
  creditLimit: z.number().positive().nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "No autorizado." },
        { status: 401 },
      );
    }

    const { id } = await params;

    const existing = await prisma.account.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Cuenta no encontrada." },
        { status: 404 },
      );
    }

    const body = await request.json().catch(() => null);
    const validation = UpdateAccountSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Revisa los datos.",
          errors: validation.error.issues,
        },
        { status: 400 },
      );
    }

    const updated = await prisma.account.update({
      where: { id },
      data: validation.data,
      select: {
        id: true,
        name: true,
        type: true,
        openingBalance: true,
        creditLimit: true,
        color: true,
        icon: true,
        isDefault: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Cuenta actualizada.",
      data: {
        ...updated,
        openingBalance: Number(updated.openingBalance),
        creditLimit: updated.creditLimit ? Number(updated.creditLimit) : null,
      },
    });
  } catch (error) {
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
    console.error("Error al actualizar cuenta:", error);
    return NextResponse.json(
      { success: false, message: "No se pudo actualizar." },
      { status: 500 },
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// DELETE /api/account/[id] — Archivar cuenta (soft delete)
// ═══════════════════════════════════════════════════════════════
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "No autorizado." },
        { status: 401 },
      );
    }

    const { id } = await params;

    // 1. Verificar que la cuenta existe y pertenece al usuario
    const existing = await prisma.account.findFirst({
      where: { id, userId: user.id, archivedAt: null },
      select: { id: true, isDefault: true },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Cuenta no encontrada." },
        { status: 404 },
      );
    }

    // 2. No permitir borrar la última cuenta activa
    const activeCount = await prisma.account.count({
      where: { userId: user.id, archivedAt: null },
    });

    if (activeCount <= 1) {
      return NextResponse.json(
        {
          success: false,
          message: "Debes tener al menos una cuenta activa.",
        },
        { status: 400 },
      );
    }

    // 3. Soft delete + limpiar flag de default
    await prisma.account.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        isActive: false,
        isDefault: false,
      },
    });

    // 4. Si era la default, promover la más antigua como nueva default
    if (existing.isDefault) {
      const next = await prisma.account.findFirst({
        where: { userId: user.id, archivedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      if (next) {
        await prisma.account.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: "Cuenta eliminada correctamente.",
    });
  } catch (error) {
    console.error("Error al eliminar cuenta:", error);
    return NextResponse.json(
      { success: false, message: "No se pudo eliminar la cuenta." },
      { status: 500 },
    );
  }
}
