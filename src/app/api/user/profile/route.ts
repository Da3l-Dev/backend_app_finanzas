import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { fail, internal, invalid, ok } from "@/lib/api-response";
import { Prisma } from "@prisma/client";
import { z } from "zod";

const schema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().max(80).nullish(),
  displayName: z.string().trim().max(100).nullish(),
  email: z.email().max(190).transform(v => v.trim().toLowerCase()).optional(),
}).strict();
const select = { id: true, firstName: true, lastName: true, displayName: true, email: true, phone: true, defaultCurrency: true, timezone: true, createdAt: true } as const;

export async function GET(request: Request) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return fail("Sesión no válida.", 401);
    const user = await prisma.user.findUnique({ where: { id: auth.id }, select });
    return user ? ok(user) : fail("Usuario no encontrado.", 404);
  } catch (error) { return internal(error); }
}
export async function PATCH(request: Request) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return fail("Sesión no válida.", 401);
    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    if (Object.keys(parsed.data).length === 0) return fail("No hay cambios para guardar.");
    const user = await prisma.user.update({ where: { id: auth.id }, data: parsed.data, select });
    return ok(user, "Perfil actualizado.");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return fail("El correo ya está registrado.", 409, { email: "Ya existe una cuenta con ese correo." });
    return internal(error);
  }
}
export const PUT = PATCH;
