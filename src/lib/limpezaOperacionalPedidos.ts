// Acompanhamento operacional de pedidos — lógica pura, sem I/O.
// Mantém a API histórica do ChefeBot, mas aplica a mesma política operacional
// validada na referência técnica: fila bloqueante, virada de expediente às 03h,
// reavisos curtos e escalada progressiva da etapa de entrega.

import { chaveExpedienteDoPedido, chaveExpedienteOperacional } from "./expedienteOperacional";
import type { RegistroProblemaEntrega } from "./problemaEntrega";

export const LIMIAR_PIX_PENDENTE_MIN = 20;
export const LIMIAR_NOVO_SEM_ACEITE_MIN = 15;
export const LIMIAR_PREPARO_MIN = 75;
export const LIMIAR_ENTREGA_MIN = 20;
export const LIMIAR_REAVISO_PREPARO_MIN = 5;
export const LIMIAR_REAVISO_ENTREGA_MIN = 5;
export const FUSO_OPERACIONAL = "America/Sao_Paulo";

const MS_POR_MINUTO = 60_000;
const MS_POR_DIA = 24 * 60 * MS_POR_MINUTO;
const TOLERANCIA_FUTURO_MS = 2 * MS_POR_MINUTO;
const STATUS_TERMINAIS = ["entregue", "cancelado"] as const;

export type MotivoPendencia =
  | "pagamento_pix_pendente"
  | "novo_sem_aceite"
  | "preparo_longo"
  | "entrega_longa";

export type AcaoLimpeza = "avancou" | "cancelou" | "verificou_pagamento" | "adiou";

export type RegistroLimpeza = {
  motivo: MotivoPendencia;
  acao: AcaoLimpeza;
  resolvidoEm: string;
  resolvidoPor?: string;
  tentativas?: number;
};

export type PedidoLimpeza = {
  id?: string;
  numero?: number;
  cliente?: string;
  telefone?: string;
  semTelefone?: boolean;
  total?: number;
  status?: string;
  isArchived?: boolean;
  horario?: string;
  horarioInicio?: string;
  statusAtualizadoEm?: string;
  pagamento?: string;
  pixConfirmado?: boolean;
  pix?: { status?: string; valorEsperado?: number; criadoEm?: string; confirmadoEm?: string } | null;
  limpezaOperacional?: RegistroLimpeza | null;
  tipoEntrega?: string;
  endereco?: string;
  criadoEm?: string;
  expedienteOperacional?: string;
  entregaProblema?: RegistroProblemaEntrega;
};

export type ModalidadePedidoOperacional = "delivery" | "retirada" | "dine_in";

export type Pendencia = {
  pedidoId: string;
  numero?: number;
  cliente?: string;
  total: number;
  valorPix?: number;
  status: string;
  motivo: MotivoPendencia;
  idadeMinutos: number;
  titulo: string;
  descricao: string;
  tipoEntrega?: string;
  endereco?: string;
  telefone?: string;
  semTelefone?: boolean;
  modalidade: ModalidadePedidoOperacional;
  tentativasAdiamento: number;
  podeRelatarProblema: boolean;
  exigirProblema: boolean;
  entregaProblema?: RegistroProblemaEntrega;
};

type PartesData = { ano: number; mes: number; dia: number; hora: number; minuto: number; segundo: number };

function partesNoFuso(ms: number): PartesData | null {
  if (!Number.isFinite(ms)) return null;
  try {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: FUSO_OPERACIONAL,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));
    const pegar = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
    const resultado: PartesData = {
      ano: pegar("year"), mes: pegar("month"), dia: pegar("day"),
      hora: pegar("hour") % 24, minuto: pegar("minute"), segundo: pegar("second"),
    };
    return Object.values(resultado).every(Number.isFinite) ? resultado : null;
  } catch {
    return null;
  }
}

function deslocamentoFusoMs(ms: number): number | null {
  const p = partesNoFuso(ms);
  if (!p) return null;
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - (ms - (ms % 1000));
}

export function timestampDeHoraLocal(hhmm: string | undefined, agora: number): number | null {
  if (!hhmm || typeof hhmm !== "string") return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hora = Number(m[1]);
  const minuto = Number(m[2]);
  if (!Number.isFinite(hora) || !Number.isFinite(minuto) || hora > 23 || minuto > 59) return null;
  const partes = partesNoFuso(agora);
  const deslocamento = deslocamentoFusoMs(agora);
  if (!partes || deslocamento === null) return null;
  let ts = Date.UTC(partes.ano, partes.mes - 1, partes.dia, hora, minuto, 0) - deslocamento;
  if (ts > agora + TOLERANCIA_FUTURO_MS) ts -= MS_POR_DIA;
  return Number.isFinite(ts) ? ts : null;
}

