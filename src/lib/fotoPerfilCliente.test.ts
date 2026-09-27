import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
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
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import {
  FOTO_PERFIL_MAX_BYTES,
  ErroFotoPerfil,
  missaoFotoPerfilConcluida,
  obterFotoPerfilCliente,
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
});

describe("fotoPerfilCliente", () => {
  test("aceita somente JPEG pequeno e com assinatura real", () => {
    expect(validarFotoPerfilDataUrl(jpegDataUrl())).toMatch(/^data:image\/jpeg;base64,/);
    expect(() => validarFotoPerfilDataUrl("data:image/png;base64,AAAA")).toThrow(ErroFotoPerfil);
    expect(() => validarFotoPerfilDataUrl("data:image/jpeg;base64,QUJDRA==")).toThrow(/formato_invalido/);
  });

  test("rejeita arquivo acima do teto antes de persistir", () => {
    expect(() => validarFotoPerfilDataUrl(jpegDataUrl(FOTO_PERFIL_MAX_BYTES + 1))).toThrow(/arquivo_grande/);
    expect(redisMock.multi).not.toHaveBeenCalled();
  });

  test("primeiro upload salva foto e conclui a missão permanentemente", async () => {
    const salvo = await salvarFotoPerfilCliente("cli_5511999990000", jpegDataUrl());
    expect(salvo.missao.concluida).toBe(true);
    expect(await missaoFotoPerfilConcluida("cli_5511999990000")).toBe(true);
    expect((await obterFotoPerfilCliente("cli_5511999990000"))?.dataUrl).toBe(salvo.foto.dataUrl);
  });

  test("trocar a foto não recria nem reinicia a conclusão da missão", async () => {
    const primeiro = await salvarFotoPerfilCliente("cli_5511999990000", jpegDataUrl(6));
    const segundo = await salvarFotoPerfilCliente("cli_5511999990000", jpegDataUrl(12));
    expect(segundo.missao.concluidaEm).toBe(primeiro.missao.concluidaEm);
    expect(await missaoFotoPerfilConcluida("cli_5511999990000")).toBe(true);
  });

  test("cliente diferente nunca herda a missão nem a foto", async () => {
    await salvarFotoPerfilCliente("cli_a", jpegDataUrl());
    expect(await missaoFotoPerfilConcluida("cli_b")).toBe(false);
    expect(await obterFotoPerfilCliente("cli_b")).toBeNull();
  });
});
