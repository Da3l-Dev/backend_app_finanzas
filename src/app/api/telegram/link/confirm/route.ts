import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    // Esta ruta solo puede ser llamada desde tu bot.
    const botSecret = request.headers.get("x-bot-api-secret");

    if (!botSecret || botSecret !== process.env.BOT_API_SECRET) {
      return NextResponse.json(
        {
          status: "error",
          message: "No autorizado.",
        },
        { status: 401 },
      );
    }

    const body = await request.json();

    const { token, telegramUserId, chatId, username, firstName } = body;

    if (!token || !telegramUserId || !chatId) {
      return NextResponse.json(
        {
          status: "error",
          message: "Faltan datos para vincular Telegram.",
        },
        { status: 400 },
      );
    }

    await prisma.$transaction(
      async (tx) => {
        const linkToken = await tx.telegramLinkToken.findUnique({
          where: {
            token,
          },
        });

        if (
          !linkToken ||
          linkToken.usedAt ||
          linkToken.expiresAt <= new Date()
        ) {
          throw new Error("TOKEN_INVALID");
        }

        const existingTelegram = await tx.telegramProfile.findFirst({
          where: {
            OR: [
              { telegramUserId: String(telegramUserId) },
              { chatId: String(chatId) },
            ],
          },
        });

        if (existingTelegram && existingTelegram.userId !== linkToken.userId) {
          throw new Error("TELEGRAM_ALREADY_LINKED");
        }

        await tx.telegramProfile.upsert({
          where: {
            userId: linkToken.userId,
          },
          create: {
            userId: linkToken.userId,
            telegramUserId: String(telegramUserId),
            chatId: String(chatId),
            username: username ?? null,
            firstName: firstName ?? null,
          },
          update: {
            telegramUserId: String(telegramUserId),
            chatId: String(chatId),
            username: username ?? null,
            firstName: firstName ?? null,
            linkedAt: new Date(),
          },
        });

        await tx.telegramLinkToken.update({
          where: {
            id: linkToken.id,
          },
          data: {
            usedAt: new Date(),
          },
        });
      },

      // Tiempos en milisegundos.
      // Le damos más margen a Neon y Prisma.
      {
        maxWait: 10_000,
        timeout: 20_000,
      },
    );
    return NextResponse.json({
      status: "ok",
      message: "Telegram vinculado correctamente.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (message === "TOKEN_INVALID") {
      return NextResponse.json(
        {
          status: "error",
          message: "El enlace expiró o ya fue utilizado.",
        },
        { status: 400 },
      );
    }

    if (message === "TELEGRAM_ALREADY_LINKED") {
      return NextResponse.json(
        {
          status: "error",
          message: "Esta cuenta de Telegram ya está vinculada.",
        },
        { status: 409 },
      );
    }

    console.error("Error al vincular Telegram:", error);

    return NextResponse.json(
      {
        status: "error",
        message: "No fue posible vincular Telegram.",
        error,
      },
      { status: 500 },
    );
  }
}
