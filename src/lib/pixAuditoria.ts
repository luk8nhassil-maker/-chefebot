import { redis } from "./redis";

// Auditoria financeira da confirmação manual de Pix no painel /pedidos.
// Nunca registrar senha, hash, token de sessão ou credenciais de provider —
// só identidade da sessão autenticada (usuario/nome/role), pedido e valores.
export type PixAuditoriaManualEntry = {
  pedidoId: string;
  metodo: "manual";
  usuario: string;
  nome: string;
  role: string;
  dataHora: string;
  valorConfirmado: number;
  origem: "painel_pedidos";
  statusAnterior: string;
  statusFinal: string;
};

const CHAVE_AUDITORIA = "pix:auditoria:manual";

export async function registrarAuditoriaPixManual(entry: PixAuditoriaManualEntry): Promise<void> {
  const atual = (await redis.get<PixAuditoriaManualEntry[]>(CHAVE_AUDITORIA)) || [];
  await redis.set(CHAVE_AUDITORIA, [...atual, entry]);
}

export async function listarAuditoriaPixManual(): Promise<PixAuditoriaManualEntry[]> {
  return (await redis.get<PixAuditoriaManualEntry[]>(CHAVE_AUDITORIA)) || [];
}
