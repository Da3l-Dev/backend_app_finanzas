import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { fail, internal, invalid, ok } from "@/lib/api-response";
import { goalSchema } from "@/lib/validations/goals";
type Ctx = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, ctx: Ctx) {
  try { const auth = await getAuthenticatedUser(request); if (!auth) return fail("No autorizado.", 401);
    const { id } = await ctx.params; const parsed = goalSchema.partial().safeParse(await request.json().catch(() => null)); if (!parsed.success) return invalid(parsed.error);
    const data = { ...parsed.data, ...(parsed.data.targetDate ? { targetDate: new Date(parsed.data.targetDate) } : {}) };
    const result = await prisma.savingGoal.updateMany({ where: { id, userId: auth.id, isArchived: false }, data });
    return result.count ? ok({ id }, "Meta actualizada.") : fail("Meta no encontrada.", 404);
  } catch (error) { return internal(error); }
}
export const PUT = PATCH;
export async function DELETE(request: Request, ctx: Ctx) {
  try { const auth = await getAuthenticatedUser(request); if (!auth) return fail("No autorizado.", 401); const { id } = await ctx.params;
    const result = await prisma.savingGoal.updateMany({ where: { id, userId: auth.id }, data: { isArchived: true } });
    return result.count ? ok({ id }, "Meta archivada.") : fail("Meta no encontrada.", 404);
  } catch (error) { return internal(error); }
}
