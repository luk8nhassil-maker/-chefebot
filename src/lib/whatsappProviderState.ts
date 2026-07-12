import { redis } from "@/lib/redis";
import type { EstadoProviderWhatsapp } from "@/lib/evolutionApi";

const CHAVE_ESTADO = "whatsapp:provider:estado";

export type EstadoProviderPersistido = {
  estado: EstadoProviderWhatsapp;
  ultimaVerificacao: string | null;
  ultimaConexaoValida: string | null;
  ultimaMensagemRecebida: string | null;
  falhasConsecutivas: number;
  ultimaEtapaFalha: string | null;
  /** Evita alertar de novo a cada rodada do cron enquanto o problema persiste. */
  ultimoAlertaEnviado: "falha" | "recuperacao" | null;
};

const ESTADO_PADRAO: EstadoProviderPersistido = {
  estado: "unknown",
  ultimaVerificacao: null,
  ultimaConexaoValida: null,
  ultimaMensagemRecebida: null,
  falhasConsecutivas: 0,
  ultimaEtapaFalha: null,
  ultimoAlertaEnviado: null,
};

export async function lerEstadoProvider(): Promise<EstadoProviderPersistido> {
  const salvo = await redis.get<EstadoProviderPersistido>(CHAVE_ESTADO);
  return salvo ? { ...ESTADO_PADRAO, ...salvo } : { ...ESTADO_PADRAO };
}

export async function salvarEstadoProvider(parcial: Partial<EstadoProviderPersistido>): Promise<EstadoProviderPersistido> {
  const atual = await lerEstadoProvider();
  const novo: EstadoProviderPersistido = { ...atual, ...parcial };
  await redis.set(CHAVE_ESTADO, novo);
  return novo;
}

/** Chamado sempre que uma verificação/ação resolve um estado real do provider. */
export async function registrarResultadoVerificacao(
  estado: EstadoProviderWhatsapp,
  opts?: { etapaFalha?: string | null }
): Promise<EstadoProviderPersistido> {
  const agora = new Date().toISOString();
  const atual = await lerEstadoProvider();
  const falhou = estado !== "connected" && estado !== "qr_required" && estado !== "connecting";
  return salvarEstadoProvider({
    estado,
    ultimaVerificacao: agora,
    ultimaConexaoValida: estado === "connected" ? agora : atual.ultimaConexaoValida,
    falhasConsecutivas: falhou ? atual.falhasConsecutivas + 1 : 0,
    ultimaEtapaFalha: falhou ? (opts?.etapaFalha ?? null) : null,
  });
}

/** Chamado pelo webhook do WhatsApp (src/app/api/whatsapp/route.ts) a cada mensagem recebida de verdade. */
export async function registrarMensagemRecebida(): Promise<void> {
  await salvarEstadoProvider({ ultimaMensagemRecebida: new Date().toISOString() });
}

/**
 * Texto curto de orientação pro admin — nunca "Resetar" como primeira opção
 * pra provider_down (a instância não está quebrada, o host é que está fora
 * do ar; resetar não resolve isso e ainda arrisca apagar uma instância boa
 * se o host voltar no meio do processo).
 */
export function acaoRecomendada(estado: EstadoProviderWhatsapp): string {
  switch (estado) {
    case "provider_not_configured":
      return "Configure EVOLUTION_API_URL e EVOLUTION_API_KEY no ambiente antes de continuar.";
    case "provider_down":
      return "O serviço da Evolution API não está respondendo. Verifique a infraestrutura (VPS/domínio) antes de tentar reconectar.";
    case "provider_unauthorized":
      return "Credencial inválida (EVOLUTION_API_KEY). Corrija a chave antes de tentar novamente.";
    case "instance_missing":
      return "A instância não existe — clique em “Conectar WhatsApp” para criá-la e escanear o QR.";
    case "instance_disconnected":
    case "qr_required":
      return "Escaneie o QR Code para conectar o WhatsApp.";
    case "connecting":
      return "Aguardando confirmação da leitura do QR Code.";
    case "connected":
      return "WhatsApp conectado — nenhuma ação necessária.";
    case "webhook_error":
      return "Conectado, mas o webhook não foi configurado corretamente — mensagens podem não chegar. Tente reconectar.";
    default:
      return "Estado desconhecido — verifique a conexão.";
  }
}
