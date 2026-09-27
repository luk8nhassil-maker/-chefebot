import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  ErroFotoPerfilStorage,
  apagarFotoBlob,
  lerFotoBlob,
  salvarFotoBlob,
} from "./fotoPerfilStorage";

const TOKEN = "vercel_blob_rw_store123_secret";

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", TOKEN);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fotoPerfilStorage", () => {
  test("falha fechado sem store/token oficial configurado", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    await expect(salvarFotoBlob("perfil-fotos/a.jpg", Buffer.from([1]))).rejects.toMatchObject({
      codigo: "nao_configurado",
    } satisfies Partial<ErroFotoPerfilStorage>);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("upload usa Vercel Blob privado e nunca expõe token no corpo", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      url: "https://store123.private.blob.vercel-storage.com/perfil-fotos/a.jpg",
      pathname: "perfil-fotos/a.jpg",
      etag: "etag-a",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const salvo = await salvarFotoBlob("perfil-fotos/a.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(salvo.pathname).toBe("perfil-fotos/a.jpg");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("https://vercel.com/api/blob/");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-vercel-blob-access")).toBe("private");
    expect(headers.get("x-vercel-blob-store-id")).toBe("store123");
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(String(init?.body)).not.toContain(TOKEN);
  });

  test("leitura aceita somente URL privada do Vercel Blob", async () => {
    await expect(lerFotoBlob("https://example.com/foto.jpg")).rejects.toMatchObject({
      codigo: "resposta_invalida",
    } satisfies Partial<ErroFotoPerfilStorage>);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("leitura privada usa autenticação e devolve bytes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200 }));
    const bytes = await lerFotoBlob("https://store123.private.blob.vercel-storage.com/perfil-fotos/a.jpg");
    expect(bytes).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("cache=0");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  test("delete é limitado ao domínio privado oficial", async () => {
    await apagarFotoBlob("https://example.com/foto.jpg");
    expect(fetch).not.toHaveBeenCalled();

    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    await apagarFotoBlob("https://store123.private.blob.vercel-storage.com/perfil-fotos/a.jpg");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://vercel.com/api/blob/delete");
    expect(init?.method).toBe("POST");
  });
});
