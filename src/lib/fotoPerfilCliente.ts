import "server-only";

import { createHash } from "crypto";
import { redis } from "./redis";

export const FOTO_PERFIL_MAX_BYTES = 48 * 1024;
const VERSAO_MISSAO = "foto-perfil-primeiro-presente-v1" as const;

type RegistroFotoPerfil = {
  dataUrl: string;
  mimeType: "image/jpeg";
  updatedAt: string;
  versao: "foto-perfil-v1";
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
  return `perfil:foto:v1:${referenciaCliente(clienteId)}`;
}

function chaveMissao(clienteId: string): string {
  return `gamificacao:missao:foto-perfil:v1:${referenciaCliente(clienteId)}`;
}

function registroFotoValido(valor: unknown): valor is RegistroFotoPerfil {
  if (!valor || typeof valor !== "object") return false;
  const item = valor as Partial<RegistroFotoPerfil>;
  return item.versao === "foto-perfil-v1"
    && item.mimeType === "image/jpeg"
    && typeof item.dataUrl === "string"
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

export async function obterFotoPerfilCliente(clienteId: string): Promise<RegistroFotoPerfil | null> {
  const valor = await redis.get<RegistroFotoPerfil>(chaveFoto(clienteId));
  return registroFotoValido(valor) ? valor : null;
}

export async function missaoFotoPerfilConcluida(clienteId: string): Promise<boolean> {
  const valor = await redis.get<RegistroMissaoFotoPerfil>(chaveMissao(clienteId));
  return registroMissaoValido(valor);
}

/**
 * Salva somente uma miniatura JPEG já normalizada pelo cliente autenticado.
 * A conclusão da missão é permanente e vive em chave separada: trocar a foto
 * depois nunca reabre a trava do primeiro presente.
 */
export async function salvarFotoPerfilCliente(clienteId: string, dataUrl: unknown): Promise<{
  foto: RegistroFotoPerfil;
  missao: RegistroMissaoFotoPerfil;
}> {
  const fotoNormalizada = validarFotoPerfilDataUrl(dataUrl);
  const agora = new Date().toISOString();
  const foto: RegistroFotoPerfil = {
    dataUrl: fotoNormalizada,
    mimeType: "image/jpeg",
    updatedAt: agora,
    versao: "foto-perfil-v1",
  };

  const missaoExistente = await redis.get<RegistroMissaoFotoPerfil>(chaveMissao(clienteId));
  const missao: RegistroMissaoFotoPerfil = registroMissaoValido(missaoExistente)
    ? missaoExistente
    : { concluida: true, concluidaEm: agora, versao: VERSAO_MISSAO };

  const transacao = redis.multi().set(chaveFoto(clienteId), foto);
  if (!registroMissaoValido(missaoExistente)) transacao.set(chaveMissao(clienteId), missao);
  await transacao.exec();

  return { foto, missao };
}
