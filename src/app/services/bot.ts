import { Telegraf } from "telegraf";

// Función para obligar a que una variable exista antes de iniciar el bot.
function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta ${name} en el archivo .env`);
  }

  return value;
}

// Token que BotFather entregó para controlar el bot.
const telegramBotToken = getRequiredEnv("TELEGRAM_BOT_TOKEN");

// Clave interna que permite al bot comunicarse con tu API de Next.
// Debe ser exactamente la misma en bot.ts y en la API.
const botApiSecret = getRequiredEnv("BOT_API_SECRET");

// Dirección de la API.
// En desarrollo, Next.js corre normalmente en localhost:3000.
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";

// Creamos el bot.
const bot = new Telegraf(telegramBotToken);

// Se ejecuta cuando el usuario envía /start.
bot.start(async (ctx) => {
  // Si se abrió desde un enlace de vinculación, Telegram manda:
  // /start link_TOKEN_ALEATORIO
  const [, payload] = ctx.message.text.split(" ");

  if (payload?.startsWith("link_")) {
    const linkToken = payload.replace("link_", "");

    try {
      // El bot llama a Next.js desde tu computadora.
      const response = await fetch(`${apiBaseUrl}/api/telegram/link/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",

          // Clave que solo conoce tu bot y tu API.
          "x-bot-api-secret": botApiSecret,
        },
        body: JSON.stringify({
          token: linkToken,
          telegramUserId: String(ctx.from.id),
          chatId: String(ctx.chat.id),
          username: ctx.from.username ?? null,
          firstName: ctx.from.first_name ?? null,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        return ctx.reply(`❌ ${result.message}`);
      }

      return ctx.reply(
        "✅ Tu cuenta de Telegram quedó vinculada a Finanzas Seguras.\n\n" +
          "Ahora puedes escribirme algo como:\n" +
          "“Gasté 150 pesos en tacos”.",
      );
    } catch (error) {
      console.error("Error al vincular Telegram:", error);

      return ctx.reply(
        "❌ No pude vincular tu cuenta. Verifica que Next.js esté iniciado.",
      );
    }
  }

  // Mensaje normal cuando alguien abre el bot sin enlace.
  return ctx.reply(
    "¡Hola! 🤖\n\n" +
      "Para vincular tu cuenta, inicia sesión en Finanzas Seguras y usa la opción “Conectar Telegram”.",
  );
});

// Se ejecuta cuando el usuario escribe un mensaje normal.
bot.on("text", async (ctx) => {
  try {
    if (ctx.message.text.startsWith("/")) {
      return;
    }
    // Mandamos el texto a Next.js para que Groq lo interprete.
    const response = await fetch(`${apiBaseUrl}/api/transactions/parse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: ctx.message.text,
        telegramId: String(ctx.from.id),
        username: ctx.from.username ?? null,
        name: ctx.from.first_name,
        sentAt: new Date().toISOString(),
      }),
    });

    const result = await response.json();

    console.log("Respuesta de vinculación:", {
      status: response.status,
      result,
    });

    if (!response.ok || !result.ok) {
      return ctx.reply(
        `❌ No pude analizar el movimiento.\n${result.message ?? "Intenta nuevamente."}`,
      );
    }

    const analysis = result.data;

    // Saludo.
    if (analysis.intent === "GREETING") {
      return ctx.reply(
        "¡Hola! 👋\n\n" +
          "Puedo registrar gastos e ingresos, además de ayudarte a crear cuentas.",
      );
    }

    // Ayuda.
    if (analysis.intent === "HELP") {
      return ctx.reply(
        "Puedo ayudarte con:\n\n" +
          "• “Gasté 250 pesos en gasolina”\n" +
          "• “Me depositaron 4500 de quincena”\n" +
          "• “Quiero agregar una tarjeta de débito”\n" +
          "• “Quiero ver mis cuentas”",
      );
    }

    // Por ahora detectamos la solicitud.
    // Después aquí iniciaremos la conversación guiada de cuentas.
    if (analysis.intent === "CREATE_ACCOUNT") {
      return ctx.reply(
        "Perfecto, te ayudaré a crear una cuenta. 🏦\n\n" +
          "Escribe /nueva_cuenta para iniciar.",
      );
    }

    // Esta función se conectará a la consulta real de cuentas después.
    if (analysis.intent === "LIST_ACCOUNTS") {
      return ctx.reply(
        "Pronto te mostraré tus cuentas vinculadas. Por ahora puedes crear una con /nueva_cuenta.",
      );
    }

    // Si no se entendió el mensaje.
    if (
      analysis.intent === "UNKNOWN" ||
      analysis.intent !== "TRANSACTION" ||
      !analysis.transaction
    ) {
      return ctx.reply(
        "No entendí del todo tu mensaje. 🤔\n\n" +
          "Puedes escribir “ayuda” para ver ejemplos.",
      );
    }

    // Desde aquí sabemos que sí es un gasto o ingreso.
    const transaction = analysis.transaction;

    const typeLabel =
      transaction.type === "EXPENSE"
        ? "Gasto"
        : transaction.type === "INCOME"
          ? "Ingreso"
          : "No identificado";

    const categoryLabels: Record<string, string> = {
      FOOD: "Comida",
      TRANSPORT: "Transporte",
      HOUSING: "Vivienda",
      SERVICES: "Servicios",
      HEALTH: "Salud",
      ENTERTAINMENT: "Entretenimiento",
      SHOPPING: "Compras",
      SALARY: "Salario",
      FREELANCE: "Freelance",
      SAVINGS: "Ahorro",
      DEBT: "Deuda",
      OTHER: "Otro",
      OTHER_EXPENSE: "Otro gasto",
      OTHER_INCOME: "Otro ingreso",
    };

    const categoryLabel =
      categoryLabels[transaction.category] ?? transaction.category;

    // Si faltan datos, el bot no guarda ni confirma nada.
    if (transaction.needsConfirmation) {
      return ctx.reply(
        `🤔 Necesito más información.\n\n` +
          `Tipo: ${typeLabel}\n` +
          `Descripción: ${transaction.description}\n` +
          `Monto: ${transaction.amount ?? "No identificado"}\n` +
          `Categoría: ${categoryLabel}\n\n` +
          `Ejemplo: “Gasté 250 pesos en Amazon”.`,
      );
    }

    return ctx.reply(
      `✅ Movimiento detectado por IA\n\n` +
        `Tipo: ${typeLabel}\n` +
        `Monto: $${transaction.amount} ${transaction.currency}\n` +
        `Categoría: ${categoryLabel}\n` +
        `Descripción: ${transaction.description}\n` +
        `Confianza: ${Math.round(transaction.confidence * 100)}%\n\n` +
        `Por ahora es una prueba: aún no se guarda.`,
    );
  } catch (error) {
    console.error("Error al procesar mensaje:", error);

    return ctx.reply(
      "❌ Ocurrió un error al procesar tu mensaje. Verifica que Next.js esté iniciado.",
    );
  }
});

// Inicia el bot.
bot.launch().then(() => {
  console.log("🤖 Bot de Telegram iniciado correctamente.");
});

// Cierre correcto con Ctrl + C.
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