function parseIso(valor: string | undefined | null): number | null {
  if (!valor || typeof valor !== "string") return null;
  const ts = Date.parse(valor);
  return Number.isFinite(ts) ? ts : null;
}

export function timestampPedido(pedido: PedidoLimpeza, agora: number): number | null {
  const id = pedido.id;
  if (typeof id === "string" && /^\d{13,15}$/.test(id)) {
    const ts = Number(id.slice(0, 13));
    if (Number.isFinite(ts)) return ts;
  }
  const porCriacao = parseIso(pedido.criadoEm);
  if (porCriacao !== null) return porCriacao;
  const doPix = parseIso(pedido.pix?.criadoEm) ?? parseIso(pedido.pix?.confirmadoEm);
  if (doPix !== null) return doPix;
  return timestampDeHoraLocal(pedido.horario, agora);
}

function registroEhAdiamentoDaEtapa(pedido: PedidoLimpeza, motivo: MotivoPendencia): boolean {
  return pedido.limpezaOperacional?.acao === "adiou" && pedido.limpezaOperacional.motivo === motivo;
}

function motivoDaEtapa(status: string): MotivoPendencia | null {
  if (status === "novo") return "novo_sem_aceite";
  if (status === "em_preparo") return "preparo_longo";
  if (status === "saiu_entrega") return "entrega_longa";
  return null;
}

export function timestampDaEtapa(pedido: PedidoLimpeza, agora: number): number | null {
  const status = pedido.status || "";
  const motivo = motivoDaEtapa(status);
  if (motivo && registroEhAdiamentoDaEtapa(pedido, motivo)) {
    const adiado = parseIso(pedido.limpezaOperacional?.resolvidoEm);
    if (adiado !== null) return adiado;
  }
  if (status !== "novo") {
    const carimbo = parseIso(pedido.statusAtualizadoEm);
    if (carimbo !== null) return carimbo;
  }
  if (status === "novo" && registroEhAdiamentoDaEtapa(pedido, "pagamento_pix_pendente")) {
    const adiado = parseIso(pedido.limpezaOperacional?.resolvidoEm) ?? parseIso(pedido.statusAtualizadoEm);
    if (adiado !== null) return adiado;
  }
  if (status === "em_preparo") {
    const inicio = timestampDeHoraLocal(pedido.horarioInicio, agora);
    if (inicio !== null) return inicio;
  }
  return timestampPedido(pedido, agora);
}

export function idadeDaEtapaMinutos(pedido: PedidoLimpeza, agora: number): number {
  const inicio = timestampDaEtapa(pedido, agora);
  if (inicio === null) return 0;
  const decorrido = agora - inicio;
  if (!Number.isFinite(decorrido) || decorrido <= 0) return 0;
  return Math.floor(decorrido / MS_POR_MINUTO);
}

function temPix(pedido: PedidoLimpeza): boolean {
  return /\bpix\b/i.test(String(pedido.pagamento || "")) || !!pedido.pix;
}

function pixEmAnalise(pedido: PedidoLimpeza): boolean {
  return ["em_revisao", "suspeito", "comprovante_recebido"].includes(String(pedido.pix?.status || ""));
}

export function pedidoPixConfirmado(pedido: PedidoLimpeza): boolean {
  return pedido.pixConfirmado === true || pedido.pix?.status === "confirmado";
}

export function modalidadePedidoOperacional(pedido: Pick<PedidoLimpeza, "tipoEntrega" | "endereco">): ModalidadePedidoOperacional {
  if (pedido.tipoEntrega === "dine_in" || pedido.endereco === "Consumo no local") return "dine_in";
  if (pedido.tipoEntrega === "pickup" || pedido.tipoEntrega === "retirada" || pedido.endereco === "Retirada na loja") return "retirada";
  return "delivery";
}

export function tentativasAdiamentoRota(pedido: PedidoLimpeza): number {
  const registro = pedido.limpezaOperacional;
  if (registro?.motivo !== "entrega_longa" || registro.acao !== "adiou") return 0;
  if (typeof registro.tentativas === "number" && Number.isFinite(registro.tentativas)) {
    return Math.max(1, Math.floor(registro.tentativas));
  }
  return 1;
}

