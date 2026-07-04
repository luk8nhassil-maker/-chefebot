import { createHash } from "crypto";

export const PIX_COMPROVANTE_DEDUP_TTL_SEGUNDOS = 30 * 24 * 60 * 60;

function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function base64Limpo(base64: string): string {
  const semPrefixo = base64.includes(",") ? base64.split(",").pop() || "" : base64;
  return semPrefixo.replace(/\s+/g, "");
}

export function normalizarTextoComprovantePix(texto: string): string {
  return texto
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function gerarHashComprovantePixMidia(base64: string): string {
  return sha256Hex(Buffer.from(base64Limpo(base64), "base64"));
}

export function gerarHashComprovantePixTexto(texto: string): string {
  return sha256Hex(normalizarTextoComprovantePix(texto));
}

export function chaveDedupComprovantePix(hash: string): string {
  return `pix_comprovante_hash:${hash}`;
}
