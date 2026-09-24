import { createHash, randomUUID } from "node:crypto";
import { registrarMensagem } from "./conversa";
import { derivarClienteIdPorTelefone } from "./fidelidade";
import {
  consultarEventosAntesDe,
  consultarEventosPorPeriodo,
  periodo90Dias,
  TENANT_PADRAO_ANALYTICS,
} from "./historicoAnalitico";
import type { MomentoPesquisaId } from "./pesquisaPreferencia";
import { validarCandidatoMomentoControlado } from "./pesquisaPreferenciaCandidato";
import { avaliarElegibilidadeContatoPesquisaCompleta } from "./pesquisaPreferenciaElegibilidadeCompleta.server";
import { obterInstrumentoPesquisa } from "./pesquisaPreferenciaRegistro";
import {
  derivarResearchCustomerKey,
  registrarContatoPesquisaConfirmado,
} from "./pesquisaPreferenciaContatosRedis";
import { registrarPesquisaPendente } from "./pesquisaPreferenciaRespostaRedis";
import { redis } from "./redis";
import { enviarTextoWhatsApp } from "./whatsappMensagem";

const TTL_ESTADO_ENVIO_SEGUNDOS = 90 * 24 * 60 * 60;
const TTL_MUTEX_SEGUNDOS = 60;
const LIBERAR_MUTEX_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

type EstadoEnvioControlado =
  | {
      status: "preparando";
      criadoEmMs: number;
      momentId: MomentoPesquisaId;
      triggerEventId: string;
      questionId: string;
      questionVersion: number;
    }
  | {
      status: "enviado";
      criadoEmMs: number;
      sentAtMs: number;
      momentId: MomentoPesquisaId;
      triggerEventId: string;
      questionId: string;
      questionVersion: number;
    };

export type ResultadoEnvioPesquisaControlado =
  | {
      status: "enviado" | "ja_enviado_reconciliado";
      exposureId: string;
    }
  | {
      status:
        | "suprimido"
        | "candidato_invalido"
        | "momento_sem_instrumento"
        | "em_processamento"
        | "resultado_envio_indeterminado"
        | "envio_nao_realizado";
      motivos: string[];
    };

function chaveMutex(customerKey: string): string {
  return `pesquisa:envio-controlado:mutex:v1:${customerKey}`;
}

function exposureId(params: {
  customerKey: string;
  momentId: MomentoPesquisaId;
  triggerEventId: string;
  questionId: string;
  questionVersion: number;
}): string {
  return createHash("sha256")
    .update(
      [
        "chefebot:research:controlled:v1",
        params.customerKey,
        params.momentId,
        params.triggerEventId,
        params.questionId,
        String(params.questionVersion),
      ].join(":")
    )
    .digest("hex");
}

function chaveEstado(exposure: string): string {
  return `pesquisa:envio-controlado:v1:${exposure}`;
}

function mensagemControlada(pergunta: string): string {
  return `${pergunta}\n\nSe preferir não receber pesquisas, responda *SAIR*.`;
}

function falhaComprovadamenteSemEnvio(motivo?: string, statusHttp?: number): boolean {
  if (motivo === "provider_not_configured") return true;
  if (motivo === "subscription_silenced_new_contact") return true;
  return typeof statusHttp === "number" && statusHttp >= 400 && statusHttp < 500;
}

async function liberarMutex(chave: string, token: string): Promise<void> {
  try {
    await redis.eval(LIBERAR_MUTEX_LUA, [chave], [token]);
  } catch {
    // TTL curto evita lock permanente. Nunca derruba o resultado do envio.
  }
}

async function reconciliarEnvioConfirmado(params: {
  telefone: string;
  exposureId: string;
  estado: Extract<EstadoEnvioControlado, { status: "enviado" }>;
}): Promise<void> {
  const contatoOk = await registrarContatoPesquisaConfirmado({
    telefone: params.telefone,
    origem: "motor_preferencia",
    eventId: params.exposureId,
    sentAtMs: params.estado.sentAtMs,
  });
  if (!contatoOk) {
    throw new Error("research_contact_budget_not_persisted");
  }

  const pendenciaOk = await registrarPesquisaPendente({
    telefone: params.telefone,
    exposureId: params.exposureId,
    momentId: params.estado.momentId,
    questionId: params.estado.questionId,
    questionVersion: params.estado.questionVersion,
    sentAtMs: params.estado.sentAtMs,
  });
  if (!pendenciaOk) {
    throw new Error("research_pending_response_not_persisted");
  }
}

