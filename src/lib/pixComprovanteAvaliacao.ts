import type { ResultadoHorarioComprovantePix } from "./pixComprovanteHorario";

export type CriterioValorPix = "ok" | "divergente" | "ausente";
export type CriterioBeneficiarioPix = "ok" | "divergente" | "ausente";
export type CriterioStatusPix = "ok" | "pendente_ou_agendado" | "ausente";
export type CriterioHorarioPix = "ok" | "anterior_ao_pedido" | "ausente";
export type CriterioHashPix = "novo" | "reutilizado";
export type CriterioE2EPix = "novo" | "reutilizado" | "ausente";
export type CriterioLegibilidadePix = "alta" | "baixa" | "desconhecida";

export type DecisaoEvidenciaPix = "aprovar" | "revisar" | "suspeito";

export type CriteriosEvidenciaPix = {
  valor: CriterioValorPix;
  beneficiario: CriterioBeneficiarioPix;
  status: CriterioStatusPix;
  horario: CriterioHorarioPix;
  hash: CriterioHashPix;
  e2e: CriterioE2EPix;
  legibilidade: CriterioLegibilidadePix;
};

export type ResultadoEvidenciaPix = {
  decisao: DecisaoEvidenciaPix;
  score: number;
  criterios: CriteriosEvidenciaPix;
  motivos: string[];
};

export type AvaliarEvidenciaPixInput = {
  valorEsperado?: number | null;
  valorLido?: number | null;
  toleranciaValor?: number;
  beneficiarioEsperado?: string | null;
  beneficiarioLido?: string | null;
  statusTransacao?: string | null;
  horario: ResultadoHorarioComprovantePix;
  hashReutilizado: boolean;
  e2eId?: string | null;
  codigoAutenticacao?: string | null;
  e2eReutilizado: boolean;
  origem: "imagem" | "pdf" | "texto";
  legibilidade?: "alta" | "baixa";
};

const TOLERANCIA_VALOR_PADRAO = 0.01;

const PALAVRAS_STATUS_PENDENTE = [
  "AGEND",
  "PENDENT",
  "PROCESS",
  "ANALISE",
  "CANCEL",
  "ESTORN",
  "RECUS",
  "FALH",
  "AGUARD",
];

