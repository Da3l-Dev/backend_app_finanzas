import { z } from "zod";

export const ACCOUNT_TYPES = [
  "CASH",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "SAVINGS",
  "INVESTMENT",
] as const;

export const createAccountSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "El nombre debe tener al menos 2 caracteres.")
      .max(40, "El nombre es demasiado largo."),
    type: z.enum(ACCOUNT_TYPES),
    currency: z.string().length(3).optional().default("MXN"),

    // Solo aplica a CASH, DEBIT_CARD, SAVINGS, INVESTMENT
    openingBalance: z
      .number()
      .nonnegative("El saldo no puede ser negativo.")
      .optional()
      .default(0),

    // Solo aplica a CREDIT_CARD
    creditLimit: z
      .number()
      .positive("El límite debe ser mayor a 0.")
      .optional(),

    // Solo aplica a DEBIT_CARD y CREDIT_CARD
    institution: z.string().trim().max(40).optional(),
    lastFourDigits: z
      .string()
      .regex(/^\d{4}$/, "Deben ser exactamente 4 dígitos.")
      .optional(),

    color: z.string().max(20).nullable().optional(),
    icon: z.string().max(50).nullish(),
    isDefault: z.boolean().optional(),
    includeInNetWorth: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    // Tarjeta de crédito requiere límite
    if (data.type === "CREDIT_CARD" && !data.creditLimit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creditLimit"],
        message: "Las tarjetas de crédito requieren un límite.",
      });
    }

    // Efectivo no tiene institución ni últimos 4
    if (data.type === "CASH" && (data.institution || data.lastFourDigits)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["institution"],
        message: "El efectivo no tiene institución ni dígitos.",
      });
    }

    // Débito y crédito requieren institución
    if (
      (data.type === "DEBIT_CARD" || data.type === "CREDIT_CARD") &&
      !data.institution
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["institution"],
        message: "Indica la institución (BBVA, Banorte, etc).",
      });
    }
  });

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
