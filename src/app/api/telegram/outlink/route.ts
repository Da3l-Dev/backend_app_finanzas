import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "../../auth/session";

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json(
      { status: "error", message: "No autorizado." },
      { status: 401 },
    );
  }

  await prisma.$transaction([
    prisma.telegramProfile.deleteMany({ where: { userId: user.id } }),
    prisma.telegramConversation.deleteMany({ where: { userId: user.id } }),
  ]);

  return NextResponse.json({
    status: "ok",
    message: "Telegram desvinculado.",
  });
}
