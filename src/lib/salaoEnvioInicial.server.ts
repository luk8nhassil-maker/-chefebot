import { randomUUID } from "crypto";
import { redis } from "./redis";

const CLAIM_PREFIX = "salao:envio-inicial:v1:claim:";
const RESULT_PREFIX = "salao:envio-inicial:v1:result:";
const CLAIM_TTL_SEGUNDOS = 300;
const RESULT_TTL_SEGUNDOS = 7 * 24 * 60 * 60;

const LIBERAR_CLAIM_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export type ResultadoEnvioInicialSalao = {
  pedidoId: string;
  numero?: number;
  total: number;
  criadoEm: string;
};

export type ReivindicacaoEnvioInicial =
  | { ok: true; tipo: "resultado"; resultado: ResultadoEnvioInicialSalao }
  | { ok: true; tipo: "claim"; token: string }
  | { ok: false; motivo: "em_processamento" | "indisponivel" };

function claimKey(comandaId: string) {
  return `${CLAIM_PREFIX}${comandaId}`;
}

function resultKey(comandaId: string) {
  return `${RESULT_PREFIX}${comandaId}`;
}

function resultadoValido(valor: unknown): valor is ResultadoEnvioInicialSalao {
  if (!valor || typeof valor !== "object") return false;
  const item = valor as Partial<ResultadoEnvioInicialSalao>;
  return typeof item.pedidoId === "string"
    && item.pedidoId.length > 0
    && typeof item.total === "number"
    && Number.isFinite(item.total)
    && typeof item.criadoEm === "string";
}

export async function reivindicarEnvioInicialSalao(comandaId: string): Promise<ReivindicacaoEnvioInicial> {
  try {
    const existente = await redis.get<unknown>(resultKey(comandaId));
    if (resultadoValido(existente)) return { ok: true, tipo: "resultado", resultado: existente };

    const token = randomUUID();
    const adquirido = await redis.set(claimKey(comandaId), token, { nx: true, ex: CLAIM_TTL_SEGUNDOS });
    if (adquirido) return { ok: true, tipo: "claim", token };

    const resultadoAposConflito = await redis.get<unknown>(resultKey(comandaId));
    if (resultadoValido(resultadoAposConflito)) {
      return { ok: true, tipo: "resultado", resultado: resultadoAposConflito };
    }
    return { ok: false, motivo: "em_processamento" };
  } catch {
    // Estado do SET NX pode ser incerto em falha de rede. Nunca assume que é
    // seguro criar um pedido quando não consegue provar a posse do claim.
    return { ok: false, motivo: "indisponivel" };
  }
}

export async function confirmarEnvioInicialSalao(
  comandaId: string,
  token: string,
  resultado: ResultadoEnvioInicialSalao,
): Promise<void> {
  // Grava o resultado antes de liberar o claim. Se a marcação da comanda
  // falhar depois, qualquer retry recupera este mesmo pedido em vez de criar
  // outro. A comanda continua sendo apenas bookkeeping; o pedido oficial já
  // existe e é a fonte operacional da cozinha.
  await redis.set(resultKey(comandaId), resultado, { ex: RESULT_TTL_SEGUNDOS });
  try {
    await redis.eval(LIBERAR_CLAIM_LUA, [claimKey(comandaId)], [token]);
  } catch {
    // Resultado já está durável. O TTL do claim resolve eventual sobra.
  }
}

export async function liberarEnvioInicialSalao(comandaId: string, token: string): Promise<void> {
  try {
    await redis.eval(LIBERAR_CLAIM_LUA, [claimKey(comandaId)], [token]);
  } catch {
    // Best-effort. TTL curto garante recuperação sem abrir duplicidade.
  }
}
