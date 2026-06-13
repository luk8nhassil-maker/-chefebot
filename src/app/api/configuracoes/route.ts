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
  const config: ConfigPizzaria = {
    nomePizzaria: body.nomePizzaria || CONFIG_PADRAO.nomePizzaria,
    horaAbertura: Number(body.horaAbertura) ?? CONFIG_PADRAO.horaAbertura,
    horaFechamento: Number(body.horaFechamento) ?? CONFIG_PADRAO.horaFechamento,
    chavePix: body.chavePix || "",
    nomeTitularPix: body.nomeTitularPix || "",
    limitePico: Number(body.limitePico) || 0,
    whatsappPizzaria: body.whatsappPizzaria || "",
    tempoEntregaDelivery: body.tempoEntregaDelivery || CONFIG_PADRAO.tempoEntregaDelivery,
    tempoEntregaRetirada: body.tempoEntregaRetirada || CONFIG_PADRAO.tempoEntregaRetirada,
  };
  await redis.set("config:pizzaria", config);
  return NextResponse.json({ ok: true, config });
}