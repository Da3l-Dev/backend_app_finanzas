export async function POST(req: Request) {
  try {
    const data = await req.json();

    console.log("Mensaje Recibido desde telegram:", data);

    return Response.json({ status: "La Api de next recibio el mensaje", data });
  } catch (error) {
    return Response.json(
      { status: "error", message: (error as Error).message },
      { status: 500 },
    );
  }
}
