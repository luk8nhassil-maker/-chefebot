import "server-only";

import { randomUUID } from "crypto";

const BLOB_API = "https://vercel.com/api/blob";
const BLOB_API_VERSION = "12";
const TENTATIVAS = 3;
const TIMEOUT_MS = 8_000;

export class ErroFotoPerfilStorage extends Error {
  constructor(readonly codigo: "nao_configurado" | "indisponivel" | "resposta_invalida") {
    super(codigo);
    this.name = "ErroFotoPerfilStorage";
  }
}

type CredenciaisBlob = {
  token: string;
  storeId: string;
};

export type FotoBlobSalva = {
  url: string;
  pathname: string;
  etag: string | null;
};

function credenciais(): CredenciaisBlob {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new ErroFotoPerfilStorage("nao_configurado");
  const [, , , storeId = ""] = token.split("_");
  if (!storeId) throw new ErroFotoPerfilStorage("nao_configurado");
  return { token, storeId };
}

function headersBlob(extra: Record<string, string> = {}): Record<string, string> {
  const { token, storeId } = credenciais();
  return {
    authorization: `Bearer ${token}`,
    "x-vercel-blob-store-id": storeId,
    "x-api-version": BLOB_API_VERSION,
    "x-api-blob-request-id": `${storeId}:${Date.now()}:${randomUUID()}`,
    "x-api-blob-request-attempt": "0",
    ...extra,
  };
}

function urlBlobPrivadaValida(valor: string): boolean {
  try {
    const url = new URL(valor);
    return url.protocol === "https:" && url.hostname.endsWith(".private.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

async function executarComRetry(
  input: string,
  init: RequestInit,
): Promise<Response> {
  let ultimoErro: unknown;
  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers = new Headers(init.headers);
      headers.set("x-api-blob-request-attempt", String(tentativa));
      const resposta = await fetch(input, { ...init, headers, signal: controller.signal });
      if (resposta.ok || resposta.status === 404) return resposta;
      if (resposta.status < 500 && resposta.status !== 429) {
        throw new ErroFotoPerfilStorage("indisponivel");
      }
      ultimoErro = new Error(`blob_http_${resposta.status}`);
    } catch (erro) {
      ultimoErro = erro;
      if (erro instanceof ErroFotoPerfilStorage) throw erro;
    } finally {
      clearTimeout(timer);
    }
    if (tentativa + 1 < TENTATIVAS) {
      await new Promise((resolve) => setTimeout(resolve, 80 * (tentativa + 1)));
    }
  }
  void ultimoErro;
  throw new ErroFotoPerfilStorage("indisponivel");
}

/**
 * Usa diretamente o endpoint oficial do Vercel Blob com o token do Store
 * conectado ao projeto. Nenhum byte da foto passa a ser persistido no Redis.
 */
export async function salvarFotoBlob(pathname: string, bytes: Buffer): Promise<FotoBlobSalva> {
  const resposta = await executarComRetry(
    `${BLOB_API}/?pathname=${encodeURIComponent(pathname)}`,
    {
      method: "PUT",
      headers: headersBlob({
        "x-vercel-blob-access": "private",
        "x-content-type": "image/jpeg",
        "x-add-random-suffix": "0",
        "x-allow-overwrite": "0",
        "content-type": "image/jpeg",
      }),
      body: new Uint8Array(bytes),
    },
  );
  if (!resposta.ok) throw new ErroFotoPerfilStorage("indisponivel");

  const data = await resposta.json().catch(() => null) as null | {
    url?: unknown;
    pathname?: unknown;
    etag?: unknown;
  };
  if (!data || typeof data.url !== "string" || typeof data.pathname !== "string" || !urlBlobPrivadaValida(data.url)) {
    throw new ErroFotoPerfilStorage("resposta_invalida");
  }
  return {
    url: data.url,
    pathname: data.pathname,
    etag: typeof data.etag === "string" ? data.etag : null,
  };
}

export async function lerFotoBlob(url: string): Promise<Buffer | null> {
  if (!urlBlobPrivadaValida(url)) throw new ErroFotoPerfilStorage("resposta_invalida");
  const destino = new URL(url);
  destino.searchParams.set("cache", "0");
  const resposta = await executarComRetry(destino.toString(), {
    method: "GET",
    headers: headersBlob(),
    cache: "no-store",
  });
  if (resposta.status === 404) return null;
  if (!resposta.ok) throw new ErroFotoPerfilStorage("indisponivel");
  return Buffer.from(await resposta.arrayBuffer());
}

export async function apagarFotoBlob(url: string): Promise<void> {
  if (!urlBlobPrivadaValida(url)) return;
  const resposta = await executarComRetry(`${BLOB_API}/delete`, {
    method: "POST",
    headers: headersBlob({ "content-type": "application/json" }),
    body: JSON.stringify({ urls: [url] }),
  });
  if (!resposta.ok && resposta.status !== 404) throw new ErroFotoPerfilStorage("indisponivel");
}