function pertenceAExpedienteAnterior(pedido: PedidoLimpeza, agora: number): boolean {
  try {
    const chavePedido = chaveExpedienteDoPedido(pedido, agora);
    return !!chavePedido && chavePedido < chaveExpedienteOperacional(agora);
  } catch {
    return false;
  }
}

function limiarDaPendencia(pedido: PedidoLimpeza, motivo: MotivoPendencia): number {
  if (motivo === "pagamento_pix_pendente") return LIMIAR_PIX_PENDENTE_MIN;
  if (motivo === "novo_sem_aceite") return LIMIAR_NOVO_SEM_ACEITE_MIN;
  if (motivo === "preparo_longo") return registroEhAdiamentoDaEtapa(pedido, motivo) ? LIMIAR_REAVISO_PREPARO_MIN : LIMIAR_PREPARO_MIN;
  return tentativasAdiamentoRota(pedido) > 0 ? LIMIAR_REAVISO_ENTREGA_MIN : LIMIAR_ENTREGA_MIN;
}

export function classificarPendencia(pedido: PedidoLimpeza, agora: number): Pendencia | null {
  if (!pedido || typeof pedido.id !== "string" || !pedido.id || pedido.isArchived) return null;
  const status = pedido.status || "";
  if ((STATUS_TERMINAIS as readonly string[]).includes(status)) return null;
  if (!["novo", "em_preparo", "saiu_entrega"].includes(status)) return null;

  const idadeMinutos = idadeDaEtapaMinutos(pedido, agora);
  const expedienteAnterior = pertenceAExpedienteAnterior(pedido, agora);
  const tentativasAdiamento = tentativasAdiamentoRota(pedido);
  const modalidade = modalidadePedidoOperacional(pedido);
  const base = {
    pedidoId: pedido.id,
    ...(pedido.numero != null ? { numero: pedido.numero } : {}),
    cliente: pedido.cliente,
    total: typeof pedido.total === "number" ? pedido.total : 0,
    status,
    idadeMinutos,
    tipoEntrega: pedido.tipoEntrega,
    endereco: pedido.endereco,
    telefone: pedido.telefone,
    semTelefone: pedido.semTelefone,
    modalidade,
    tentativasAdiamento,
    podeRelatarProblema: status === "saiu_entrega" && modalidade === "delivery" && tentativasAdiamento >= 1,
    exigirProblema: status === "saiu_entrega" && modalidade === "delivery" && tentativasAdiamento >= 2,
    entregaProblema: pedido.entregaProblema,
  };

  if (status === "novo" && temPix(pedido) && !pedidoPixConfirmado(pedido) && !pixEmAnalise(pedido) && idadeMinutos >= LIMIAR_PIX_PENDENTE_MIN) {
    return {
      ...base,
      motivo: "pagamento_pix_pendente",
      valorPix: typeof pedido.pix?.valorEsperado === "number" ? pedido.pix.valorEsperado : base.total,
      titulo: "Esse Pix ainda está pendente",
      descricao: `Já faz ${idadeMinutos} min que o pagamento está aguardando. Confira o Mercado Pago antes de tomar qualquer decisão.`,
    };
  }
  // Pix não confirmado ou em análise nunca cai na ação genérica de cozinha.
  if (status === "novo" && temPix(pedido) && !pedidoPixConfirmado(pedido)) return null;

  if (status === "novo" && (expedienteAnterior || idadeMinutos >= limiarDaPendencia(pedido, "novo_sem_aceite"))) {
    return {
      ...base,
      motivo: "novo_sem_aceite",
      titulo: expedienteAnterior ? "Esse pedido ficou do expediente anterior" : "Esse pedido ainda está esperando",
      descricao: "Confirme o que aconteceu: comece a fazer, aguarde mais alguns minutos ou cancele corretamente.",
    };
  }

  if (status === "em_preparo" && (expedienteAnterior || idadeMinutos >= limiarDaPendencia(pedido, "preparo_longo"))) {
    return {
      ...base,
      motivo: "preparo_longo",
      titulo: expedienteAnterior ? "Esse pedido ficou aberto na cozinha" : "A cozinha passou do tempo previsto",
      descricao: "Confirme se o pedido já avançou ou se ainda está sendo preparado. Assim ele não fica esquecido.",
    };
  }

  if (status === "saiu_entrega" && (expedienteAnterior || idadeMinutos >= limiarDaPendencia(pedido, "entrega_longa"))) {
    const escalado = tentativasAdiamento >= 1;
    const copy = modalidade === "retirada"
      ? {
          titulo: escalado ? "Essa retirada ainda precisa de atenção" : "Esse pedido está pronto para retirada",
          descricao: escalado
            ? `Já passaram mais ${idadeMinutos} min desde a última confirmação e o pedido continua aguardando retirada.`
            : `Já faz ${idadeMinutos} min que esse pedido está pronto para retirada. Confirme se o cliente já buscou ou aguarde mais ${LIMIAR_REAVISO_ENTREGA_MIN} min.`,
        }
      : modalidade === "dine_in"
        ? {
            titulo: escalado ? "Esse pedido ainda não foi servido" : "Esse pedido está pronto para servir",
            descricao: escalado
              ? `Já passaram mais ${idadeMinutos} min desde a última confirmação. Confira com a equipe do salão até ele chegar ao cliente.`
              : `Já faz ${idadeMinutos} min que esse pedido ficou pronto para servir. Confirme se ele já chegou ao cliente ou acompanhe novamente em ${LIMIAR_REAVISO_ENTREGA_MIN} min.`,
          }
        : {
            titulo: escalado ? "Essa entrega ainda precisa de atenção" : "Essa entrega precisa de uma confirmação",
            descricao: escalado
              ? `Já passaram mais ${idadeMinutos} min desde a última confirmação. Se ainda não entregou, diga se o motoboy continua a caminho ou se aconteceu algum problema.`
              : `Já faz ${idadeMinutos} min que esse pedido está marcado como NA RUA. Se o cliente recebeu, finalize agora. Se o motoboy ainda estiver a caminho, eu te lembro de novo em ${LIMIAR_REAVISO_ENTREGA_MIN} min.`,
          };
    return { ...base, motivo: "entrega_longa", ...copy };
  }

  return null;
}

