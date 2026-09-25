import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "../../auth/session";

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json(
      {
        status: "error",
        message: "Debes iniciar sesión para conectar Telegram.",
      },
      { status: 401 },
    );
  }

  const botUsername = process.env.TELEGRAM_BOT_USERNAME;

  if (!botUsername) {
    return NextResponse.json(
      {
        status: "error",
        message: "TELEGRAM_BOT_USERNAME no está configurado.",
      },
      { status: 500 },
    );
  }

  // Genera un token seguro, válido durante 10 minutos.
  const token = randomBytes(24).toString("base64url");

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10);

  // Quitamos solicitudes de enlace anteriores sin usar.
  await prisma.$transaction([
    prisma.telegramLinkToken.deleteMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
    }),

    prisma.telegramLinkToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    }),
  ]);

  return NextResponse.json({
    status: "ok",
    message: "Enlace de Telegram generado.",
    data: {
      telegramUrl: `https://t.me/${botUsername}?start=link_${token}`,
      expiresAt,
    },
  });
}
