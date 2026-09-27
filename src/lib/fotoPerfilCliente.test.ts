import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock, salvarBlobMock, lerBlobMock, apagarBlobMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    multi: vi.fn(() => {
      const ops: Array<() => void> = [];
      return {
        set(key: string, value: unknown) {
          ops.push(() => store.set(key, value));
          return this;
        },
        async exec() {
          ops.forEach((op) => op());
          return ops.map(() => "OK");
        },
      };
    }),
  };
  return {
    store,
    redisMock,
    salvarBlobMock: vi.fn(),
    lerBlobMock: vi.fn(),
    apagarBlobMock: vi.fn(),
  };
});

vi.mock("./redis", () => ({ redis: redisMock }));
vi.mock("./fotoPerfilStorage", () => ({
  ErroFotoPerfilStorage: class ErroFotoPerfilStorage extends Error {},
  salvarFotoBlob: salvarBlobMock,
  lerFotoBlob: lerBlobMock,
  apagarFotoBlob: apagarBlobMock,
}));

import {
  FOTO_PERFIL_MAX_BYTES,
  ErroFotoPerfil,
  missaoFotoPerfilConcluida,
  obterFotoPerfilCliente,
  obterFotoPerfilDataUrl,
  possuiHistoricoPresenteResgatado,
  requisitoFotoPerfilSatisfeito,
  salvarFotoPerfilCliente,
  validarFotoPerfilDataUrl,
} from "./fotoPerfilCliente";

function jpegDataUrl(payloadBytes = 8): string {
  const bytes = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.alloc(payloadBytes, 0x41),
    Buffer.from([0xff, 0xd9]),
  ]);
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  salvarBlobMock.mockResolvedValue({
    url: "https://store.private.blob.vercel-storage.com/perfil-fotos/a.jpg",
    pathname: "perfil-fotos/a.jpg",
    etag: "etag-a",
  });
  lerBlobMock.mockResolvedValue(Buffer.from([0xff, 0xd8, 0x41, 0xff, 0xd9]));
  apagarBlobMock.mockResolvedValue(undefined);
});

describe("fotoPerfilCliente", () => {
  test("aceita somente JPEG pequeno e com assinatura real", () => {
    expect(validarFotoPerfilDataUrl(jpegDataUrl())).toMatch(/^data:image\/jpeg;base64,/);
    expect(() => validarFotoPerfilDataUrl("data:image/png;base64,AAAA")).toThrow(ErroFotoPerfil);
    expect(() => validarFotoPerfilDataUrl("data:image/jpeg;base64,QUJDRA==")).toThrow(/formato_invalido/);
  });

  test("rejeita arquivo acima do teto antes de chamar o storage", () => {
    expect(() => validarFotoPerfilDataUrl(jpegDataUrl(FOTO_PERFIL_MAX_BYTES + 1))).toThrow(/arquivo_grande/);
    expect(salvarBlobMock).not.toHaveBeenCalled();
  });

  test("primeiro upload manda bytes ao Blob, guarda só metadados e conclui a missão", async () => {
    const salvo = await salvarFotoPerfilCliente("cli_5511999990000", jpegDataUrl());
    expect(salvarBlobMock).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer(salvarBlobMock.mock.calls[0][1])).toBe(true);
    expect(salvo.missao.concluida).toBe(true);
    expect(await missaoFotoPerfilConcluida("cli_5511999990000")).toBe(true);
    const meta = await obterFotoPerfilCliente("cli_5511999990000");
    expect(meta?.url).toContain(".private.blob.vercel-storage.com/");
    expect(JSON.stringify([...store.values()])).not.toContain("data:image/jpeg;base64");
  });

  test("leitura da foto busca os bytes no Blob e só então monta data URL", async () => {
    await salvarFotoPerfilCliente("cli_5511999990000", jpegDataUrl());
    const foto = await obterFotoPerfilDataUrl("cli_5511999990000");
    expect(lerBlobMock).toHaveBeenCalledTimes(1);
    expect(foto?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  test("trocar a foto preserva a missão e remove o Blob anterior best-effort", async () => {
    const primeiro = await salvarFotoPerfilCliente("cli_5511999990000", jpegDataUrl(6));
    salvarBlobMock.mockResolvedValueOnce({
      url: "https://store.private.blob.vercel-storage.com/perfil-fotos/b.jpg",
      pathname: "perfil-fotos/b.jpg",
      etag: "etag-b",
    });
    const segundo = await salvarFotoPerfilCliente("cli_5511999990000", jpegDataUrl(12));
    expect(segundo.missao.concluidaEm).toBe(primeiro.missao.concluidaEm);
    expect(apagarBlobMock).toHaveBeenCalledWith(primeiro.foto.url);
  });

  test("cliente com presente resgatado antes da regra não é travado retroativamente", async () => {
    expect(possuiHistoricoPresenteResgatado([{ status: "resgatada" }])).toBe(true);
    const estado = await requisitoFotoPerfilSatisfeito("cli_legado", [{ status: "resgatada" }]);
    expect(estado).toEqual({ satisfeito: true, concluida: false, dispensadaPorHistorico: true });
  });

  test("cliente novo sem foto e sem histórico continua com o requisito pendente", async () => {
    const estado = await requisitoFotoPerfilSatisfeito("cli_novo", [{ status: "disponivel" }]);
    expect(estado).toEqual({ satisfeito: false, concluida: false, dispensadaPorHistorico: false });
  });
});
