import { redis } from "@/lib/redis";

const CHAVE_AUDITORIA = "whatsapp:auditoria:reconstrucoes";
const MAX_REGISTROS = 100;

export type RegistroAuditoriaReconstrucao = {
  usuario: string;
  papel: string;
  criadoEm: string;
  resultado: "sucesso" | "falha";
  etapaFalha?: string | null;
};

/** Grava a auditoria da ação destrutiva de reconstrução — nunca inclui apikey, QR ou corpo bruto. */
export async function registrarAuditoriaReconstrucao(registro: RegistroAuditoriaReconstrucao): Promise<void> {
  const atual = (await redis.get<RegistroAuditoriaReconstrucao[]>(CHAVE_AUDITORIA)) || [];
  const novo = [registro, ...atual].slice(0, MAX_REGISTROS);
  await redis.set(CHAVE_AUDITORIA, novo);
}

export async function obterAuditoriaReconstrucoes(limite = 20): Promise<RegistroAuditoriaReconstrucao[]> {
  const atual = (await redis.get<RegistroAuditoriaReconstrucao[]>(CHAVE_AUDITORIA)) || [];
  return atual.slice(0, limite);
}
