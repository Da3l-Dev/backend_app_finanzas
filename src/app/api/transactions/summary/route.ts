import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";
import { toNumber } from "@/lib/money";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      { status: "error", message: "No autorizado." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  // Default: mes en curso
  const now = new Date();
  const start = from
    ? new Date(from)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = to
    ? new Date(to)
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const grouped = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: {
      userId: user.id,
      voidedAt: null,
      type: "EXPENSE",
      occurredAt: { gte: start, lte: end },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const categoryIds = grouped
    .map((g) => g.categoryId)
    .filter((id): id is string => !!id);

  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true, color: true, icon: true },
  });

  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const items = grouped.map((g) => ({
    categoryId: g.categoryId,
    category: g.categoryId ? (categoryMap.get(g.categoryId) ?? null) : null,
    total: toNumber(g._sum.amount),
    count: g._count._all,
  }));

  const grandTotal = items.reduce((sum, i) => sum + i.total, 0);

  return NextResponse.json({
    status: "ok",
    data: {
      from: start.toISOString(),
      to: end.toISOString(),
      total: grandTotal,
      items: items.sort((a, b) => b.total - a.total),
    },
  });
}