const PRIORIDADE: Record<MotivoPendencia, number> = {
  pagamento_pix_pendente: 0,
  entrega_longa: 1,
  preparo_longo: 2,
  novo_sem_aceite: 3,
};

export function listarPendencias(pedidos: readonly PedidoLimpeza[], agora: number): Pendencia[] {
  if (!Array.isArray(pedidos)) return [];
  return pedidos
    .map((pedido) => classificarPendencia(pedido, agora))
    .filter((p): p is Pendencia => p !== null)
    .sort((a, b) => PRIORIDADE[a.motivo] - PRIORIDADE[b.motivo] || b.idadeMinutos - a.idadeMinutos);
}

export type OpcaoResolucao = {
  label: string;
  acao: AcaoLimpeza;
  status?: string;
  tom?: "principal" | "secundario" | "perigo";
};

export function acaoPrincipal(p: Pendencia): OpcaoResolucao {
  if (p.motivo === "pagamento_pix_pendente") return { label: "VERIFICAR PAGAMENTO NO MERCADO PAGO", acao: "verificou_pagamento", tom: "principal" };
  if (p.status === "novo") return { label: "COMEÇAR A FAZER", acao: "avancou", status: "em_preparo", tom: "principal" };
  if (p.status === "em_preparo") {
    if (p.modalidade === "dine_in") return { label: "PRONTO PARA SERVIR", acao: "avancou", status: "saiu_entrega", tom: "principal" };
    if (p.modalidade === "retirada") return { label: "PRONTO PARA RETIRADA", acao: "avancou", status: "saiu_entrega", tom: "principal" };
    return { label: "SAIU PARA ENTREGA", acao: "avancou", status: "saiu_entrega", tom: "principal" };
  }
  return {
    label: p.modalidade === "retirada" ? "CLIENTE RETIROU" : p.modalidade === "dine_in" ? "PEDIDO SERVIDO" : "JÁ FOI ENTREGUE",
    acao: "avancou",
    status: "entregue",
    tom: "principal",
  };
}

