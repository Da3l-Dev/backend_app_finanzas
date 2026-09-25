import * as z from "zod";
import { isValidPhoneNumber } from "libphonenumber-js/max";

// Esquema de los únicos datos que el usuario puede enviar al registrarse.
export const RegisterUserSchema = z
  .object({
    // trim() elimina espacios al inicio y al final.
    // toLowerCase() evita duplicados por mayúsculas.
    email: z
      .email("Ingresa un correo electrónico válido.")
      .trim()
      .toLowerCase(),

    // El teléfono se recibe como String, nunca como number.
    // Así no se pierden ceros, el símbolo + ni formatos internacionales.
    phone: z
      .string()
      .trim()
      .refine(
        (phone) => isValidPhoneNumber(phone, "MX"),
        "Ingresa un número telefónico válido.",
      )
      .optional(),

    // Esta es la contraseña original que llega desde el cliente.
    // Más adelante se convierte a passwordHash antes de guardarse.
    password: z
      .string()
      .min(8, "La contraseña debe tener mínimo 8 caracteres.")
      .max(100, "La contraseña es demasiado larga.")
      .regex(/[a-z]/, "La contraseña debe incluir una letra minúscula.")
      .regex(/[A-Z]/, "La contraseña debe incluir una letra mayúscula.")
      .regex(/[0-9]/, "La contraseña debe incluir un número."),

    firstName: z
      .string()
      .trim()
      .min(2, "El nombre debe tener mínimo 2 caracteres.")
      .max(60, "El nombre no puede superar 60 caracteres.")
      .regex(
        /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s'-]+$/,
        "El nombre solo puede contener letras.",
      ),

    lastName: z
      .string()
      .trim()
      .min(2, "El apellido debe tener mínimo 2 caracteres.")
      .max(60, "El apellido no puede superar 60 caracteres.")
      .regex(
        /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s'-]+$/,
        "El apellido solo puede contener letras.",
      )
      .optional(),

    displayName: z
      .string()
      .trim()
      .min(2, "El nombre visible debe tener mínimo 2 caracteres.")
      .max(60, "El nombre visible no puede superar 60 caracteres.")
      .optional(),

    avatarUrl: z.url("La foto de perfil debe ser una URL válida.").optional(),
  })
  // Impide que el cliente mande campos no permitidos, como role o status.
  .strict();

export const LoginSchema = z
  .object({
    email: z
      .email("Ingresa un correo electrónico válido.")
      .trim()
      .toLowerCase(),

    password: z.string().min(1, "La contraseña es obligatoria."),
  })
  .strict();

// Este type se genera automáticamente a partir de las validaciones.
// No tienes que escribirlo manualmente.
export type RegisterUser = z.infer<typeof RegisterUserSchema>;
