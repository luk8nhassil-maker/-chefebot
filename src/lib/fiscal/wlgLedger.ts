/**
 * Máquina de estados para o futuro ledger fiscal DURÁVEL.
 * É uma função pura, não grava dados e não executa emissão.
 * Uso real exige transação atômica com chave por tenant + conta.
 */
import type { WlgStatus } from "./wlgConsulta.server";

type SituacaoFiscal = "reservada" | "envio_incerto" | "processando" | "autorizada" | "rejeitada";

export type RegistroFiscal = Readonly<{
  chave: string;
  tenantId: string;
  contaId: string;
  empresaId: string;
  situacao: SituacaoFiscal;
  operationId?: string;
  chaveNfe?: string;
}>;

const ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Idempotência fiscal por RESTAURANTE + CONTA FINAL.
 * Não usar uma chave por rodada do Salão.
 */
export function chaveFiscal(tenantId: string, contaFinalId: string): string {
  if (!ID.test(tenantId) || !ID.test(contaFinalId))
    throw new Error("Identificador fiscal inválido");
  return "fiscal:nfce:" + tenantId + ":" + contaFinalId;
}

/** Só pode criar a reserva se NÃO existir qualquer estado anterior, inclusive rejeitado. */
export function reservarRegistroFiscal(
  anterior: RegistroFiscal | null,
  tenantId: string,
  contaFinalId: string,
  empresaId: string,
): RegistroFiscal | null {
  if (anterior) return null;
  if (!ID.test(empresaId)) throw new Error("Empresa inválida");
  return { chave: chaveFiscal(tenantId, contaFinalId), tenantId, contaId: contaFinalId,
    empresaId, situacao: "reservada" };
}

/** Após falha de rede no POST não sabemos se a SEFAZ recebeu: bloqueia reenvio. */
export function marcarEnvioIncerto(registro: RegistroFiscal): RegistroFiscal {
  if (registro.situacao !== "reservada") return registro;
  return { ...registro, situacao: "envio_incerto" };
}

export function registrarOperationId(
  registro: RegistroFiscal,
  operationId: string,
): RegistroFiscal {
  if (registro.situacao !== "reservada" || !/^[A-Za-z0-9_-]{8,100}$/.test(operationId))
    throw new Error("Transição fiscal inválida");
  return { ...registro, situacao: "processando", operationId };
}

export function aplicarResultadoConsulta(
  registro: RegistroFiscal,
  resultado: WlgStatus,
): RegistroFiscal {
  if (!registro.operationId || registro.operationId !== resultado.operationId)
    throw new Error("Operação fiscal não pertence a esta conta");
  if (registro.situacao !== "processando") return registro; // nunca reverter autorizada
  switch (resultado.situacao) {
    case "autorizada":
      return { ...registro, situacao: "autorizada", chaveNfe: resultado.chave };
    case "rejeitada":
      return { ...registro, situacao: "rejeitada" };
    case "processando":
    case "indeterminada":
      return registro;
  }
}

/**
 * Regra mais importante: não reemitir automaticamente após nenhum estado
 * anterior. Análise manual e consulta por chave/operationId devem resolver.
 */
export function podeIniciarEmissao(registro: RegistroFiscal | null): boolean {
  return registro === null;
}
