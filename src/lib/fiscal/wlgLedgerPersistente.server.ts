/**
 * Persistência ATÔMICA do registro fiscal para futura integração WLG.
 * Não envia NFC-e. Nenhuma rota HTTP chama este módulo até existir
 * autenticação multiempresa, contrato Swagger e credenciamento fiscal.
 *
 * Redis SET NX reserva de forma durável; EVAL só altera uma versão exata.
 * NUNCA expira a chave sozinho: perda do registro pode gerar nota dupla.
 */
import { redis } from "@/lib/redis";
import { bloquearOperacaoRealEmPreview } from "@/lib/previewSafety";
import {
  aplicarResultadoConsulta, chaveFiscal, marcarEnvioIncerto,
  registrarOperationId, reservarRegistroFiscal, type RegistroFiscal,
} from "./wlgLedger";
import type { WlgStatus } from "./wlgConsulta.server";

export type RegistroFiscalVersionado = Readonly<{
  versao: number;
  registro: RegistroFiscal;
}>;

export type EventoFiscal =
  | Readonly<{ tipo: "antes_do_envio" }>
  | Readonly<{ tipo: "protocolo_recebido"; operationId: string }>
  | Readonly<{ tipo: "resultado"; status: WlgStatus }>;

const LUA_CAS = [
  "local atual = redis.call('GET', KEYS[1])",
  "if not atual then return 0 end",
  "local sucesso, decodificado = pcall(cjson.decode, atual)",
  "if not sucesso or type(decodificado) ~= 'table' then return 0 end",
  "if tonumber(decodificado.versao) ~= tonumber(ARGV[1]) then return 0 end",
  "redis.call('SET', KEYS[1], ARGV[2])",
  "return 1",
].join("\n");

function valido(registro: RegistroFiscal): boolean {
  try {
    return registro.chave === chaveFiscal(registro.tenantId, registro.contaId) &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(registro.empresaId);
  } catch { return false; }
}

export async function reservarFiscalAtomico(
  tenantServidor: string,
  contaFinalId: string,
  empresaIdServidor: string,
): Promise<RegistroFiscalVersionado | null> {
  bloquearOperacaoRealEmPreview("fiscal_ledger");
  const registro = reservarRegistroFiscal(null, tenantServidor, contaFinalId, empresaIdServidor);
  if (!registro || !valido(registro)) throw new Error("Reserva fiscal inválida");
  const versao = { versao: 1, registro };
  // Uma requisição concorrente nunca pode sobrescrever a primeira tentativa.
  const resultado = await redis.set(registro.chave, versao, { nx: true });
  return resultado === "OK" ? versao : null;
}

export async function lerFiscalAtomico(
  tenantServidor: string,
  contaFinalId: string,
): Promise<RegistroFiscalVersionado | null> {
  bloquearOperacaoRealEmPreview("fiscal_ledger");
  const chave = chaveFiscal(tenantServidor, contaFinalId);
  const atual = await redis.get<RegistroFiscalVersionado>(chave);
  if (!atual) return null;
  if (!Number.isSafeInteger(atual.versao) || atual.versao <= 0 ||
      !valido(atual.registro) || atual.registro.chave !== chave)
    throw new Error("Registro fiscal inconsistente; nenhuma nota será reenviada");
  return atual;
}

function aplicarEvento(atual: RegistroFiscal, evento: EventoFiscal): RegistroFiscal {
  switch (evento.tipo) {
    case "antes_do_envio":
      if (atual.situacao !== "reservada")
        throw new Error("Envio fiscal já começou");
      return marcarEnvioIncerto(atual);
    case "protocolo_recebido":
      // O evento só pode ser persistido após confirmação de HTTP 202
      // pelo adapter WLG; não deve ser fornecido pelo navegador.
      return registrarOperationId(atual, evento.operationId);
    case "resultado":
      return aplicarResultadoConsulta(atual, evento.status);
  }
}

export async function transicionarFiscalAtomico(
  atual: RegistroFiscalVersionado,
  evento: EventoFiscal,
): Promise<RegistroFiscalVersionado | null> {
  bloquearOperacaoRealEmPreview("fiscal_ledger");
  if (!Number.isSafeInteger(atual.versao) || atual.versao < 1 ||
      !valido(atual.registro)) throw new Error("Estado fiscal inválido");
  const proximoRegistro = aplicarEvento(atual.registro, evento);
  if (proximoRegistro === atual.registro ||
      JSON.stringify(proximoRegistro) === JSON.stringify(atual.registro)) return atual;
  if (!valido(proximoRegistro) || proximoRegistro.tenantId !== atual.registro.tenantId ||
      proximoRegistro.contaId !== atual.registro.contaId ||
      proximoRegistro.empresaId !== atual.registro.empresaId)
    throw new Error("Tentativa de alterar vínculo fiscal");
  const novo = { versao: atual.versao + 1, registro: proximoRegistro };
  const confirmado = await redis.eval<number>(
    LUA_CAS, [atual.registro.chave], [atual.versao, JSON.stringify(novo)],
  );
  // null = outro trabalhador ganhou a corrida; não devolver sucesso.
  return confirmado === 1 ? novo : null;
}
