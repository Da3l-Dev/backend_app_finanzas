import Groq from "groq-sdk";

const groqApiKey = process.env.GROQ_API_KEY;

if (!groqApiKey) {
  throw new Error("Falta GROQ_API_KEY en el archivo .env");
}

const groq = new Groq({
  apiKey: groqApiKey,
});

// Intenciones que el bot sabe reconocer.
export type TelegramIntent =
  | "GREETING"
  | "HELP"
  | "CREATE_ACCOUNT"
  | "LIST_ACCOUNTS"
  | "TRANSACTION"
  | "UNKNOWN";

export type TransactionAnalysis = {
  type: "EXPENSE" | "INCOME" | "UNKNOWN";
  amount: number | null;
  category:
    | "FOOD"
    | "TRANSPORT"
    | "SERVICES"
    | "HEALTH"
    | "ENTERTAINMENT"
    | "SHOPPING"
    | "OTHER_EXPENSE"
    | "SALARY"
    | "FREELANCE"
    | "OTHER_INCOME"
    | null;
  description: string;
  currency: "MXN";
  confidence: number;
  needsConfirmation: boolean;
};

export type TelegramAnalysis = {
  intent: TelegramIntent;
  transaction: TransactionAnalysis | null;
};

// Schema estricto que obliga a la IA a responder con JSON válido.
const telegramAnalysisSchema = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "GREETING",
        "HELP",
        "CREATE_ACCOUNT",
        "LIST_ACCOUNTS",
        "TRANSACTION",
        "UNKNOWN",
      ],
    },

    transaction: {
      type: ["object", "null"],
      properties: {
        type: {
          type: "string",
          enum: ["EXPENSE", "INCOME", "UNKNOWN"],
        },
        amount: {
          type: ["number", "null"],
        },
        category: {
          type: ["string", "null"],
          enum: [
            "FOOD",
            "TRANSPORT",
            "SERVICES",
            "HEALTH",
            "ENTERTAINMENT",
            "SHOPPING",
            "OTHER_EXPENSE",
            "SALARY",
            "FREELANCE",
            "OTHER_INCOME",
            null,
          ],
        },
        description: {
          type: "string",
        },
        currency: {
          type: "string",
          enum: ["MXN"],
        },
        confidence: {
          type: "number",
        },
        needsConfirmation: {
          type: "boolean",
        },
      },
      required: [
        "type",
        "amount",
        "category",
        "description",
        "currency",
        "confidence",
        "needsConfirmation",
      ],
      additionalProperties: false,
    },
  },
  required: ["intent", "transaction"],
  additionalProperties: false,
} as const;

export async function analyzeTelegramMessage(
  text: string,
): Promise<TelegramAnalysis> {
  const response = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",
    temperature: 0,

    messages: [
      {
        role: "system",
        content: `
Eres el clasificador de mensajes para un bot  de finanzas personales.

Primero identifica la intención del mensaje:

- GREETING: saludo, despedida o conversación simple.
- HELP: el usuario pregunta qué puede hacer el bot.
- CREATE_ACCOUNT: desea crear, agregar o registrar una cuenta, tarjeta o ahorro.
- LIST_ACCOUNTS: desea ver, consultar o listar sus cuentas.
- TRANSACTION: registra un ingreso o un gasto de dinero.
- UNKNOWN: no puedes identificar claramente la intención.

Solo usa TRANSACTION cuando el usuario realmente hable de gastar, pagar,
recibir, ganar o depositar dinero.

Para TRANSACTION:
- EXPENSE: dinero que el usuario gastó o pagó.
- INCOME: dinero que el usuario recibió, ganó o le depositaron.
- Usa MXN.
- No inventes montos.
- Si falta el monto, amount debe ser null y needsConfirmation true.
- Usa solo categorías permitidas.
- Si es un gasto sin categoría clara, usa OTHER_EXPENSE.
- Si es un ingreso sin categoría clara, usa OTHER_INCOME.
- La descripción debe ser corta.

Para GREETING, HELP, CREATE_ACCOUNT, LIST_ACCOUNTS o UNKNOWN:
- transaction debe ser null.
        `,
      },
      {
        role: "user",
        content: text,
      },
    ],

    response_format: {
      type: "json_schema",
      json_schema: {
        name: "telegram_finance_analysis",
        strict: true,
        schema: telegramAnalysisSchema,
      },
    },
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error("La IA no devolvió una respuesta.");
  }

  return JSON.parse(content) as TelegramAnalysis;
}
