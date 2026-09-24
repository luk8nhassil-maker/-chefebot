import type { EventoAnalitico } from "./historicoAnalitico";
import type { MomentoPesquisaId } from "./pesquisaPreferencia";

const MOMENTOS_CONTROLADOS = new Set<MomentoPesquisaId>(["M1", "M2", "M5"]);

type Ocasiao = {
  expedienteId: string;
  criadoEmMs: number;
  pedidoIds: string[];
};

export type ResultadoCandidatoControlado = {
  valido: boolean;
  motivo:
    | "ok"
    | "momento_nao_permitido"
    | "cliente_sem_historico"
    | "gatilho_nao_corresponde_ao_momento"
    | "historico_insuficiente_para_m5"
    | "cliente_nao_esta_em_queda_m5";
};

function quantilNearestRank(valores: number[], q: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.max(
    0,
    Math.min(ordenados.length - 1, Math.ceil(q * ordenados.length) - 1)
  );
  return ordenados[indice];
}

function agruparOcasioes(
  eventos: readonly EventoAnalitico[]
): Map<string, Ocasiao[]> {
  const porCliente = new Map<string, Map<string, Ocasiao>>();

  for (const evento of eventos) {
    if (evento.statusAnalitico !== "entregue") continue;
    const chave = evento.expedienteId?.trim() || `pedido:${evento.pedidoId}`;
    const mapa = porCliente.get(evento.clienteId) ?? new Map<string, Ocasiao>();
    const atual = mapa.get(chave);

    if (!atual) {
      mapa.set(chave, {
        expedienteId: chave,
        criadoEmMs: evento.criadoEmMs,
        pedidoIds: [evento.pedidoId],
      });
    } else {
      if (!atual.pedidoIds.includes(evento.pedidoId)) {
        atual.pedidoIds.push(evento.pedidoId);
      }
      if (evento.criadoEmMs > atual.criadoEmMs) {
        atual.criadoEmMs = evento.criadoEmMs;
      }
    }
    porCliente.set(evento.clienteId, mapa);
  }

  return new Map(
    [...porCliente.entries()].map(([clienteId, mapa]) => [
      clienteId,
      [...mapa.values()].sort((a, b) => a.criadoEmMs - b.criadoEmMs),
    ])
  );
}

function intervalos(ocasioes: readonly Ocasiao[]): number[] {
  const saida: number[] = [];
  for (let i = 1; i < ocasioes.length; i += 1) {
    const gap = ocasioes[i].criadoEmMs - ocasioes[i - 1].criadoEmMs;
    if (gap > 0) saida.push(gap);
  }
  return saida;
}

function contemPedido(ocasiao: Ocasiao | undefined, pedidoId: string): boolean {
  return !!ocasiao?.pedidoIds.includes(pedidoId);
}

export function validarCandidatoMomentoControlado(params: {
  eventos: readonly EventoAnalitico[];
  clienteId: string;
  momentId: MomentoPesquisaId;
  triggerEventId: string;
  agoraMs: number;
}): ResultadoCandidatoControlado {
  const { eventos, clienteId, momentId, triggerEventId, agoraMs } = params;

  if (!MOMENTOS_CONTROLADOS.has(momentId)) {
    return { valido: false, motivo: "momento_nao_permitido" };
  }

  const grupos = agruparOcasioes(eventos);
  const ocasioesCliente = grupos.get(clienteId);
  if (!ocasioesCliente?.length) {
    return { valido: false, motivo: "cliente_sem_historico" };
  }

  if (momentId === "M1") {
    return contemPedido(ocasioesCliente[0], triggerEventId)
      ? { valido: true, motivo: "ok" }
      : { valido: false, motivo: "gatilho_nao_corresponde_ao_momento" };
  }

  if (momentId === "M2") {
    return contemPedido(ocasioesCliente[1], triggerEventId)
      ? { valido: true, motivo: "ok" }
      : { valido: false, motivo: "gatilho_nao_corresponde_ao_momento" };
  }

  if (ocasioesCliente.length < 3) {
    return { valido: false, motivo: "historico_insuficiente_para_m5" };
  }

  const ultima = ocasioesCliente.at(-1);
  if (!contemPedido(ultima, triggerEventId)) {
    return { valido: false, motivo: "gatilho_nao_corresponde_ao_momento" };
  }

  const todosIntervalos = [...grupos.values()].flatMap(intervalos);
  const p75Populacao = quantilNearestRank(todosIntervalos, 0.75);
  const p90Populacao = quantilNearestRank(todosIntervalos, 0.9);
  const gapsCliente = intervalos(ocasioesCliente);
  const p75Cliente = quantilNearestRank(gapsCliente, 0.75);
  const p90Cliente = quantilNearestRank(gapsCliente, 0.9);

  if (
    p75Populacao === null ||
    p90Populacao === null ||
    p75Cliente === null ||
    p90Cliente === null ||
    !ultima
  ) {
    return { valido: false, motivo: "historico_insuficiente_para_m5" };
  }

  const gapAtual = Math.max(0, agoraMs - ultima.criadoEmMs);
  const estaS6 =
    gapAtual > p90Populacao &&
    gapAtual > p90Cliente;
  const estaM5 =
    !estaS6 &&
    gapAtual > p75Populacao &&
    gapAtual > p75Cliente;

  return estaM5
    ? { valido: true, motivo: "ok" }
    : { valido: false, motivo: "cliente_nao_esta_em_queda_m5" };
}
