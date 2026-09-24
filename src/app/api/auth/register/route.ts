import { RegisterUser } from "@/app/api/auth/auth.types";

export async function POST(req: Request) {
  try {
    const userData: RegisterUser = await req.json();

    return Response.json({ status: "ok", data: userData });
  } catch (error) {
    return Response.json(
      { status: "error", message: (error as Error).message },
      { status: 500 },
    );
  }
}
