import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "../../auth/session";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json(
      { status: "error", message: "No autorizado." },
      { status: 401 },
    );
  }

  const profile = await prisma.telegramProfile.findUnique({
    where: { userId: user.id },
  });

  if (!profile) {
    return NextResponse.json({
      status: "ok",
      data: { linked: false },
    });
  }

  return NextResponse.json({
    status: "ok",
    data: {
      linked: true,
      username: profile.username,
      firstName: profile.firstName,
      linkedAt: profile.linkedAt,
    },
  });
}