export async function executarEnvioPesquisaControlado(params: {
  telefone: string;
  momentId: MomentoPesquisaId;
  triggerEventId: string;
  checkoutWebEmAndamento: boolean;
  disputaOuEstornoExternoAberto: boolean;
  agoraMs?: number;
}): Promise<ResultadoEnvioPesquisaControlado> {
  const agoraMs = params.agoraMs ?? Date.now();
  const clienteId = derivarClienteIdPorTelefone(params.telefone);
  const customerKey = derivarResearchCustomerKey(params.telefone);

  if (!clienteId || !customerKey) {
    return { status: "suprimido", motivos: ["identidade_incerta"] };
  }

  const instrumento = obterInstrumentoPesquisa(params.momentId);
  if (!instrumento) {
    return { status: "momento_sem_instrumento", motivos: ["sem_instrumento"] };
  }

  const mutexKey = chaveMutex(customerKey);
  const mutexToken = randomUUID();
  const lock = await redis.set(mutexKey, mutexToken, {
    nx: true,
    ex: TTL_MUTEX_SEGUNDOS,
  });
  if (!lock) {
    return { status: "em_processamento", motivos: ["mutex_cliente_ocupado"] };
  }

  try {
    // Revalida tudo dentro do lock, imediatamente antes do envio.
    const { inicioMs, fimMs } = periodo90Dias(agoraMs);
    const [janela90Dias, historicoAnterior] = await Promise.all([
      consultarEventosPorPeriodo(TENANT_PADRAO_ANALYTICS, inicioMs, fimMs),
      consultarEventosAntesDe(TENANT_PADRAO_ANALYTICS, inicioMs),
    ]);
    const eventos = [...historicoAnterior, ...janela90Dias];

    const candidato = validarCandidatoMomentoControlado({
      eventos,
      clienteId,
      momentId: params.momentId,
      triggerEventId: params.triggerEventId,
      agoraMs,
    });
    if (!candidato.valido) {
      return { status: "candidato_invalido", motivos: [candidato.motivo] };
    }

    const gate = await avaliarElegibilidadeContatoPesquisaCompleta({
      telefone: params.telefone,
      agoraMs,
      sinaisControlados: {
        checkoutWebEmAndamento: params.checkoutWebEmAndamento,
        disputaOuEstornoExternoAberto: params.disputaOuEstornoExternoAberto,
      },
    });
    if (gate.elegibilidade.status !== "elegivel") {
      return {
        status: "suprimido",
        motivos: gate.elegibilidade.motivos,
      };
    }

    const expId = exposureId({
      customerKey,
      momentId: params.momentId,
      triggerEventId: params.triggerEventId,
      questionId: instrumento.questionId,
      questionVersion: instrumento.version,
    });
    const estadoKey = chaveEstado(expId);
    const estadoExistente = await redis.get<EstadoEnvioControlado>(estadoKey);

    if (estadoExistente?.status === "enviado") {
      await reconciliarEnvioConfirmado({
        telefone: params.telefone,
        exposureId: expId,
        estado: estadoExistente,
      });
      return { status: "ja_enviado_reconciliado", exposureId: expId };
    }
    if (estadoExistente?.status === "preparando") {
      return {
        status: "em_processamento",
        motivos: ["exposicao_ja_reivindicada"],
      };
    }

    const estadoPreparando: EstadoEnvioControlado = {
      status: "preparando",
      criadoEmMs: agoraMs,
      momentId: params.momentId,
      triggerEventId: params.triggerEventId,
      questionId: instrumento.questionId,
      questionVersion: instrumento.version,
    };
    const claim = await redis.set(estadoKey, estadoPreparando, {
      nx: true,
      ex: TTL_ESTADO_ENVIO_SEGUNDOS,
    });
    if (!claim) {
      return {
        status: "em_processamento",
        motivos: ["exposicao_reivindicada_em_corrida"],
      };
    }

    const mensagem = mensagemControlada(instrumento.pergunta);
    const resultado = await enviarTextoWhatsApp(params.telefone, mensagem, {
      delay: 900,
      presence: "composing",
    });

    const envioRealConfirmado =
      resultado.ok === true &&
      resultado.tentativas > 0 &&
      resultado.motivo !== "subscription_silenced_new_contact";

    if (!envioRealConfirmado) {
      if (falhaComprovadamenteSemEnvio(resultado.motivo, resultado.statusHttp)) {
        await redis.del(estadoKey);
        return {
          status: "envio_nao_realizado",
          motivos: [resultado.motivo || "provider_recusou_envio"],
        };
      }

      // Timeout/rede/5xx têm resultado externo potencialmente ambíguo.
      // Mantemos o claim por 90 dias e NÃO tentamos novamente automaticamente.
      return {
        status: "resultado_envio_indeterminado",
        motivos: [resultado.motivo || "resultado_externo_indeterminado"],
      };
    }

    const sentAtMs = Date.now();
    const estadoEnviado: EstadoEnvioControlado = {
      ...estadoPreparando,
      status: "enviado",
      sentAtMs,
    };
    await redis.set(estadoKey, estadoEnviado, {
      ex: TTL_ESTADO_ENVIO_SEGUNDOS,
    });

    // Histórico visual/operacional do WhatsApp é best-effort e já possui
    // isolamento próprio de falhas. O texto salvo é exatamente o enviado.
    await registrarMensagem(params.telefone, "bot", mensagem);

    await reconciliarEnvioConfirmado({
      telefone: params.telefone,
      exposureId: expId,
      estado: estadoEnviado,
    });

    return { status: "enviado", exposureId: expId };
  } finally {
    await liberarMutex(mutexKey, mutexToken);
  }
}
