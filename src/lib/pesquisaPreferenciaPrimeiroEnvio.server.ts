import { createHash } from "node:crypto";
import {
  consultarEventosAntesDe,
  consultarEventosPorPeriodo,
  periodo90Dias,
  TENANT_PADRAO_ANALYTICS,
  type EventoAnalitico,
} from "./historicoAnalitico";
import { obterInstrumentoPesquisa } from "./pesquisaPreferenciaRegistro";
import { validarCandidatoMomentoControlado } from "./pesquisaPreferenciaCandidato";
import { avaliarElegibilidadeContatoPesquisaCompleta } from "./pesquisaPreferenciaElegibilidadeCompleta.server";
import { derivarResearchCustomerKey } from "./pesquisaPreferenciaContatosRedis";

const MOTIVO_MANUAL_PENDENTE = "fontes_operacionais_incompletas";

export type CandidatoPrimeiroEnvioM5 = {
  candidateRef: string;
  telefoneMascarado: string;
  triggerEventId: string;
  ultimaCompraEmMs: number;
};

export type ResumoPrimeiroEnvioM5 = {
  candidatosComportamentais: number;
  candidatosSemBloqueioAutomatico: number;
  prontoParaConfirmacaoManual: boolean;
  primeiroCandidato: CandidatoPrimeiroEnvioM5 | null;
};

function telefoneDoClienteId(clienteId: string): string | null {
  const match = /^cli_(\d{10,15})$/.exec(clienteId);
  return match?.[1] ?? null;
}

function mascararTelefone(telefone: string): string {
  const digitos = telefone.replace(/\D/g, "");
  return digitos.length >= 4 ? `…${digitos.slice(-4)}` : "…";
}

function refCandidato(params: {
  customerKey: string;
  triggerEventId: string;
}): string {
  return createHash("sha256")
    .update(
      [
        "chefebot:research:first-controlled:m5:v1",
        params.customerKey,
        params.triggerEventId,
      ].join(":")
    )
    .digest("hex");
}

function ultimoEventoEntreguePorCliente(
  eventos: readonly EventoAnalitico[]
): Map<string, EventoAnalitico> {
  const mapa = new Map<string, EventoAnalitico>();

  for (const evento of eventos) {
    if (evento.statusAnalitico !== "entregue") continue;
    const atual = mapa.get(evento.clienteId);
    if (!atual || evento.criadoEmMs > atual.criadoEmMs) {
      mapa.set(evento.clienteId, evento);
    }
  }

  return mapa;
}

export async function resumirPrimeiroEnvioM5(params: {
  agoraMs?: number;
  tenantId?: string;
} = {}): Promise<ResumoPrimeiroEnvioM5> {
  const agoraMs = params.agoraMs ?? Date.now();
  const tenantId = params.tenantId ?? TENANT_PADRAO_ANALYTICS;
  const { inicioMs, fimMs } = periodo90Dias(agoraMs);

  const [janela90Dias, historicoAnterior] = await Promise.all([
    consultarEventosPorPeriodo(tenantId, inicioMs, fimMs),
    consultarEventosAntesDe(tenantId, inicioMs),
  ]);
  const eventos = [...historicoAnterior, ...janela90Dias];

  const ultimos = ultimoEventoEntreguePorCliente(eventos);
  const comportamentais: CandidatoPrimeiroEnvioM5[] = [];

  for (const [clienteId, ultimo] of ultimos.entries()) {
    const validacao = validarCandidatoMomentoControlado({
      eventos,
      clienteId,
      momentId: "M5",
      triggerEventId: ultimo.pedidoId,
      agoraMs,
    });
    if (!validacao.valido) continue;

    const telefone = telefoneDoClienteId(clienteId);
    if (!telefone) continue;
    const customerKey = derivarResearchCustomerKey(telefone);
    if (!customerKey) continue;

    comportamentais.push({
      candidateRef: refCandidato({
        customerKey,
        triggerEventId: ultimo.pedidoId,
      }),
      telefoneMascarado: mascararTelefone(telefone),
      triggerEventId: ultimo.pedidoId,
      ultimaCompraEmMs: ultimo.criadoEmMs,
    });
  }

  // Candidato M5 mais antigo primeiro: dentro da faixa válida, privilegia
  // quem está mais perto de sair para S6 sem inventar score.
  comportamentais.sort((a, b) => a.ultimaCompraEmMs - b.ultimaCompraEmMs);

  const semBloqueioAutomatico: CandidatoPrimeiroEnvioM5[] = [];
  for (const candidato of comportamentais) {
    const telefone = telefoneDoClienteId(
      [...ultimos.entries()].find(
        ([, evento]) => evento.pedidoId === candidato.triggerEventId
      )?.[0] ?? ""
    );
    if (!telefone) continue;

    // Os dois sinais manuais permanecem deliberadamente AUSENTES.
    // Portanto o gate deve retornar fontes_operacionais_incompletas.
    // Só aceitamos como "pré-candidato" quando esse for o ÚNICO bloqueio.
    const gate = await avaliarElegibilidadeContatoPesquisaCompleta({
      telefone,
      agoraMs,
    });
    const outrosMotivos = gate.elegibilidade.motivos.filter(
      (motivo) => motivo !== MOTIVO_MANUAL_PENDENTE
    );
    if (outrosMotivos.length === 0) {
      semBloqueioAutomatico.push(candidato);
    }
  }

  return {
    candidatosComportamentais: comportamentais.length,
    candidatosSemBloqueioAutomatico: semBloqueioAutomatico.length,
    prontoParaConfirmacaoManual: semBloqueioAutomatico.length > 0,
    primeiroCandidato: semBloqueioAutomatico[0] ?? null,
  };
}

export async function resolverCandidatoPrimeiroEnvioM5(params: {
  candidateRef: string;
  agoraMs?: number;
}): Promise<{ telefone: string; triggerEventId: string } | null> {
  const ref = params.candidateRef.trim();
  if (!/^[a-f0-9]{64}$/.test(ref)) return null;

  const resumo = await resumirPrimeiroEnvioM5({ agoraMs: params.agoraMs });
  const candidato = resumo.primeiroCandidato;
  if (!candidato || candidato.candidateRef !== ref) return null;

  const agoraMs = params.agoraMs ?? Date.now();
  const { inicioMs, fimMs } = periodo90Dias(agoraMs);
  const [janela90Dias, historicoAnterior] = await Promise.all([
    consultarEventosPorPeriodo(TENANT_PADRAO_ANALYTICS, inicioMs, fimMs),
    consultarEventosAntesDe(TENANT_PADRAO_ANALYTICS, inicioMs),
  ]);
  const eventos = [...historicoAnterior, ...janela90Dias];
  const ultimos = ultimoEventoEntreguePorCliente(eventos);
  const entrada = [...ultimos.entries()].find(
    ([, evento]) => evento.pedidoId === candidato.triggerEventId
  );
  if (!entrada) return null;

  const telefone = telefoneDoClienteId(entrada[0]);
  if (!telefone) return null;

  const instrumento = obterInstrumentoPesquisa("M5");
  if (!instrumento) return null;

  return {
    telefone,
    triggerEventId: candidato.triggerEventId,
  };
}
