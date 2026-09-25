import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

const SESSION_COOKIE_NAME = "finanzas_session";
const SESSION_DURATION_DAYS = 30;

// Crea un token aleatorio para la sesión.
function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

// En la base de datos nunca guardamos el token original.
// Guardamos solamente su hash.
function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Crea una sesión nueva en la base de datos.
export async function createSession(userId: string) {
  const token = createSessionToken();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
    },
  });

  return {
    token,
    expiresAt,
  };
}

// Coloca el token en una cookie segura.
export function setSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

// Obtiene el token desde las cookies de una petición.
export function getSessionToken(request: Request) {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  const cookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${SESSION_COOKIE_NAME}=`));

  return cookie?.split("=")[1] ?? null;
}

// Busca al usuario dueño de la sesión.
export async function getAuthenticatedUser(request: Request) {
  const token = getSessionToken(request);

  if (!token) {
    return null;
  }

  const session = await prisma.session.findFirst({
    where: {
      tokenHash: hashSessionToken(token),
      expiresAt: {
        gt: new Date(),
      },
      user: {
        status: "ACTIVE",
        deletedAt: null,
      },
    },
    select: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          displayName: true,
        },
      },
    },
  });

  return session?.user ?? null;
}

// Elimina una sesión al cerrar sesión.
export async function deleteSession(request: Request) {
  const token = getSessionToken(request);

  if (token) {
    await prisma.session.deleteMany({
      where: {
        tokenHash: hashSessionToken(token),
      },
    });
  }
}

// Borra la cookie del navegador.
export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    maxAge: 0,
    path: "/",
  });
}
