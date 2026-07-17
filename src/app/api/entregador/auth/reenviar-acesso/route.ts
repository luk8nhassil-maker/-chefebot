import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import {
  criarTicketAcessoEntregador,
  entregadorIdValido,
  hashIdentificadorRateLimit,
  invalidarTicketAcesso,
  montarLinkAcessoEntregador,
  normalizarTelefoneEntregador,
  obterEntregadorAtivo,
} from "@/lib/entregadorAuth";
import { enviarTextoWhatsApp } from "@/lib/whatsappMensagem";

const RESPOSTA_GENERICA = {
  ok: true,
  message: "Se o cadastro estiver ativo, o novo acesso será enviado ao WhatsApp cadastrado.",
};

const RATE_LIMIT_LUA = `
if redis.call("EXISTS", KEYS[1]) == 1 or redis.call("EXISTS", KEYS[2]) == 1 then
  return 0
end
local idHour = tonumber(redis.call("GET", KEYS[3]) or "0")
local ipHour = tonumber(redis.call("GET", KEYS[4]) or "0")
if idHour >= tonumber(ARGV[1]) or ipHour >= tonumber(ARGV[2]) then
  return 0
end
redis.call("SET", KEYS[1], "1", "EX", 60)
redis.call("SET", KEYS[2], "1", "EX", 60)
local nextId = redis.call("INCR", KEYS[3])
if nextId == 1 then redis.call("EXPIRE", KEYS[3], 3600) end
local nextIp = redis.call("INCR", KEYS[4])
if nextIp == 1 then redis.call("EXPIRE", KEYS[4], 3600) end
return 1
`;

function obterIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "desconhecido"
  );
}

async function permitirReenvio(entregadorId: string, ip: string): Promise<boolean> {
  const idHash = hashIdentificadorRateLimit(entregadorId);
  const ipHash = hashIdentificadorRateLimit(ip);
  const result = await redis.eval(
    RATE_LIMIT_LUA,
    [
      `entregador:rate:reenviar:${idHash}:minuto`,
      `entregador:rate:ip:${ipHash}:minuto`,
      `entregador:rate:reenviar:${idHash}:hora`,
      `entregador:rate:ip:${ipHash}:hora`,
    ],
    ["5", "20"]
  );
  return Number(result) === 1;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const entregadorId = body?.entregadorId;
    if (!entregadorIdValido(entregadorId)) {
      return NextResponse.json(RESPOSTA_GENERICA);
    }

    if (!(await permitirReenvio(entregadorId, obterIp(req)))) {
      return NextResponse.json(RESPOSTA_GENERICA);
    }

    const entregador = await obterEntregadorAtivo(entregadorId);
    if (!entregador) return NextResponse.json(RESPOSTA_GENERICA);

    const { ticket } = await criarTicketAcessoEntregador(entregador.id);
    const resultado = await enviarTextoWhatsApp(
      normalizarTelefoneEntregador(entregador.telefone),
      `Seu acesso seguro à área de entregas foi atualizado.\n\nAcesse: ${montarLinkAcessoEntregador(ticket)}\n\nEste link é de uso único e expira em 24 horas.`
    );
    if (!resultado.ok) await invalidarTicketAcesso(ticket);
    return NextResponse.json(RESPOSTA_GENERICA);
  } catch {
    // Resposta pública invariável: falha de Redis/provider nunca revela se o
    // cadastro existe, telefone, ticket ou detalhe interno.
    return NextResponse.json(RESPOSTA_GENERICA);
  }
}
