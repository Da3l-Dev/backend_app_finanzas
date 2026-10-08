import { NextResponse } from "next/server";
import { CategoryType, Prisma } from "@prisma/client";
import { z } from "zod";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { prisma } from "@/lib/prisma";
import { fail, internal, invalid, ok } from "@/lib/api-response";

type Context = { params: Promise<{ type: string }> };
const updateCategorySchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  icon: z.string().max(50).nullish(),
  color: z.string().max(20).nullish(),
  restore: z.boolean().optional(),
}).strict();

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return fail("No autorizado.", 401);
    const { type: value } = await params;
    const raw = value.toUpperCase();
    if (raw !== "EXPENSE" && raw !== "INCOME") return fail("Tipo inválido. Usa EXPENSE o INCOME.", 400);
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const categories = await prisma.category.findMany({
      where: { userId: user.id, type: raw as CategoryType, ...(includeArchived ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, type: true, color: true, icon: true,
        code: true, parentId: true, sortOrder: true, isSystem: true, isActive: true,
      },
    });
    return ok(categories, "Categorías obtenidas.");
  } catch (error) { return internal(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return fail("No autorizado.", 401);
    const { type: id } = await params;
    if (!z.uuid().safeParse(id).success) return fail("ID de categoría inválido.", 400);
    const parsed = updateCategorySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error);
    const found = await prisma.category.findFirst({
      where: { id, userId: user.id }, select: { id: true },
    });
    if (!found) return fail("Categoría no encontrada.", 404);
    const { restore, ...changes } = parsed.data;
    if (Object.keys(changes).length === 0 && !restore) return fail("No se enviaron cambios.", 400);
    const updated = await prisma.category.update({
      where: { id },
      data: { ...changes, ...(restore ? { isActive: true } : {}) },
      select: { id: true, name: true, type: true, color: true, icon: true, code: true, parentId: true, sortOrder: true, isSystem: true, isActive: true },
    });
    return ok(updated, restore ? "Categoría restaurada." : "Categoría actualizada.");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("Ya existe otra categoría con ese nombre.", 409, { name: "Nombre duplicado." });
    }
    return internal(error);
  }
}
export const PUT = PATCH;

// Eliminación física. Si existen dependencias, requiere force=true y confirmación expresa.
export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return fail("No autorizado.", 401);
    const { type: id } = await params;
    if (!z.uuid().safeParse(id).success) return fail("ID de categoría inválido.", 400);
    const existing = await prisma.category.findFirst({
      where: { id, userId: user.id }, select: { id: true, isSystem: true },
    });
    if (!existing) return fail("Categoría no encontrada.", 404);
    if (existing.isSystem) return fail("Esta categoría del sistema no se puede eliminar. Puedes editar su nombre o ícono.", 403);

    const [movements, budgets, splits, subcategories, recurring] = await Promise.all([
      prisma.transaction.count({ where: { userId: user.id, categoryId: id } }),
      prisma.budget.count({ where: { userId: user.id, categoryId: id } }),
      prisma.transactionSplit.count({ where: { categoryId: id, transaction: { userId: user.id } } }),
      prisma.category.count({ where: { parentId: id, userId: user.id } }),
      prisma.recurringTransaction.count({ where: { categoryId: id, userId: user.id } }),
    ]);
    const dependencies = movements + budgets + splits + subcategories + recurring;
    const force = new URL(request.url).searchParams.get("force") === "true";
    if (dependencies > 0 && !force) {
      return fail(
        "Esta categoría se usa en registros existentes. Puedes eliminarla definitivamente, conservando los movimientos sin categoría, pero sus presupuestos y desgloses asociados se borrarán.",
        409,
        { requiresConfirmation: "true", movements: String(movements), budgets: String(budgets), splits: String(splits), subcategories: String(subcategories), recurring: String(recurring) },
      );
    }

    await prisma.$transaction(async (tx) => {
      if (force) {
        // Conservar movimientos; perderán la referencia a esta categoría.
        await tx.transaction.updateMany({ where: { userId: user.id, categoryId: id }, data: { categoryId: null } });
        await tx.recurringTransaction.updateMany({ where: { userId: user.id, categoryId: id }, data: { categoryId: null } });
        await tx.category.updateMany({ where: { userId: user.id, parentId: id }, data: { parentId: null } });
        await tx.budget.deleteMany({ where: { userId: user.id, categoryId: id } });
        await tx.transactionSplit.deleteMany({ where: { categoryId: id, transaction: { userId: user.id } } });
      }
      await tx.category.delete({ where: { id, userId: user.id } });
    });
    return ok({ id, deleted: true, unlinkedTransactions: force ? movements : 0 }, "Categoría eliminada definitivamente de la base de datos.");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return fail("Esta categoría aún tiene relaciones que impiden eliminarla.", 409);
    }
    return internal(error);
  }
}
