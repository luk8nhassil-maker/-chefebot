import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { verifyToken } from "@/lib/auth";

export type ConfigPizzaria = {
  nomePizzaria: string;
  horaAbertura: number;
  horaFechamento: number;
  chavePix: string;
  nomeTitularPix: string;
  limitePico: number;
  whatsappPizzaria: string;
  tempoEntregaDelivery: string;
  tempoEntregaRetirada: string;
  // campos do onboarding
  endereco?: string;
  aceitaDinheiro?: boolean;
  aceitaCartao?: boolean;
  temMotoboy?: boolean;
  fazDelivery?: boolean;
  aceitaRetirada?: boolean;
};

const CONFIG_PADRAO: ConfigPizzaria = {
  nomePizzaria: "Chefe da Pizza",
  horaAbertura: 18,
  horaFechamento: 23,
  chavePix: "",
  nomeTitularPix: "",
  limitePico: 0,
  whatsappPizzaria: "",
  tempoEntregaDelivery: "40-60 minutos",
  tempoEntregaRetirada: "20-30 minutos",
};

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "atendente", "dev"].includes(payload.role as string)) return null;
  return payload;
}

export async function GET(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const config = await redis.get<ConfigPizzaria>("config:pizzaria") ?? CONFIG_PADRAO;
  if (auth.role !== "admin" && auth.role !== "dev") {
    const { chavePix, nomeTitularPix, ...resto } = config;
    return NextResponse.json(resto);
  }
  return NextResponse.json(config);
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const podeEditarPix = auth.role === "admin" || auth.role === "dev";
  const body = await req.json();
  const existing = await redis.get<ConfigPizzaria>("config:pizzaria");
  const config: ConfigPizzaria = {
    ...existing,
    nomePizzaria: body.nomePizzaria || CONFIG_PADRAO.nomePizzaria,
    horaAbertura: Number(body.horaAbertura) ?? CONFIG_PADRAO.horaAbertura,
    horaFechamento: Number(body.horaFechamento) ?? CONFIG_PADRAO.horaFechamento,
    // atendente nao pode alterar dados de Pix: preserva o valor ja salvo, ignorando o body
    chavePix: podeEditarPix ? (body.chavePix || "") : (existing?.chavePix ?? ""),
    nomeTitularPix: podeEditarPix ? (body.nomeTitularPix || "") : (existing?.nomeTitularPix ?? ""),
    limitePico: Number(body.limitePico) || 0,
    whatsappPizzaria: body.whatsappPizzaria || "",
    tempoEntregaDelivery: body.tempoEntregaDelivery || CONFIG_PADRAO.tempoEntregaDelivery,
    tempoEntregaRetirada: body.tempoEntregaRetirada || CONFIG_PADRAO.tempoEntregaRetirada,
    ...(body.endereco !== undefined && { endereco: body.endereco }),
    ...(body.aceitaDinheiro !== undefined && { aceitaDinheiro: Boolean(body.aceitaDinheiro) }),
    ...(body.aceitaCartao !== undefined && { aceitaCartao: Boolean(body.aceitaCartao) }),
    ...(body.temMotoboy !== undefined && { temMotoboy: Boolean(body.temMotoboy) }),
    ...(body.fazDelivery !== undefined && { fazDelivery: Boolean(body.fazDelivery) }),
    ...(body.aceitaRetirada !== undefined && { aceitaRetirada: Boolean(body.aceitaRetirada) }),
  };
  await redis.set("config:pizzaria", config);
  if (!podeEditarPix) {
    const { chavePix, nomeTitularPix, ...resto } = config;
    return NextResponse.json({ ok: true, config: resto });
  }
  return NextResponse.json({ ok: true, config });
}

export async function PATCH(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const body = await req.json();
  const horaAbertura = Number(body.horaAbertura);
  const horaFechamento = Number(body.horaFechamento);
  const horarioValido =
    Number.isInteger(horaAbertura) &&
    Number.isInteger(horaFechamento) &&
    horaAbertura >= 0 &&
    horaAbertura <= 23 &&
    horaFechamento >= 1 &&
    horaFechamento <= 24 &&
    horaAbertura < horaFechamento;

  if (!horarioValido) {
    return NextResponse.json({ error: "Horario de funcionamento invalido" }, { status: 400 });
  }

  const existing = await redis.get<ConfigPizzaria>("config:pizzaria") ?? CONFIG_PADRAO;
  const config: ConfigPizzaria = { ...existing, horaAbertura, horaFechamento };
  await redis.set("config:pizzaria", config);
  return NextResponse.json({ ok: true, config });
}
