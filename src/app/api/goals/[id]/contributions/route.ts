import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { fail, internal, invalid, ok } from "@/lib/api-response";
type Ctx = { params: Promise<{ id: string }> };
export async function POST(request: Request, ctx: Ctx) {
  try {
    const auth = await getAuthenticatedUser(request); if (!auth) return fail("No autorizado.", 401);
    const { id } = await ctx.params;
    const parsed = z.object({ amount: z.number().positive().max(999999999), note: z.string().max(250).optional() }).strict().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error);
    const goal = await prisma.savingGoal.findFirst({ where: { id, userId: auth.id, isArchived: false }, select: { id: true, name: true } });
    if (!goal) return fail("Meta no encontrada.", 404);
    // Un apartado es una asignación virtual, no un retiro del saldo bancario.
    const contribution = await prisma.$transaction(async tx => {
      const transaction = await tx.transaction.create({ data: { userId: auth.id, type: "ADJUSTMENT", status: "POSTED", origin: "SYSTEM", amount: parsed.data.amount, description: `Apartado para ${goal.name}` }, select: { id: true } });
      return tx.goalContribution.create({ data: { goalId: goal.id, transactionId: transaction.id, amount: parsed.data.amount, note: parsed.data.note ?? null }, select: { id: true, amount: true } });
    });
    return ok({ id: contribution.id, amount: Number(contribution.amount) }, "Apartado registrado (no mueve dinero entre cuentas).", 201);
  } catch (error) { return internal(error); }
}