function normalizarTextoComparacaoPix(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function valorCorresponde(esperado: number, lido: number, tolerancia: number): boolean {
  return Math.abs(esperado - lido) <= tolerancia;
}

function beneficiarioCorresponde(esperado: string, lido: string): boolean {
  const esperadoNorm = normalizarTextoComparacaoPix(esperado);
  const lidoNorm = normalizarTextoComparacaoPix(lido);
  if (!esperadoNorm || !lidoNorm) return false;
  if (lidoNorm.includes(esperadoNorm) || esperadoNorm.includes(lidoNorm)) return true;

  const palavrasEsperado = esperadoNorm.split(" ").filter((palavra) => palavra.length >= 3);
  if (palavrasEsperado.length === 0) return false;
  return palavrasEsperado.some((palavra) => lidoNorm.includes(palavra));
}

function avaliarCriterioValor(input: AvaliarEvidenciaPixInput): CriterioValorPix {
  const { valorEsperado, valorLido } = input;
  if (typeof valorEsperado !== "number" || !Number.isFinite(valorEsperado)) return "ausente";
  if (typeof valorLido !== "number" || !Number.isFinite(valorLido)) return "ausente";

  const tolerancia = input.toleranciaValor ?? TOLERANCIA_VALOR_PADRAO;
  return valorCorresponde(valorEsperado, valorLido, tolerancia) ? "ok" : "divergente";
}

function avaliarCriterioBeneficiario(input: AvaliarEvidenciaPixInput): CriterioBeneficiarioPix {
  const esperado = (input.beneficiarioEsperado || "").trim();
  const lido = (input.beneficiarioLido || "").trim();
  if (!esperado || !lido) return "ausente";

  return beneficiarioCorresponde(esperado, lido) ? "ok" : "divergente";
}

function avaliarCriterioStatus(input: AvaliarEvidenciaPixInput): CriterioStatusPix {
  const status = (input.statusTransacao || "").trim();
  if (!status) return "ausente";

  const normalizado = normalizarTextoComparacaoPix(status);
  const pendenteOuAgendado = PALAVRAS_STATUS_PENDENTE.some((palavra) => normalizado.includes(palavra));
  return pendenteOuAgendado ? "pendente_ou_agendado" : "ok";
}

function avaliarCriterioHorario(horario: ResultadoHorarioComprovantePix): CriterioHorarioPix {
  if (horario.bloquear) return "anterior_ao_pedido";
  if (horario.motivo === "sem_horario" || horario.motivo === "referencia_invalida") return "ausente";
  return "ok";
}

function avaliarCriterioE2E(input: AvaliarEvidenciaPixInput): CriterioE2EPix {
  const temIdentificador = !!(input.e2eId || input.codigoAutenticacao);
  if (!temIdentificador) return "ausente";
  return input.e2eReutilizado ? "reutilizado" : "novo";
}

function avaliarCriterioLegibilidade(input: AvaliarEvidenciaPixInput): CriterioLegibilidadePix {
  if (input.legibilidade === "alta") return "alta";
  if (input.legibilidade === "baixa") return "baixa";
  return "desconhecida";
}

const PONTOS_VALOR: Record<CriterioValorPix, number> = { ok: 35, ausente: 10, divergente: -40 };
const PONTOS_BENEFICIARIO: Record<CriterioBeneficiarioPix, number> = { ok: 25, ausente: 10, divergente: -40 };
const PONTOS_STATUS: Record<CriterioStatusPix, number> = { ok: 15, ausente: 5, pendente_ou_agendado: -30 };
const PONTOS_HORARIO: Record<CriterioHorarioPix, number> = { ok: 15, ausente: 10, anterior_ao_pedido: -100 };
const PONTOS_HASH: Record<CriterioHashPix, number> = { novo: 0, reutilizado: -100 };
const PONTOS_E2E: Record<CriterioE2EPix, number> = { novo: 5, ausente: 0, reutilizado: -100 };
const PONTOS_LEGIBILIDADE: Record<CriterioLegibilidadePix, number> = { alta: 5, desconhecida: 0, baixa: -15 };

function calcularScore(criterios: CriteriosEvidenciaPix): number {
  return (
    PONTOS_VALOR[criterios.valor] +
    PONTOS_BENEFICIARIO[criterios.beneficiario] +
    PONTOS_STATUS[criterios.status] +
    PONTOS_HORARIO[criterios.horario] +
    PONTOS_HASH[criterios.hash] +
    PONTOS_E2E[criterios.e2e] +
    PONTOS_LEGIBILIDADE[criterios.legibilidade]
  );
}

function montarMotivos(criterios: CriteriosEvidenciaPix): string[] {
  const motivos: string[] = [];

  if (criterios.valor === "divergente") motivos.push("Valor do comprovante diverge do valor esperado.");
  if (criterios.valor === "ausente") motivos.push("Nao foi possivel identificar o valor no comprovante.");

  if (criterios.beneficiario === "divergente") motivos.push("Beneficiario/chave do comprovante nao corresponde ao esperado.");
  if (criterios.beneficiario === "ausente") motivos.push("Nao foi possivel identificar o beneficiario/chave no comprovante.");

  if (criterios.status === "pendente_ou_agendado") motivos.push("Status do pagamento indica pendencia, agendamento ou cancelamento.");

  if (criterios.horario === "anterior_ao_pedido") motivos.push("Horario do pagamento e anterior ao pedido, fora da tolerancia.");
  if (criterios.horario === "ausente") motivos.push("Comprovante sem horario legivel.");

  if (criterios.hash === "reutilizado") motivos.push("Hash do comprovante ja foi utilizado antes (possivel reuso).");

  if (criterios.e2e === "reutilizado") motivos.push("Identificador E2E/codigo de autenticacao ja foi utilizado antes.");
  if (criterios.e2e === "ausente") motivos.push("Comprovante sem E2E ou codigo de autenticacao identificavel.");

  if (criterios.legibilidade === "baixa") motivos.push("Legibilidade baixa: comprovante dificil de conferir.");

  return motivos;
}

// Camada de decisao conservadora: so aprova automaticamente com evidencia forte
// em todos os sinais. Qualquer sinal fraco ou ausente cai em revisao humana.
// Reuso de hash/E2E ou pagamento comprovadamente anterior ao pedido (ja bloqueado
// em pixComprovanteHorario) e sempre "suspeito", nunca aprovado nem revisado.
export function avaliarEvidenciaPix(input: AvaliarEvidenciaPixInput): ResultadoEvidenciaPix {
  const criterios: CriteriosEvidenciaPix = {
    valor: avaliarCriterioValor(input),
    beneficiario: avaliarCriterioBeneficiario(input),
    status: avaliarCriterioStatus(input),
    horario: avaliarCriterioHorario(input.horario),
    hash: input.hashReutilizado ? "reutilizado" : "novo",
    e2e: avaliarCriterioE2E(input),
    legibilidade: avaliarCriterioLegibilidade(input),
  };

  const rawScore = calcularScore(criterios);
  const scoreClamped = Math.max(0, Math.min(100, rawScore));

  const evidenciaForteDeFraude =
    criterios.hash === "reutilizado" ||
    criterios.e2e === "reutilizado" ||
    criterios.horario === "anterior_ao_pedido" ||
    (criterios.valor === "divergente" && criterios.beneficiario === "divergente");

  const score = evidenciaForteDeFraude ? Math.min(scoreClamped, 10) : scoreClamped;

  let decisao: DecisaoEvidenciaPix;
  if (evidenciaForteDeFraude) {
    decisao = "suspeito";
  } else if (
    score >= 80 &&
    criterios.valor === "ok" &&
    criterios.beneficiario === "ok" &&
    criterios.status !== "pendente_ou_agendado" &&
    criterios.legibilidade !== "baixa"
  ) {
    decisao = "aprovar";
  } else {
    decisao = "revisar";
  }

  return { decisao, score, criterios, motivos: montarMotivos(criterios) };
}
