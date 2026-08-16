// Dia operacional da pizzaria.
//
// A operação não fecha à meia-noite: pedidos feitos entre 00:00 e 02:59 ainda
// pertencem ao expediente iniciado no dia anterior. Esta regra é pura e não
// depende de cron, navegador ou estado externo; qualquer tela/rota pode chegar
// à mesma chave a partir do mesmo instante.

export const FUSO_EXPEDIENTE = "America/Sao_Paulo";
export const HORA_VIRADA_EXPEDIENTE = 3;

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const TOLERANCIA_FUTURO_MS = 2 * 60 * 1000;

type PartesLocais = {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
};

export type PedidoComTempoOperacional = {
  id?: unknown;
  criadoEm?: unknown;
  expedienteOperacional?: unknown;
  horario?: unknown;
  pix?: { criadoEm?: unknown; confirmadoEm?: unknown } | null;
};

function partesNoFuso(ms: number): PartesLocais | null {
  if (!Number.isFinite(ms)) return null;
  try {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: FUSO_EXPEDIENTE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));

    const pegar = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
    const resultado: PartesLocais = {
      ano: pegar("year"),
      mes: pegar("month"),
      dia: pegar("day"),
      // Alguns runtimes podem representar meia-noite como 24:xx.
      hora: pegar("hour") % 24,
      minuto: pegar("minute"),
      segundo: pegar("second"),
    };
    return Object.values(resultado).every(Number.isFinite) ? resultado : null;
  } catch {
    return null;
  }
}

function chaveDataUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Chave estável YYYY-MM-DD do expediente ao qual `agora` pertence.
 * Ex.: 2026-08-17 01:30 BRT ainda pertence ao expediente 2026-08-16.
 */
export function chaveExpedienteOperacional(agora: number = Date.now()): string {
  const partes = partesNoFuso(agora);
  if (!partes) throw new Error("Não foi possível determinar o fuso operacional");

  let diaBase = Date.UTC(partes.ano, partes.mes - 1, partes.dia);
  if (partes.hora < HORA_VIRADA_EXPEDIENTE) diaBase -= MS_POR_DIA;
  return chaveDataUtc(diaBase);
}

/** Data pt-BR do expediente, útil para campos legados de relatório. */
export function dataBrExpedienteOperacional(agora: number = Date.now()): string {
  const [ano, mes, dia] = chaveExpedienteOperacional(agora).split("-");
  return `${dia}/${mes}/${ano}`;
}

function parseIso(valor: unknown): number | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const ts = Date.parse(valor);
  return Number.isFinite(ts) ? ts : null;
}

/**
 * IDs oficiais começam por Date.now(). Em colisões, gerarIdPedidoUnico anexa
 * dígitos de desempate; os 13 primeiros continuam sendo o instante original.
 */
function timestampDoId(id: unknown): number | null {
  if (typeof id !== "string" || !/^\d{13,15}$/.test(id)) return null;
  const ts = Number(id.slice(0, 13));
  return Number.isFinite(ts) ? ts : null;
}

function deslocamentoFusoMs(ms: number): number | null {
  const p = partesNoFuso(ms);
  if (!p) return null;
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - (ms - (ms % 1000));
}

function timestampDeHoraLocal(horario: unknown, agora: number): number | null {
  if (typeof horario !== "string") return null;
  const match = horario.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hora = Number(match[1]);
  const minuto = Number(match[2]);
  if (hora > 23 || minuto > 59) return null;

  const partes = partesNoFuso(agora);
  const offset = deslocamentoFusoMs(agora);
  if (!partes || offset === null) return null;

  let ts = Date.UTC(partes.ano, partes.mes - 1, partes.dia, hora, minuto, 0) - offset;
  if (ts > agora + TOLERANCIA_FUTURO_MS) ts -= MS_POR_DIA;
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Resolve o instante de criação sem reescrever pedidos antigos. Novos campos
 * explícitos vencem; IDs/timestamps antigos permanecem como fallback.
 */
export function timestampCriacaoPedido(
  pedido: PedidoComTempoOperacional,
  agora: number = Date.now()
): number | null {
  const criadoEm = parseIso(pedido?.criadoEm);
  if (criadoEm !== null) return criadoEm;

  const porId = timestampDoId(pedido?.id);
  if (porId !== null) return porId;

  const porPix = parseIso(pedido?.pix?.criadoEm) ?? parseIso(pedido?.pix?.confirmadoEm);
  if (porPix !== null) return porPix;

  return timestampDeHoraLocal(pedido?.horario, agora);
}

export function chaveExpedienteDoPedido(
  pedido: PedidoComTempoOperacional,
  agora: number = Date.now()
): string | null {
  if (
    typeof pedido?.expedienteOperacional === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(pedido.expedienteOperacional)
  ) {
    return pedido.expedienteOperacional;
  }

  const criadoEm = timestampCriacaoPedido(pedido, agora);
  return criadoEm === null ? null : chaveExpedienteOperacional(criadoEm);
}

export function pertenceAoExpedienteAtual(
  pedido: PedidoComTempoOperacional,
  agora: number = Date.now()
): boolean {
  const chavePedido = chaveExpedienteDoPedido(pedido, agora);
  return chavePedido !== null && chavePedido === chaveExpedienteOperacional(agora);
}
