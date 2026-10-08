import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { fail, internal, invalid, ok } from "@/lib/api-response";
import { goalSchema } from "@/lib/validations/goals";
export async function GET(request: Request) {
  try {
    const auth = await getAuthenticatedUser(request); if (!auth) return fail("No autorizado.", 401);
    const goals = await prisma.savingGoal.findMany({ where: { userId: auth.id, isArchived: false }, select: { id: true, name: true, description: true, targetAmount: true, targetDate: true, contributions: { select: { amount: true } } }, orderBy: { createdAt: "desc" } });
    return ok(goals.map(({ contributions, ...g }) => ({ ...g, targetAmount: Number(g.targetAmount), savedAmount: contributions.reduce((sum, c) => sum + Number(c.amount), 0) })));
  } catch (error) { return internal(error); }
}
export async function POST(request: Request) {
  try { const auth = await getAuthenticatedUser(request); if (!auth) return fail("No autorizado.", 401);
    const parsed = goalSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return invalid(parsed.error);
    const goal = await prisma.savingGoal.create({ data: { userId: auth.id, ...parsed.data, ...(parsed.data.targetDate ? { targetDate: new Date(parsed.data.targetDate) } : {}) }, select: { id: true } });
    return ok(goal, "Meta creada.", 201);
  } catch (error) { return internal(error); }
}
