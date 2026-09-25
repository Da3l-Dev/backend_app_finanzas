import argon2 from "argon2";
import { CategoryType, Prisma } from "@prisma/client";
import { defaultCategories } from "../types/types.categories";
import { prisma } from "@/lib/prisma";
import { RegisterUserSchema } from "@/app/api/auth/auth.validation";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // 1. Validamos el body con Zod.
    const validation = RegisterUserSchema.safeParse(body);

    if (!validation.success) {
      const errors = validation.error.issues.reduce<Record<string, string[]>>(
        (acc, issue) => {
          const field = String(issue.path[0] ?? "general");

          if (!acc[field]) {
            acc[field] = [];
          }

          acc[field].push(issue.message);

          return acc;
        },
        {},
      );

      return Response.json(
        {
          status: "error",
          message: "Revisa los campos marcados.",
          errors,
        },
        { status: 400 },
      );
    }

    // 2. Obtenemos datos que ya pasaron las validaciones.
    const userData = validation.data;

    // 3. Convertimos el teléfono a formato internacional.
    // Ejemplo: 7711234567 se guarda como +527711234567.
    const normalizedPhone = userData.phone
      ? parsePhoneNumberFromString(userData.phone, "MX")?.number
      : undefined;

    // 4. Revisamos primero si el correo ya está registrado.
    const existingEmail = await prisma.user.findUnique({
      where: {
        email: userData.email,
      },
      select: {
        id: true,
      },
    });

    if (existingEmail) {
      return Response.json(
        {
          status: "error",
          message: "No fue posible crear la cuenta.",
          errors: {
            email: ["Este correo electrónico ya está registrado."],
          },
        },
        { status: 409 },
      );
    }

    // 5. Si mandaron teléfono, verificamos que no pertenezca a alguien más.
    if (normalizedPhone) {
      const existingPhone = await prisma.user.findUnique({
        where: {
          phone: normalizedPhone,
        },
        select: {
          id: true,
        },
      });

      if (existingPhone) {
        return Response.json(
          {
            status: "error",
            message: "No fue posible crear la cuenta.",
            errors: {
              phone: ["Este número telefónico ya está registrado."],
            },
          },
          { status: 409 },
        );
      }
    }

    // 6. Convertimos la contraseña en un hash.
    // Nunca guardamos userData.password directamente en la base de datos.
    const passwordHash = await argon2.hash(userData.password, {
      type: argon2.argon2id,
    });

    // 7. Creamos el usuario y sus registros iniciales.
    // El create anidado se ejecuta como una sola operación:
    // si algo falla, no queda un usuario creado a medias.
    const user = await prisma.user.create({
      data: {
        email: userData.email,
        phone: normalizedPhone,
        passwordHash,
        firstName: userData.firstName,
        lastName: userData.lastName,
        displayName: userData.displayName ?? userData.firstName,
        avatarUrl: userData.avatarUrl,

        // Cuenta inicial para que el usuario pueda registrar gastos de inmediato.
        accounts: {
          create: {
            name: "Efectivo",
            type: "CASH",
            openingBalance: 0,
            isDefault: true,
            color: "#16A34A",
            icon: "wallet",
          },
        },

        // Categorías personales iniciales.
        categories: {
          create: defaultCategories,
        },
      },

      // Seleccionamos solo datos seguros para devolver al cliente.
      // passwordHash jamás debe salir de la API.
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        displayName: true,
        createdAt: true,
      },
    });

    return Response.json(
      {
        status: "ok",
        message: "Cuenta creada correctamente.",
        data: {
          user,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    // Esto cubre una posible carrera:
    // dos solicitudes intentan registrar el mismo email al mismo tiempo.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return Response.json(
        {
          status: "error",
          message: "No fue posible crear la cuenta.",
          errors: {
            general: ["El correo o teléfono ya se encuentra registrado."],
          },
        },
        { status: 409 },
      );
    }

    console.error("Error al registrar usuario:", error);

    return Response.json(
      {
        status: "error",
        message: "Ocurrió un error inesperado al crear la cuenta.",
      },
      { status: 500 },
    );
  }
}
