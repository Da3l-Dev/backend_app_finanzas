import argon2 from "argon2";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { fail, internal, invalid, ok } from "@/lib/api-response";
import { z } from "zod";

const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) }).strict();
export async function PUT(request: Request) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return fail("Sesión no válida.", 401);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error);
    const user = await prisma.user.findUnique({ where: { id: auth.id }, select: { passwordHash: true } });
    if (!user || !(await argon2.verify(user.passwordHash, parsed.data.currentPassword))) return fail("La contraseña actual no es correcta.", 400, { currentPassword: "Contraseña incorrecta." });
    if (parsed.data.currentPassword === parsed.data.newPassword) return fail("Elige una contraseña diferente.");
    await prisma.$transaction([
      prisma.user.update({ where: { id: auth.id }, data: { passwordHash: await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id }) } }),
      // Cerrar otras sesiones después del cambio. La sesión actual también se revoca: volver a iniciar sesión.
      prisma.session.deleteMany({ where: { userId: auth.id } }),
    ]);
    return ok({ requiresLogin: true }, "Contraseña cambiada. Inicia sesión otra vez.");
  } catch (error) { return internal(error); }
}
export const PATCH = PUT;
