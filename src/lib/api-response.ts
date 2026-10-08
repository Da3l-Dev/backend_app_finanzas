import { NextResponse } from "next/server";
import { z } from "zod";

// Contrato uniforme para endpoints nuevos y modificados.
export function ok<T>(data: T, message = "Operación realizada.", status = 200) {
  return NextResponse.json({ success: true, message, data }, { status, headers: { "Cache-Control": "private, no-store" } });
}
export function fail(message: string, status = 400, errors?: Record<string, string>) {
  return NextResponse.json({ success: false, message, ...(errors ? { errors } : {}) }, { status });
}
export function invalid(error: z.ZodError) {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "general");
    if (!errors[field]) errors[field] = issue.message;
  }
  return fail("Revisa los datos enviados.", 400, errors);
}
export function internal(error: unknown) {
  console.error("[API] Error interno:", error);
  return fail("Ocurrió un error interno. Intenta nuevamente.", 500);
}
