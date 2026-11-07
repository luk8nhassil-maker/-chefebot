import { NextRequest, NextResponse } from "next/server";
import { buildPizzaCatalog } from "@/lib/catalog/pizzas";
import { buildSimpleCatalog } from "@/lib/catalog/simpleProducts";
import { getMENUDinamico } from "@/lib/menu.server";
import { obterEsgotadosEfetivos, obterEstoqueItens } from "@/lib/estoque";
import { redis } from "@/lib/redis";
import { emPreviewVercel } from "@/lib/previewSafety";
import { verificarMetaBusinessAgentConnector } from "@/lib/metaBusinessAgentConnector";

export const dynamic = "force-dynamic";

const TIME_ZONE = "America/Sao_Paulo";
const DEFAULT_HOURS = { opening: 18, closing: 23 };

function asClock(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function isValidHour(value: unknown, allowMidnightEnd = false): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= (allowMidnightEnd ? 24 : 23);
}

function isOpenNow(openingHour: number, closingHour: number): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date()));
  return hour >= openingHour && hour < closingHour;
}

export async function GET(req: NextRequest) {
  // Preview pode apontar para Redis de produção. Bloquear sempre até haver
  // uma fonte de dados de teste comprovadamente isolada.
  if (emPreviewVercel()) {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const auth = verificarMetaBusinessAgentConnector(req.headers.get("authorization"));
  if (auth === "disabled") {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (auth === "invalid_configuration") {
    return NextResponse.json({ ok: false, error: "connector_not_configured" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const menu = await getMENUDinamico();
    const [esgotados, estoqueItens, config] = await Promise.all([
      obterEsgotadosEfetivos(menu),
      obterEstoqueItens(),
      redis.get<{ horaAbertura?: number; horaFechamento?: number }>("config:pizzaria"),
    ]);
    const openingHour = config?.horaAbertura ?? DEFAULT_HOURS.opening;
    const closingHour = config?.horaFechamento ?? DEFAULT_HOURS.closing;
    if (!isValidHour(openingHour) || !isValidHour(closingHour, true) || closingHour <= openingHour) {
      throw new Error("invalid_operating_hours");
    }
    if (!Array.isArray(menu.neighborhoods) || menu.neighborhoods.some((area) =>
      typeof area.name !== "string" || !area.name.trim() ||
      typeof area.fee !== "number" || !Number.isFinite(area.fee) || area.fee < 0
    )) {
      throw new Error("invalid_delivery_areas");
    }

    const esgotadosIds = Object.values(estoqueItens)
      .filter((item) => item.esgotado)
      .map((item) => item.id);

    return NextResponse.json({
      businessName: "Chefe da Pizza",
      currency: "BRL",
      priceUnit: "centavos",
      generatedAt: new Date().toISOString(),
      operatingHours: {
        timeZone: TIME_ZONE,
        openingTime: asClock(openingHour),
        closingTime: asClock(closingHour),
        openNow: isOpenNow(openingHour, closingHour),
      },
      pizzaCatalog: buildPizzaCatalog(menu, esgotados, esgotadosIds),
      productCatalog: buildSimpleCatalog(menu, esgotados, esgotadosIds, "public"),
      deliveryAreas: menu.neighborhoods.map((area) => ({
        name: area.name,
        feeCents: Math.round(area.fee * 100),
      })),
    }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Authorization",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "catalog_unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