export function acaoSecundaria(p: Pendencia): OpcaoResolucao | null {
  if (p.motivo === "pagamento_pix_pendente") return null;
  if (p.status === "novo") return { label: `AGUARDAR MAIS ${LIMIAR_NOVO_SEM_ACEITE_MIN} MIN`, acao: "adiou", status: "novo", tom: "secundario" };
  if (p.status === "em_preparo") return { label: `AINDA ESTÁ FAZENDO · LEMBRAR EM ${LIMIAR_REAVISO_PREPARO_MIN} MIN`, acao: "adiou", status: "em_preparo", tom: "secundario" };
  if (p.status === "saiu_entrega") {
    if (p.modalidade === "delivery" && p.exigirProblema) return null;
    if (p.modalidade === "retirada" && p.tentativasAdiamento >= 2 && p.entregaProblema?.contatoStatus !== "enviado") return null;
    const label = p.modalidade === "retirada"
      ? p.entregaProblema?.contatoStatus === "enviado"
        ? `CLIENTE ESTÁ A CAMINHO · LEMBRAR EM ${LIMIAR_REAVISO_ENTREGA_MIN} MIN`
        : `AINDA NÃO RETIROU · LEMBRAR EM ${LIMIAR_REAVISO_ENTREGA_MIN} MIN`
      : p.modalidade === "dine_in"
        ? `AINDA NÃO FOI SERVIDO · LEMBRAR EM ${LIMIAR_REAVISO_ENTREGA_MIN} MIN`
        : `AINDA ESTÁ NA RUA · LEMBRAR EM ${LIMIAR_REAVISO_ENTREGA_MIN} MIN`;
    return { label, acao: "adiou", status: "saiu_entrega", tom: "secundario" };
  }
  return null;
}

export function acaoTerciaria(p: Pendencia): OpcaoResolucao | null {
  if (p.status !== "novo" || p.motivo === "pagamento_pix_pendente") return null;
  return { label: "Cancelar pedido", acao: "cancelou", status: "cancelado", tom: "perigo" };
}

const MOTIVOS: readonly MotivoPendencia[] = ["pagamento_pix_pendente", "novo_sem_aceite", "preparo_longo", "entrega_longa"];
const ACOES: readonly AcaoLimpeza[] = ["avancou", "cancelou", "verificou_pagamento", "adiou"];

export function sanitizarEntradaLimpeza(valor: unknown): { motivo: MotivoPendencia; acao: AcaoLimpeza } | null {
  if (!valor || typeof valor !== "object") return null;
  const bruto = valor as { motivo?: unknown; acao?: unknown };
  const motivo = MOTIVOS.find((m) => m === bruto.motivo);
  const acao = ACOES.find((a) => a === bruto.acao);
  return motivo && acao ? { motivo, acao } : null;
}

export function registrarResolucao(
  motivo: MotivoPendencia,
  acao: AcaoLimpeza,
  agora: number,
  resolvidoPor?: string,
  tentativas?: number,
): RegistroLimpeza {
  return {
    motivo,
    acao,
    resolvidoEm: new Date(agora).toISOString(),
    ...(resolvidoPor ? { resolvidoPor } : {}),
    ...(typeof tentativas === "number" ? { tentativas } : {}),
  };
}

export type AnaliseOperacional = {
  totalResolvidas: number;
  resolvidasHoje: number;
  porMotivo: Record<MotivoPendencia, number>;
  taxaAbandono: number;
  pendentesAgora: number;
};

function mesmoDiaNoFuso(a: number, b: number): boolean {
  const pa = partesNoFuso(a);
  const pb = partesNoFuso(b);
  return !!pa && !!pb && pa.ano === pb.ano && pa.mes === pb.mes && pa.dia === pb.dia;
}

const MOTIVO_ZERADO: Record<MotivoPendencia, number> = {
  pagamento_pix_pendente: 0,
  novo_sem_aceite: 0,
  preparo_longo: 0,
  entrega_longa: 0,
};

export function calcularAnaliseOperacional(pedidos: readonly PedidoLimpeza[], agora: number): AnaliseOperacional {
  const porMotivo = { ...MOTIVO_ZERADO };
  let totalResolvidas = 0;
  let resolvidasHoje = 0;
  let cancelamentos = 0;
  for (const pedido of Array.isArray(pedidos) ? pedidos : []) {
    const registro = pedido?.limpezaOperacional;
    const motivo = registro ? MOTIVOS.find((m) => m === registro.motivo) : undefined;
    if (!registro || !motivo || registro.acao === "adiou") continue;
    totalResolvidas += 1;
    porMotivo[motivo] += 1;
    if (registro.acao === "cancelou") cancelamentos += 1;
    const quando = parseIso(registro.resolvidoEm);
    if (quando !== null && mesmoDiaNoFuso(quando, agora)) resolvidasHoje += 1;
  }
  return {
    totalResolvidas,
    resolvidasHoje,
    porMotivo,
    taxaAbandono: totalResolvidas === 0 ? 0 : cancelamentos / totalResolvidas,
    pendentesAgora: listarPendencias(pedidos, agora).length,
  };
}
