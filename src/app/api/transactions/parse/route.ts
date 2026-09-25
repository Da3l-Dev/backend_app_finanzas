import { analyzeTelegramMessage } from "@/app/services/transaction-ia-service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const text = body.text;

    // Validamos que el bot mande texto.
    if (!text || typeof text !== "string") {
      return Response.json(
        {
          ok: false,
          message: "Debes enviar un texto para analizar.",
        },
        { status: 400 },
      );
    }

    // La IA detecta si es saludo, ayuda, cuenta, gasto o ingreso.
    const analysis = await analyzeTelegramMessage(text);

    return Response.json({
      ok: true,
      data: analysis,
    });
  } catch (error) {
    console.error("Error al analizar mensaje:", error);

    return Response.json(
      {
        ok: false,
        message: "No fue posible analizar el mensaje.",
      },
      { status: 500 },
    );
  }
}
