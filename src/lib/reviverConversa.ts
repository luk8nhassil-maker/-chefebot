import type { BotSession } from "./bot";
import { calcularResumoAtendimentoHumano } from "./resumoAtendimentoHumano";

// Steps onde a conversa fica "morta": bot não avança e fica em loop.
// "escalado" é o caso crítico: manual lock pode expirar mas o step não muda,
// fazendo o bot repetir "Já avisamos" indefinidamente sem evoluir.
export const STEPS_TRAVADOS = ["done", "escalado"] as const;
export type StepTravado = (typeof STEPS_TRAVADOS)[number];

export type ContextoReviver = {
  emManual: boolean;
  botAtivo: boolean;
  aguardandoPix: boolean;
  cooldownAtivo: boolean;
};

export type ResultadoReviverConversa = {
  deveReviver: boolean;
  motivo?: string;
  novoStep?: string;
};

export function detectarConversaMorta(
  session: BotSession | null,
  contexto: ContextoReviver,
): ResultadoReviverConversa {
  if (!contexto.botAtivo) return { deveReviver: false, motivo: "bot_desligado" };
  if (contexto.emManual) return { deveReviver: false, motivo: "atendimento_manual" };
  if (contexto.aguardandoPix) return { deveReviver: false, motivo: "aguardando_pix" };
  if (contexto.cooldownAtivo) return { deveReviver: false, motivo: "cooldown_ativo" };
  if (!session) return { deveReviver: false, motivo: "sem_sessao" };
  if (!(STEPS_TRAVADOS as readonly string[]).includes(session.step)) {
    return { deveReviver: false };
  }

  const novoStep = escolherStepDeRetomada(session);
  return {
    deveReviver: true,
    motivo: `step_travado:${session.step}`,
    novoStep,
  };
}

// Determina o step mais seguro de retomada com base no que falta no pedido.
// Nunca cria dados, nunca finaliza pedido, nunca imprime.
export function escolherStepDeRetomada(session: BotSession): string {
  const resumo = calcularResumoAtendimentoHumano(session);

  if (resumo.itens.length === 0) return "category";
  if (!resumo.tipoEntrega) return "delivery_type";
  if (resumo.tipoEntrega === "delivery" && !resumo.bairro.trim()) return "neighborhood";
  if (resumo.tipoEntrega === "delivery" && !resumo.endereco.trim()) return "address";
  if (!resumo.pagamento.trim()) return "payment";
  if (!session.customerName?.trim()) return "pedindo_nome";
  return "confirm";
}
