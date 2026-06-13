import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

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

export async function GET() {
  const config = await redis.get<ConfigPizzaria>("config:pizzaria");
  return NextResponse.json(config ?? CONFIG_PADRAO);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const existing = await redis.get<ConfigPizzaria>("config:pizzaria");
  const config: ConfigPizzaria = {
    ...existing,
    nomePizzaria: body.nomePizzaria || CONFIG_PADRAO.nomePizzaria,
    horaAbertura: Number(body.horaAbertura) ?? CONFIG_PADRAO.horaAbertura,
    horaFechamento: Number(body.horaFechamento) ?? CONFIG_PADRAO.horaFechamento,
    chavePix: body.chavePix || "",
    nomeTitularPix: body.nomeTitularPix || "",
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
  return NextResponse.json({ ok: true, config });
}