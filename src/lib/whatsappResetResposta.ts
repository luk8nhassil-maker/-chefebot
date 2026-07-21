// Interpretação pura da resposta de POST /api/whatsapp/reset — extraída do
// admin para ser testável sem depender de infraestrutura de teste de React.
// Nunca trata { ok: true, estado: "connected" } sem QR como erro.

export type ResultadoResetInterpretado =
  | { tipo: "qr"; base64: string; generatedAt?: number; expiresAt?: number; generationId?: number }
  | { tipo: "connected" }
  | { tipo: "erro"; mensagem: string };

const MENSAGEM_PADRAO = "Não foi possível resetar a conexão do WhatsApp.";

function numeroOuUndefined(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

export function interpretarRespostaReset(d: unknown): ResultadoResetInterpretado {
  const data = d as Record<string, unknown> | null | undefined;
  const qrcode = data?.qrcode as Record<string, unknown> | undefined;
  const base64 = typeof qrcode?.base64 === "string" ? qrcode.base64 : null;

  if (data?.ok === true && base64) {
    return {
      tipo: "qr",
      base64,
      generatedAt: numeroOuUndefined(qrcode?.generatedAt),
      expiresAt: numeroOuUndefined(qrcode?.expiresAt),
      generationId: numeroOuUndefined(qrcode?.generationId),
    };
  }
  if (data?.ok === true && data?.estado === "connected") {
    return { tipo: "connected" };
  }
  const mensagem = typeof data?.error === "string" ? data.error : MENSAGEM_PADRAO;
  return { tipo: "erro", mensagem };
}
