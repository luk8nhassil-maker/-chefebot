import { redis } from "./redis";

export type StatusConexao = "connected" | "disconnected" | "connecting";

type EstadoConexao = {
  status: StatusConexao;
  atualizadoEm: string; // ISO
};

const CHAVE_STATUS = "whatsapp_connection_status";

// Salva o status atual da conexão no Redis (fonte da verdade para o resto do sistema)
export async function salvarStatusConexao(status: StatusConexao): Promise<void> {
  const estado: EstadoConexao = { status, atualizadoEm: new Date().toISOString() };
  await redis.set(CHAVE_STATUS, estado);
}

// Lê o status atual. Se nunca foi salvo, assume "connected" (estado padrão/otimista,
// para não pausar o bot por engano antes do primeiro evento de conexão chegar).
export async function lerStatusConexao(): Promise<EstadoConexao> {
  const estado = await redis.get<EstadoConexao>(CHAVE_STATUS);
  return estado || { status: "connected", atualizadoEm: new Date().toISOString() };
}

// O bot só deve responder mensagens quando a conexão estiver realmente ativa.
// Durante "connecting" ou "disconnected", as respostas ficam pausadas (mensagens
// continuam chegando e sendo salvas pelo webhook normalmente — não se perde nada,
// só não dispara resposta automática enquanto o WhatsApp não está de fato conectado).
export async function botPodeResponder(): Promise<boolean> {
  const estado = await lerStatusConexao();
  return estado.status === "connected";
}
