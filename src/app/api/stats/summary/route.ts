import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/app/api/auth/session";

type Period = "HOY" | "SEMANA" | "MES" | "AÑO";

// ═══════════════════════════════════════════════════════════════
// Rangos por periodo (ventana rodante)
// ═══════════════════════════════════════════════════════════════
function getRanges(period: Period) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  let start = new Date(now);
  let prevEnd = new Date(now);
  let prevStart = new Date(now);
  let dayCount = 1;

  switch (period) {
    case "HOY":
      start.setHours(0, 0, 0, 0);
      dayCount = 1;
      break;
    case "SEMANA":
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      dayCount = 7;
      break;
    case "MES":
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      dayCount = 30;
      break;
    case "AÑO":
      start.setDate(start.getDate() - 364);
      start.setHours(0, 0, 0, 0);
      dayCount = 365;
      break;
  }

  prevEnd = new Date(start);
  prevEnd.setMilliseconds(-1);
  prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (dayCount - 1));
  prevStart.setHours(0, 0, 0, 0);

  return { start, end, prevStart, prevEnd, dayCount };
}

// ═══════════════════════════════════════════════════════════════
// Buckets para la gráfica temporal
// ═══════════════════════════════════════════════════════════════
type Bucket = {
  label: string;
  start: Date;
  end: Date;
  isCurrent: boolean;
};

function buildBuckets(period: Period, now: Date): Bucket[] {
  const buckets: Bucket[] = [];

  if (period === "HOY") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    for (let i = 0; i < 6; i++) {
      const bStart = new Date(start);
      bStart.setHours(i * 4, 0, 0, 0);
      const bEnd = new Date(bStart);
      bEnd.setHours(bStart.getHours() + 4);
      const isCurrent = now >= bStart && now < bEnd;
      buckets.push({
        label: `${i * 4}h`,
        start: bStart,
        end: bEnd,
        isCurrent,
      });
    }
  } else if (period === "SEMANA") {
    const dayNames = ["D", "L", "M", "X", "J", "V", "S"];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const bEnd = new Date(d);
      bEnd.setDate(bEnd.getDate() + 1);
      buckets.push({
        label: dayNames[d.getDay()],
        start: d,
        end: bEnd,
        isCurrent: i === 0,
      });
    }
  } else if (period === "MES") {
    // 5 buckets de 6 días
    for (let i = 0; i < 5; i++) {
      const daysAgo = 29 - i * 6;
      const bStart = new Date(now);
      bStart.setDate(bStart.getDate() - daysAgo);
      bStart.setHours(0, 0, 0, 0);
      const bEnd = new Date(bStart);
      bEnd.setDate(bEnd.getDate() + 6);
      buckets.push({
        label: `S${i + 1}`,
        start: bStart,
        end: bEnd,
        isCurrent: i === 4,
      });
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const bStart = new Date(d);
      const bEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const label = d
        .toLocaleDateString("es-MX", { month: "short" })
        .slice(0, 1)
        .toUpperCase();
      buckets.push({
        label,
        start: bStart,
        end: bEnd,
        isCurrent: i === 0,
      });
    }
  }

  return buckets;
}

// ═══════════════════════════════════════════════════════════════
// Handler
// ═══════════════════════════════════════════════════════════════
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "No autorizado." },
        { status: 401 },
      );
    }

    const url = new URL(request.url);
    const rawPeriod = (url.searchParams.get("period") ?? "MES").toUpperCase();
    const period: Period =
      rawPeriod === "HOY" ||
      rawPeriod === "SEMANA" ||
      rawPeriod === "MES" ||
      rawPeriod === "AÑO"
        ? (rawPeriod as Period)
        : "MES";

    const now = new Date();
    const { start, end, prevStart, prevEnd, dayCount } = getRanges(period);

    // ─── Queries en paralelo ─────────────────────
    const [current, previous, categories] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          userId: user.id,
          voidedAt: null,
          occurredAt: { gte: start, lte: end },
        },
        select: {
          id: true,
          type: true,
          amount: true,
          occurredAt: true,
          categoryId: true,
          description: true,
        },
      }),
      prisma.transaction.findMany({
        where: {
          userId: user.id,
          voidedAt: null,
          occurredAt: { gte: prevStart, lte: prevEnd },
        },
        select: { type: true, amount: true },
      }),
      prisma.category.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, icon: true, color: true, type: true },
      }),
    ]);

    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    // ─── Totales ─────────────────────────────────
    let totalGastado = 0;
    let totalIngresado = 0;
    let numTransacciones = 0;
    let gastoMasAlto = { monto: 0, descripcion: "" };

    for (const t of current) {
      const amt = Number(t.amount);
      if (t.type === "EXPENSE") {
        totalGastado += amt;
        numTransacciones += 1;
        if (amt > gastoMasAlto.monto) {
          const catName = t.categoryId
            ? (categoryMap.get(t.categoryId)?.name ?? "")
            : "";
          gastoMasAlto = {
            monto: amt,
            descripcion: catName || t.description || "Sin categoría",
          };
        }
      } else if (t.type === "INCOME") {
        totalIngresado += amt;
      }
    }

    let prevGastado = 0;
    for (const t of previous) {
      if (t.type === "EXPENSE") prevGastado += Number(t.amount);
    }

    const cambioPorcentaje =
      prevGastado > 0
        ? ((totalGastado - prevGastado) / prevGastado) * 100
        : totalGastado > 0
          ? 100
          : 0;

    const promedioDiario = totalGastado / dayCount;

    // ─── Categorías (top) ────────────────────────
    const catAgg = new Map<string, { total: number; count: number }>();

    for (const t of current) {
      if (t.type !== "EXPENSE") continue;
      const key = t.categoryId ?? "__none__";
      const prev = catAgg.get(key) ?? { total: 0, count: 0 };
      catAgg.set(key, {
        total: prev.total + Number(t.amount),
        count: prev.count + 1,
      });
    }

    const categorias = [...catAgg.entries()]
      .map(([catId, data]) => {
        const cat = catId === "__none__" ? null : categoryMap.get(catId);
        return {
          categoryId: catId,
          nombre: cat?.name ?? "Sin categoría",
          icon: cat?.icon ?? "shape",
          color: cat?.color ?? null,
          total: data.total,
          count: data.count,
        };
      })
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    // ─── Buckets temporales ──────────────────────
    const rawBuckets = buildBuckets(period, now);

    const barras = rawBuckets.map((b) => {
      let monto = 0;
      for (const t of current) {
        if (t.type !== "EXPENSE") continue;
        if (t.occurredAt >= b.start && t.occurredAt < b.end) {
          monto += Number(t.amount);
        }
      }
      return {
        label: b.label,
        monto,
        esActual: b.isCurrent,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        period,
        start: start.toISOString(),
        end: end.toISOString(),
        totalGastado,
        totalIngresado,
        cambioPorcentaje: Number(cambioPorcentaje.toFixed(1)),
        promedioDiario,
        gastoMasAlto,
        numTransacciones,
        categorias,
        barras,
      },
    });
  } catch (error) {
    console.error("Error en stats summary:", error);
    return NextResponse.json(
      { success: false, message: "No se pudieron cargar las estadísticas." },
      { status: 500 },
    );
  }
}
