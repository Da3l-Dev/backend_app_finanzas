import argon2 from "argon2";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { LoginSchema } from "@/app/api/auth/auth.validation";
import { createSession, setSessionCookie } from "../session";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const validation = LoginSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          status: "error",
          message: "Revisa los datos enviados.",
          errors: validation.error.issues,
        },
        { status: 400 },
      );
    }

    const { email, password } = validation.data;

    // Buscamos solo usuarios activos.
    const user = await prisma.user.findFirst({
      where: {
        email,
        status: "ACTIVE",
        deletedAt: null,
      },
    });

    // Usamos el mismo mensaje para correo y contraseña incorrectos.
    // Así no revelamos si un correo está registrado.
    if (!user) {
      return NextResponse.json(
        {
          status: "error",
          message: "Correo o contraseña incorrectos.",
        },
        { status: 401 },
      );
    }

    const passwordMatches = await argon2.verify(user.passwordHash, password);

    if (!passwordMatches) {
      return NextResponse.json(
        {
          status: "error",
          message: "Correo o contraseña incorrectos.",
        },
        { status: 401 },
      );
    }

    // Creamos sesión segura.
    const session = await createSession(user.id);

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        lastLoginAt: new Date(),
      },
    });

    const response = NextResponse.json({
      status: "ok",
      message: "Inicio de sesión correcto.",
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          displayName: user.displayName,
        },
      },
    });

    // La cookie se manda al navegador automáticamente.
    setSessionCookie(response, session.token, session.expiresAt);

    return response;
  } catch (error) {
    console.error("Error al iniciar sesión:", error);

    return NextResponse.json(
      {
        status: "error",
        message: "No fue posible iniciar sesión.",
      },
      { status: 500 },
    );
  }
}
