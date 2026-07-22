import { describe, expect, it, vi } from "vitest";
import {
  SURVIVAL_DRAFT_KEY,
  SURVIVAL_DRAFT_TTL_MS,
  lerRascunhoSobrevivencia,
  limparRascunhoSobrevivencia,
  salvarRascunhoSobrevivencia,
  type StorageLike,
} from "./draftStorage";

function memoryStorage(): StorageLike & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key: string) => raw.get(key) ?? null,
    setItem: (key: string, value: string) => {
      raw.set(key, value);
    },
    removeItem: (key: string) => {
      raw.delete(key);
    },
  };
}

const payloadValido = {
  cart: [{ name: "Calabresa", qty: 1 }],
  tipoEntrega: "delivery",
  bairro: "Centro",
  pagamento: "Pix",
  clientRequestId: "abc12345",
};

describe("salvarRascunhoSobrevivencia / lerRascunhoSobrevivencia", () => {
  it("salva e lê de volta o mesmo payload", () => {
    const storage = memoryStorage();
    salvarRascunhoSobrevivencia(storage, payloadValido);
    expect(lerRascunhoSobrevivencia(storage)).toEqual(payloadValido);
  });

  it("carrinho vazio limpa o rascunho em vez de gravar um envelope inútil", () => {
    const storage = memoryStorage();
    salvarRascunhoSobrevivencia(storage, payloadValido);
    salvarRascunhoSobrevivencia(storage, { ...payloadValido, cart: [] });
    expect(storage.raw.has(SURVIVAL_DRAFT_KEY)).toBe(false);
    expect(lerRascunhoSobrevivencia(storage)).toBeNull();
  });

  it("nunca guarda token/cookie/QR/segredo — o tipo do payload não tem esses campos", () => {
    const storage = memoryStorage();
    salvarRascunhoSobrevivencia(storage, payloadValido);
    const gravado = storage.raw.get(SURVIVAL_DRAFT_KEY)!;
    expect(gravado).not.toMatch(/token|cookie|qrCode|chavePix|senha|secret/i);
  });

  it("rascunho expirado (> TTL) é descartado e a chave é limpa", () => {
    const storage = memoryStorage();
    const agora = Date.now();
    const vi_now = vi.spyOn(Date, "now").mockReturnValue(agora);
    salvarRascunhoSobrevivencia(storage, payloadValido);
    vi_now.mockReturnValue(agora + SURVIVAL_DRAFT_TTL_MS + 1);
    expect(lerRascunhoSobrevivencia(storage)).toBeNull();
    expect(storage.raw.has(SURVIVAL_DRAFT_KEY)).toBe(false);
    vi_now.mockRestore();
  });

  it("rascunho dentro do TTL ainda é válido", () => {
    const storage = memoryStorage();
    const agora = Date.now();
    const vi_now = vi.spyOn(Date, "now").mockReturnValue(agora);
    salvarRascunhoSobrevivencia(storage, payloadValido);
    vi_now.mockReturnValue(agora + SURVIVAL_DRAFT_TTL_MS - 1000);
    expect(lerRascunhoSobrevivencia(storage)).toEqual(payloadValido);
    vi_now.mockRestore();
  });

  it("schema com versão diferente é descartado (nunca quebra a leitura)", () => {
    const storage = memoryStorage();
    storage.setItem(SURVIVAL_DRAFT_KEY, JSON.stringify({ v: 999, savedAt: Date.now(), payload: payloadValido }));
    expect(lerRascunhoSobrevivencia(storage)).toBeNull();
  });

  it("JSON corrompido nunca lança, só retorna null e limpa a chave", () => {
    const storage = memoryStorage();
    storage.setItem(SURVIVAL_DRAFT_KEY, "{ isso não é json válido");
    expect(() => lerRascunhoSobrevivencia(storage)).not.toThrow();
    expect(lerRascunhoSobrevivencia(storage)).toBeNull();
  });

  it("storage indisponível (lança em getItem/setItem) nunca propaga exceção", () => {
    const storageQuebrado: StorageLike = {
      getItem: () => {
        throw new Error("modo privado");
      },
      setItem: () => {
        throw new Error("quota excedida");
      },
      removeItem: () => {
        throw new Error("indisponível");
      },
    };
    expect(() => salvarRascunhoSobrevivencia(storageQuebrado, payloadValido)).not.toThrow();
    expect(() => lerRascunhoSobrevivencia(storageQuebrado)).not.toThrow();
    expect(lerRascunhoSobrevivencia(storageQuebrado)).toBeNull();
  });

  it("limparRascunhoSobrevivencia remove a chave", () => {
    const storage = memoryStorage();
    salvarRascunhoSobrevivencia(storage, payloadValido);
    limparRascunhoSobrevivencia(storage);
    expect(lerRascunhoSobrevivencia(storage)).toBeNull();
  });
});
