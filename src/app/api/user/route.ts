import argon2 from "argon2";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { fail, internal, invalid, ok } from "@/lib/api-response";
import { z } from "zod";

// La baja es lógica. Conserva los datos contables para eventual recuperación legal.
export async function DELETE(request: Request) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return fail("Sesión no válida.", 401);
    const parsed = z.object({ password: z.string().min(1) }).strict().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error);
    const user = await prisma.user.findUnique({ where: { id: auth.id }, select: { passwordHash: true } });
    if (!user || !(await argon2.verify(user.passwordHash, parsed.data.password))) return fail("Contraseña incorrecta.", 400, { password: "Verifica tu contraseña." });
    await prisma.$transaction([
      prisma.user.update({ where: { id: auth.id }, data: { status: "DELETED", deletedAt: new Date() } }),
      prisma.session.deleteMany({ where: { userId: auth.id } }),
      prisma.telegramLinkToken.deleteMany({ where: { userId: auth.id } }),
    ]);
    return ok({ deleted: true }, "Cuenta desactivada. Se cerraron las sesiones.");
  } catch (error) { return internal(error); }
}
