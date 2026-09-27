import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ErroFotoPerfilStorage,
  pathnameFotoPerfil,
  resolverCredenciaisBlob,
  salvarFotoPerfilBlob,
  validarFotoPerfil,
} from "./perfilFotoStorage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("perfilFotoStorage", () => {
  test("prefere OIDC + BLOB_STORE_ID e normaliza prefixo store_", () => {
    expect(resolverCredenciaisBlob({
      VERCEL_OIDC_TOKEN: "oidc-token",
      BLOB_STORE_ID: "store_abc123",
      BLOB_READ_WRITE_TOKEN: undefined,
      AUTH_SECRET: "x".repeat(32),
      VERCEL_BLOB_API_URL: undefined,
    })).toMatchObject({ token: "oidc-token", storeId: "abc123" });
  });

  test("fallback para token read-write extrai store id sem expor cliente", () => {
    expect(resolverCredenciaisBlob({
      VERCEL_OIDC_TOKEN: undefined,
      BLOB_STORE_ID: undefined,
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_store123_segredo",
      AUTH_SECRET: "x".repeat(32),
      VERCEL_BLOB_API_URL: undefined,
    }).storeId).toBe("store123");
  });

  test("sem credencial falha fechado", () => {
    expect(() => resolverCredenciaisBlob({
      VERCEL_OIDC_TOKEN: undefined,
      BLOB_STORE_ID: undefined,
      BLOB_READ_WRITE_TOKEN: undefined,
      AUTH_SECRET: "x".repeat(32),
      VERCEL_BLOB_API_URL: undefined,
    })).toThrowError(ErroFotoPerfilStorage);
  });

  test("valida assinatura real e tamanho, não confia só no MIME", () => {
    const webp = new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80,1]);
    expect(validarFotoPerfil("image/webp", webp)).toBe("image/webp");
    expect(() => validarFotoPerfil("image/webp", new Uint8Array([1,2,3]))).toThrowError("conteudo_invalido");
  });

  test("pathname usa HMAC e nunca inclui clienteId bruto", () => {
    const anterior = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
    const path = pathnameFotoPerfil("cli_5599999999999");
    expect(path).toMatch(/^perfil\/[a-f0-9]{64}\/avatar$/);
    expect(path).not.toContain("5599999999999");
    process.env.AUTH_SECRET = anterior;
  });

  test("upload usa um único pathname privado e overwrite para evitar arquivos órfãos", async () => {
    const anterior = { ...process.env };
    process.env.AUTH_SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_store123_segredo";
    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.BLOB_STORE_ID;
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => new Response(JSON.stringify({
      pathname: "perfil/ref/avatar",
      etag: "etag-1",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await salvarFotoPerfilBlob({
      clienteId: "cli_5599999999999",
      bytes: new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80,1]),
      contentType: "image/webp",
    });
    expect(resultado.pathname).toBe("perfil/ref/avatar");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string,string>;
    expect(headers["x-vercel-blob-access"]).toBe("private");
    expect(headers["x-add-random-suffix"]).toBe("0");
    expect(headers["x-allow-overwrite"]).toBe("1");

    process.env = anterior;
  });
});
