import "server-only";

import { createHmac } from "crypto";

export const FOTO_PERFIL_MAX_BYTES = 700 * 1024;
export const FOTO_PERFIL_TIPOS = ["image/jpeg", "image/png", "image/webp"] as const;
export type FotoPerfilContentType = (typeof FOTO_PERFIL_TIPOS)[number];

export class ErroFotoPerfilStorage extends Error {
  constructor(readonly codigo:
    | "arquivo_invalido"
    | "arquivo_muito_grande"
    | "tipo_nao_permitido"
    | "conteudo_invalido"
    | "storage_nao_configurado"
    | "storage_indisponivel"
  ) {
    super(codigo);
    this.name = "ErroFotoPerfilStorage";
  }
}

type EnvBlob = {
  BLOB_READ_WRITE_TOKEN?: string;
  BLOB_STORE_ID?: string;
  VERCEL_OIDC_TOKEN?: string;
  PRIVACY_CONSENT_HMAC_SECRET?: string;
  VERCEL_BLOB_API_URL?: string;
};

function envTexto(valor: string | undefined): string | null {
  const limpo = valor?.trim();
  return limpo ? limpo : null;
}

function storeIdDoToken(token: string): string | null {
  const partes = token.split("_");
  return partes.length >= 4 && partes[3] ? partes[3] : null;
}

export function resolverCredenciaisBlob(env: EnvBlob = process.env as EnvBlob): { token: string; storeId: string; apiUrl: string } {
  const oidc = envTexto(env.VERCEL_OIDC_TOKEN);
  const storeEnv = envTexto(env.BLOB_STORE_ID)?.replace(/^store_/, "") ?? null;
  if (oidc && storeEnv) {
    return { token: oidc, storeId: storeEnv, apiUrl: envTexto(env.VERCEL_BLOB_API_URL) ?? "https://blob.vercel-storage.com" };
  }

  const token = envTexto(env.BLOB_READ_WRITE_TOKEN);
  const storeToken = token ? storeIdDoToken(token) : null;
  if (token && storeToken) {
    return { token, storeId: storeToken, apiUrl: envTexto(env.VERCEL_BLOB_API_URL) ?? "https://blob.vercel-storage.com" };
  }
  throw new ErroFotoPerfilStorage("storage_nao_configurado");
}

export function referenciaFotoPerfil(clienteId: string, env: { PRIVACY_CONSENT_HMAC_SECRET?: string } = process.env as { PRIVACY_CONSENT_HMAC_SECRET?: string }): string {
  const segredo = envTexto(env.PRIVACY_CONSENT_HMAC_SECRET);
  if (!segredo || segredo.length < 16 || !clienteId) {
    throw new ErroFotoPerfilStorage("storage_nao_configurado");
  }
  return createHmac("sha256", segredo).update(`perfil-foto:v1:${clienteId}`).digest("hex");
}

export function pathnameFotoPerfil(clienteId: string): string {
  return `perfil/${referenciaFotoPerfil(clienteId)}/avatar`;
}

function pareceJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
function parecePng(bytes: Uint8Array): boolean {
  const assinatura = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
  return bytes.length >= assinatura.length && assinatura.every((b, i) => bytes[i] === b);
}
function pareceWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

export function validarFotoPerfil(contentType: string, bytes: Uint8Array): FotoPerfilContentType {
  if (!bytes.length) throw new ErroFotoPerfilStorage("arquivo_invalido");
  if (bytes.byteLength > FOTO_PERFIL_MAX_BYTES) throw new ErroFotoPerfilStorage("arquivo_muito_grande");
  if (!(FOTO_PERFIL_TIPOS as readonly string[]).includes(contentType)) throw new ErroFotoPerfilStorage("tipo_nao_permitido");

  const assinaturaOk =
    (contentType === "image/jpeg" && pareceJpeg(bytes)) ||
    (contentType === "image/png" && parecePng(bytes)) ||
    (contentType === "image/webp" && pareceWebp(bytes));
  if (!assinaturaOk) throw new ErroFotoPerfilStorage("conteudo_invalido");
  return contentType as FotoPerfilContentType;
}

type BlobPutResult = { pathname?: string; etag?: string; contentType?: string };

export async function salvarFotoPerfilBlob(params: {
  clienteId: string;
  bytes: Uint8Array;
  contentType: FotoPerfilContentType;
}): Promise<{ pathname: string; etag: string | null }> {
  const cred = resolverCredenciaisBlob();
  const pathname = pathnameFotoPerfil(params.clienteId);
  const url = new URL("/", cred.apiUrl);
  url.searchParams.set("pathname", pathname);

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${cred.token}`,
        "x-vercel-blob-store-id": cred.storeId,
        "x-api-version": "12",
        "x-vercel-blob-access": "private",
        "x-add-random-suffix": "0",
        "x-allow-overwrite": "1",
        "x-content-type": params.contentType,
        "x-cache-control-max-age": "3600",
      },
      body: Buffer.from(params.bytes),
    });
  } catch {
    throw new ErroFotoPerfilStorage("storage_indisponivel");
  }

  if (!resposta.ok) throw new ErroFotoPerfilStorage(resposta.status === 401 || resposta.status === 403 ? "storage_nao_configurado" : "storage_indisponivel");
  const resultado = await resposta.json().catch(() => null) as BlobPutResult | null;
  if (!resultado?.pathname) throw new ErroFotoPerfilStorage("storage_indisponivel");
  return { pathname: resultado.pathname, etag: resultado.etag ?? null };
}

export async function lerFotoPerfilBlob(pathname: string): Promise<Response> {
  const cred = resolverCredenciaisBlob();
  const caminho = pathname.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`https://${cred.storeId}.private.blob.vercel-storage.com/${caminho}`);
  try {
    const resposta = await fetch(url, { headers: { authorization: `Bearer ${cred.token}` } });
    if (!resposta.ok) throw new ErroFotoPerfilStorage("storage_indisponivel");
    return resposta;
  } catch (erro) {
    if (erro instanceof ErroFotoPerfilStorage) throw erro;
    throw new ErroFotoPerfilStorage("storage_indisponivel");
  }
}
