import { NextResponse } from "next/server";

import { clearSessionCookie, deleteSession } from "../auth/session";

export async function POST(request: Request) {
  await deleteSession(request);

  const response = NextResponse.json({
    status: "ok",
    message: "Sesión cerrada correctamente.",
  });

  clearSessionCookie(response);

  return response;
}
