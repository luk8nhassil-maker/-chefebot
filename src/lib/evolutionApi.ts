// Helpers compartilhados entre as rotas que falam com a Evolution API
// (qrcode, reset) — extração do QR e diagnóstico de erro, sem duplicar a
// mesma lógica em cada rota.

/**
 * Extrai o QR em base64 de qualquer um dos formatos observados/documentados
 * da Evolution API. Só reconhece caminhos comprovados — nunca inventa um novo.
 */
export function extrairQrBase64(data: unknown): string | null {
  const d = data as Record<string, unknown> | null | undefined;
  if (!d) return null;
  if (typeof d.base64 === "string") return d.base64;
  const qrcode = d.qrcode as Record<string, unknown> | undefined;
  if (qrcode && typeof qrcode.base64 === "string") return qrcode.base64;
  const qr = d.qr as Record<string, unknown> | undefined;
  if (qr && typeof qr.base64 === "string") return qr.base64;
  return null;
}

/**
 * A Evolution API (app-level) responde erro de instância com o próprio
 * formato dela. Quando o *host* configurado em EVOLUTION_API_URL não tem
 * nenhum serviço respondendo ali (app deletado/fora do ar no Railway, URL
 * errada etc.), a borda do Railway responde um 404 genérico, sempre no
 * mesmo formato — `{status:"error", code, message:"Application not found",
 * request_id}` — independente do caminho chamado (connect, create, delete
 * ou logout dão exatamente a mesma resposta). Isso é o sinal de que o
 * problema é de infraestrutura/configuração (EVOLUTION_API_URL apontando
 * para um serviço que não existe mais), não de "instância não encontrada"
 * dentro da Evolution API — nenhum retry ou payload novo resolve isso.
 */
export function ehErroPlataformaIndisponivel(status: number, data: unknown): boolean {
  const d = data as Record<string, unknown> | null | undefined;
  if (!d) return false;
  return (
    status === 404 &&
    d.status === "error" &&
    d.message === "Application not found" &&
    typeof d.request_id === "string"
  );
}

/** Mensagem segura para expor ao cliente — nunca o corpo bruto da Evolution API. */
export function mensagemErroEvolution(status: number, data: unknown): string {
  if (ehErroPlataformaIndisponivel(status, data)) {
    return "A Evolution API não está acessível no endereço configurado (EVOLUTION_API_URL). Verifique se o serviço está no ar.";
  }
  const d = data as Record<string, unknown> | null | undefined;
  // Evolution API (NestJS) costuma responder validação como message: string[].
  let mensagem: string | null = null;
  if (typeof d?.message === "string") mensagem = d.message;
  else if (Array.isArray(d?.message) && d.message.every((m) => typeof m === "string")) mensagem = d.message.join("; ");
  return mensagem ? `Evolution API: ${mensagem}` : "Evolution API retornou erro";
}
