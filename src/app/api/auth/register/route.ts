import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import { defaultCategories } from "../types/types.categories";
import { prisma } from "@/lib/prisma";
import { RegisterUserSchema } from "@/app/api/auth/auth.validation";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { createSession } from "../session"; // 👈 NUEVO

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const validation = RegisterUserSchema.safeParse(body);

    if (!validation.success) {
      const errors = validation.error.issues.reduce<Record<string, string[]>>(
        (acc, issue) => {
          const field = String(issue.path[0] ?? "general");
          if (!acc[field]) acc[field] = [];
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

    const userData = validation.data;

    const normalizedPhone = userData.phone
      ? parsePhoneNumberFromString(userData.phone, "MX")?.number
      : undefined;

    const existingEmail = await prisma.user.findUnique({
      where: { email: userData.email },
      select: { id: true },
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

    if (normalizedPhone) {
      const existingPhone = await prisma.user.findUnique({
        where: { phone: normalizedPhone },
        select: { id: true },
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

    const passwordHash = await argon2.hash(userData.password, {
      type: argon2.argon2id,
    });

    const user = await prisma.user.create({
      data: {
        email: userData.email,
        phone: normalizedPhone,
        passwordHash,
        firstName: userData.firstName,
        lastName: userData.lastName,
        displayName: userData.displayName ?? userData.firstName,
        avatarUrl: userData.avatarUrl,

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

        categories: {
          create: defaultCategories,
        },
      },
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

    // 👇 NUEVO: creamos sesión y devolvemos token en el body
    const session = await createSession(user.id);

    return Response.json(
      {
        status: "ok",
        message: "Cuenta creada correctamente.",
        data: {
          user,
          token: session.token,
          expiresAt: session.expiresAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
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
