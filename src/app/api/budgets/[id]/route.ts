import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { fail, internal, invalid, ok } from "@/lib/api-response";
type Ctx = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const auth = await getAuthenticatedUser(request); if (!auth) return fail("No autorizado.", 401);
    const { id } = await ctx.params;
    const parsed = z.object({ allocatedAmount: z.number().positive().max(999999999).optional(), warningPercent: z.number().int().min(1).max(100).optional() }).strict().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error);
    const updated = await prisma.budget.updateMany({ where: { id, userId: auth.id, isActive: true }, data: parsed.data });
    return updated.count ? ok({ id }, "Presupuesto actualizado.") : fail("Presupuesto no encontrado.", 404);
  } catch (error) { return internal(error); }
}
export const PUT = PATCH;
export async function DELETE(request: Request, ctx: Ctx) {
  try { const auth = await getAuthenticatedUser(request); if (!auth) return fail("No autorizado.", 401); const { id } = await ctx.params;
    const result = await prisma.budget.updateMany({ where: { id, userId: auth.id }, data: { isActive: false } });
    return result.count ? ok({ id }, "Presupuesto desactivado.") : fail("Presupuesto no encontrado.", 404);
  } catch (error) { return internal(error); }
}
