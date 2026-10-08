import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { fail, internal, invalid, ok } from "@/lib/api-response";

const budgetSchema = z.object({ categoryId: z.uuid(), allocatedAmount: z.number().positive().max(999999999), month: z.iso.date(), warningPercent: z.number().int().min(1).max(100).optional() }).strict();
export async function GET(request: Request) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return fail("No autorizado.", 401);
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail("Mes inválido (AAAA-MM).");
    const from = new Date(`${month}-01T00:00:00.000Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const [budgets, spending] = await Promise.all([
      prisma.budget.findMany({ where: { userId: auth.id, month: from, isActive: true }, select: { id: true, categoryId: true, allocatedAmount: true, warningPercent: true, category: { select: { name: true, icon: true, color: true } } }, orderBy: { createdAt: "desc" } }),
      prisma.transaction.groupBy({ by: ["categoryId"], where: { userId: auth.id, type: "EXPENSE", status: "POSTED", voidedAt: null, occurredAt: { gte: from, lt: to } }, _sum: { amount: true } }),
    ]);
    const totalByCategory = new Map(spending.map(v => [v.categoryId, Number(v._sum.amount ?? 0)]));
    return ok(budgets.map(b => ({ ...b, allocatedAmount: Number(b.allocatedAmount), spent: totalByCategory.get(b.categoryId) ?? 0 })));
  } catch (error) { return internal(error); }
}
export async function POST(request: Request) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return fail("No autorizado.", 401);
    const parsed = budgetSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error);
    const category = await prisma.category.findFirst({ where: { id: parsed.data.categoryId, userId: auth.id, type: "EXPENSE", isActive: true }, select: { id: true } });
    if (!category) return fail("Categoría de gasto no válida.");
    const month = new Date(`${parsed.data.month.slice(0, 7)}-01T00:00:00.000Z`);
    const b = await prisma.budget.upsert({ where: { userId_categoryId_month: { userId: auth.id, categoryId: category.id, month } }, create: { userId: auth.id, categoryId: category.id, month, allocatedAmount: parsed.data.allocatedAmount, warningPercent: parsed.data.warningPercent ?? 80 }, update: { allocatedAmount: parsed.data.allocatedAmount, warningPercent: parsed.data.warningPercent ?? 80, isActive: true }, select: { id: true } });
    return ok(b, "Presupuesto guardado.", 201);
  } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return fail("Presupuesto duplicado.", 409); return internal(error); }
}
