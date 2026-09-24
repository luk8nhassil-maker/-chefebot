import { derivarResearchCustomerKey } from "./pesquisaPreferenciaContatosRedis";
import { redis } from "./redis";

export type RegistroOptOutPesquisa = {
  optOut: true;
  registradoEmMs: number;
};

function chaveOptOutPesquisa(customerKey: string): string {
  return `pesquisa:optout:v1:${customerKey}`;
}

/**
 * Registra somente a decisão de não receber pesquisas.
 * A chave usa a identidade derivada/hash do namespace de pesquisa e o valor
 * não contém telefone, nome, endereço ou qualquer outro PII em texto aberto.
 *
 * Não há expiração automática: um opt-out não volta a ser opt-in por TTL.
 */
export async function registrarOptOutPesquisa(params: {
  telefone?: string;
  registradoEmMs?: number;
}): Promise<boolean> {
  const customerKey = derivarResearchCustomerKey(params.telefone);
  const registradoEmMs = params.registradoEmMs ?? Date.now();

  if (!customerKey || !Number.isFinite(registradoEmMs) || registradoEmMs <= 0) {
    return false;
  }

  await redis.set<RegistroOptOutPesquisa>(
    chaveOptOutPesquisa(customerKey),
    { optOut: true, registradoEmMs }
  );
  return true;
}

/**
 * Consulta read-only do opt-out. Identidade inválida não é tratada como opt-in;
 * o gate completo também marca essa identidade como incerta e permanece fechado.
 */
export async function clienteTemOptOutPesquisa(telefone?: string): Promise<boolean> {
  const customerKey = derivarResearchCustomerKey(telefone);
  if (!customerKey) return false;

  const registro = await redis.get<RegistroOptOutPesquisa>(
    chaveOptOutPesquisa(customerKey)
  );
  return registro?.optOut === true;
}
