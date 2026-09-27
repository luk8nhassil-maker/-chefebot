import "server-only";

import { createHash, randomUUID } from "crypto";
import { redis } from "./redis";
import {
  apagarFotoBlob,
  ErroFotoPerfilStorage,
  lerFotoBlob,
  salvarFotoBlob,
} from "./fotoPerfilStorage";

export const FOTO_PERFIL_MAX_BYTES = 48 * 1024;
const VERSAO_MISSAO = "foto-perfil-primeiro-presente-v1" as const;

export type RegistroFotoPerfil = {
  url: string;
  pathname: string;
  etag: string | null;
  mimeType: "image/jpeg";
  updatedAt: string;
  versao: "foto-perfil-v2";
};

type RegistroMissaoFotoPerfil = {
  concluida: true;
  concluidaEm: string;
  versao: typeof VERSAO_MISSAO;
};

export class ErroFotoPerfil extends Error {
  constructor(readonly codigo: "formato_invalido" | "arquivo_vazio" | "arquivo_grande") {
    super(codigo);
    this.name = "ErroFotoPerfil";
  }
}

function referenciaCliente(clienteId: string): string {
  if (!clienteId) throw new Error("clienteId obrigatorio");
  return createHash("sha256").update(clienteId).digest("hex");
}

function chaveFoto(clienteId: string): string {
  return `perfil:foto:v2:${referenciaCliente(clienteId)}`;
}

function chaveMissao(clienteId: string): string {
  return `gamificacao:missao:foto-perfil:v1:${referenciaCliente(clienteId)}`;
}

function registroFotoValido(valor: unknown): valor is RegistroFotoPerfil {
  if (!valor || typeof valor !== "object") return false;
  const item = valor as Partial<RegistroFotoPerfil>;
  return item.versao === "foto-perfil-v2"
    && item.mimeType === "image/jpeg"
    && typeof item.url === "string"
    && typeof item.pathname === "string"
    && (item.etag === null || typeof item.etag === "string")
    && typeof item.updatedAt === "string";
}

function registroMissaoValido(valor: unknown): valor is RegistroMissaoFotoPerfil {
  if (!valor || typeof valor !== "object") return false;
  const item = valor as Partial<RegistroMissaoFotoPerfil>;
  return item.concluida === true
    && item.versao === VERSAO_MISSAO
    && typeof item.concluidaEm === "string";
}

export function validarFotoPerfilDataUrl(dataUrl: unknown): string {
  if (typeof dataUrl !== "string") throw new ErroFotoPerfil("formato_invalido");
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new ErroFotoPerfil("formato_invalido");

  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length === 0) throw new ErroFotoPerfil("arquivo_vazio");
  if (bytes.length > FOTO_PERFIL_MAX_BYTES) throw new ErroFotoPerfil("arquivo_grande");
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new ErroFotoPerfil("formato_invalido");
  }
  return dataUrl;
}

function bytesDaFoto(dataUrl: string): Buffer {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Buffer.from(payload, "base64");
}

export function possuiHistoricoPresenteResgatado(recompensas: Array<{ status: string }>): boolean {
  return recompensas.some((recompensa) => recompensa.status === "resgatada");
}

export async function obterFotoPerfilCliente(clienteId: string): Promise<RegistroFotoPerfil | null> {
  const valor = await redis.get<RegistroFotoPerfil>(chaveFoto(clienteId));
  return registroFotoValido(valor) ? valor : null;
}

export async function obterFotoPerfilDataUrl(clienteId: string): Promise<{ dataUrl: string; updatedAt: string } | null> {
  const foto = await obterFotoPerfilCliente(clienteId);
  if (!foto) return null;
  const bytes = await lerFotoBlob(foto.url);
  if (!bytes) return null;
  return {
    dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    updatedAt: foto.updatedAt,
  };
}

export async function missaoFotoPerfilConcluida(clienteId: string): Promise<boolean> {
  const valor = await redis.get<RegistroMissaoFotoPerfil>(chaveMissao(clienteId));
  return registroMissaoValido(valor);
}

/**
 * Clientes que já tinham um presente efetivamente resgatado antes desta
 * missão não são travados retroativamente. Isso preserva a promessa anterior
 * sem criar nenhum novo benefício ou custo para a pizzaria.
 */
export async function requisitoFotoPerfilSatisfeito(
  clienteId: string,
  recompensas: Array<{ status: string }>,
): Promise<{ satisfeito: boolean; concluida: boolean; dispensadaPorHistorico: boolean }> {
  const concluida = await missaoFotoPerfilConcluida(clienteId);
  const dispensadaPorHistorico = !concluida && possuiHistoricoPresenteResgatado(recompensas);
  return { satisfeito: concluida || dispensadaPorHistorico, concluida, dispensadaPorHistorico };
}

/**
 * A imagem vai para Vercel Blob privado. O Redis guarda só metadados mínimos
 * e o marco permanente da missão. O marco só nasce depois de upload +
 * persistência concluírem com sucesso.
 */
export async function salvarFotoPerfilCliente(clienteId: string, dataUrl: unknown): Promise<{
  foto: RegistroFotoPerfil;
  missao: RegistroMissaoFotoPerfil;
}> {
  const fotoNormalizada = validarFotoPerfilDataUrl(dataUrl);
  const bytes = bytesDaFoto(fotoNormalizada);
  const agora = new Date().toISOString();
  const referencia = referenciaCliente(clienteId);
  const pathname = `perfil-fotos/v1/${referencia}/${randomUUID()}.jpg`;

  const [fotoAnterior, missaoExistente] = await Promise.all([
    obterFotoPerfilCliente(clienteId),
    redis.get<RegistroMissaoFotoPerfil>(chaveMissao(clienteId)),
  ]);

  const blob = await salvarFotoBlob(pathname, bytes);
  const foto: RegistroFotoPerfil = {
    url: blob.url,
    pathname: blob.pathname,
    etag: blob.etag,
    mimeType: "image/jpeg",
    updatedAt: agora,
    versao: "foto-perfil-v2",
  };
  const missao: RegistroMissaoFotoPerfil = registroMissaoValido(missaoExistente)
    ? missaoExistente
    : { concluida: true, concluidaEm: agora, versao: VERSAO_MISSAO };

  try {
    const transacao = redis.multi().set(chaveFoto(clienteId), foto);
    if (!registroMissaoValido(missaoExistente)) transacao.set(chaveMissao(clienteId), missao);
    await transacao.exec();
  } catch (erro) {
    await apagarFotoBlob(blob.url).catch(() => undefined);
    throw erro;
  }

  if (fotoAnterior?.url && fotoAnterior.url !== foto.url) {
    await apagarFotoBlob(fotoAnterior.url).catch(() => undefined);
  }

  return { foto, missao };
}

export { ErroFotoPerfilStorage };
