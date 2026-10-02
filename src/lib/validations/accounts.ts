// lib/validations/account.ts
import { AccountType } from "@prisma/client";
import { z } from "zod";

export const AccountTypeEnum = z.enum([
  "CASH",
  "CHECKING",
  "SAVINGS",
  "CREDIT_CARD",
  "INVESTMENT",
  "LOAN",
  "OTHER",
]);
// ⚠️ ajusta estos valores a los que tengas en tu schema.prisma

export const createAccountSchema = z.object({
  // obligatorios
  userId: z.string().uuid({ message: "userId debe ser un UUID válido" }),
  name: z
    .string()
    .min(1, "El nombre es obligatorio")
    .max(80, "Máximo 80 caracteres"),
  type: z.nativeEnum(AccountType),

  // opcionales
  institution: z.string().max(100).optional().nullable(),
  lastFourDigits: z
    .string()
    .regex(/^\d{4}$/, "Deben ser exactamente 4 dígitos")
    .optional()
    .nullable(),
  currency: z
    .string()
    .length(3, "La moneda debe ser un código ISO de 3 letras")
    .default("MXN"),
  openingBalance: z.number().finite().default(0),
  creditLimit: z
    .number()
    .positive("El límite de crédito debe ser positivo")
    .optional()
    .nullable(),
  color: z
    .string()
    .regex(/^#([0-9A-Fa-f]{6})$/, "Color HEX inválido (#RRGGBB)")
    .optional()
    .nullable(),
  icon: z.string().max(50).optional().nullable(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  includeInNetWorth: z.boolean().default(true),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
