import { describe, expect, it, vi } from "vitest";
import {
  deveLimparReferenciaPixPendente,
  lerReferenciaPixPendente,
  lerReferenciaPixPendenteDoStorage,
  limparReferenciaPixPendente,
  maisRecente,
  resolverPixPendenteAPartirDaResposta,
  salvarReferenciaPixPendente,
  type StorageLike,
} from "./pixPendenteLocal";

function memStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe("lerReferenciaPixPendente", () => {
  it("aceita registro válido mínimo", () => {
    const ref = lerReferenciaPixPendente(JSON.stringify({ pedidoId: "p1", statusToken: "tok", createdAt: 100 }));
    expect(ref).toEqual({ pedidoId: "p1", statusToken: "tok", createdAt: 100 });
  });

  it("aceita registro com numero", () => {
    const ref = lerReferenciaPixPendente(JSON.stringify({ pedidoId: "p1", statusToken: "tok", numero: 4821, createdAt: 100 }));
    expect(ref).toMatchObject({ numero: 4821 });
  });

  it("rejeita null/vazio", () => {
    expect(lerReferenciaPixPendente(null)).toBeNull();
    expect(lerReferenciaPixPendente("")).toBeNull();
  });

  it("rejeita JSON inválido sem lançar", () => {
    expect(lerReferenciaPixPendente("{not json")).toBeNull();
  });

  it("rejeita quando falta pedidoId", () => {
    expect(lerReferenciaPixPendente(JSON.stringify({ statusToken: "tok", createdAt: 1 }))).toBeNull();
  });

  it("rejeita quando falta statusToken", () => {
    expect(lerReferenciaPixPendente(JSON.stringify({ pedidoId: "p1", createdAt: 1 }))).toBeNull();
  });

  it("nunca aceita campos de payload sensível (QR/copia-e-cola/chave) mesmo se presentes no JSON", () => {
    const ref = lerReferenciaPixPendente(JSON.stringify({
      pedidoId: "p1", statusToken: "tok", createdAt: 1,
      qrCode: "000201...", copiaECola: "000201...", chavePix: "11999999999",
    }));
    expect(ref).toEqual({ pedidoId: "p1", statusToken: "tok", createdAt: 1 });
    expect(ref).not.toHaveProperty("qrCode");
    expect(ref).not.toHaveProperty("copiaECola");
    expect(ref).not.toHaveProperty("chavePix");
  });
});

describe("salvar/ler/limpar no storage", () => {
  it("salva e lê de volta", () => {
    const storage = memStorage();
    salvarReferenciaPixPendente(storage, { pedidoId: "p1", statusToken: "tok", numero: 4821 });
    const ref = lerReferenciaPixPendenteDoStorage(storage);
    expect(ref).toMatchObject({ pedidoId: "p1", statusToken: "tok", numero: 4821 });
    expect(typeof ref?.createdAt).toBe("number");
  });

  it("só grava os 4 campos mínimos — nunca QR/copia-e-cola/chave/payload completo", () => {
    const storage = memStorage();
    salvarReferenciaPixPendente(storage, { pedidoId: "p1", statusToken: "tok", numero: 4821 });
    const raw = storage.getItem("cf_pix_pendente")!;
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual(["createdAt", "numero", "pedidoId", "statusToken"]);
  });

  it("limpar remove a referência", () => {
    const storage = memStorage();
    salvarReferenciaPixPendente(storage, { pedidoId: "p1", statusToken: "tok" });
    limparReferenciaPixPendente(storage);
    expect(lerReferenciaPixPendenteDoStorage(storage)).toBeNull();
  });

  it("referência inválida gravada manualmente é tratada como ausente (não quebra)", () => {
    const storage = memStorage();
    storage.setItem("cf_pix_pendente", "não é json");
    expect(lerReferenciaPixPendenteDoStorage(storage)).toBeNull();
  });

  it("storage indisponível (lança) não quebra salvar/limpar", () => {
    const storage: StorageLike = {
      getItem: () => { throw new Error("quota"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("quota"); },
    };
    expect(() => salvarReferenciaPixPendente(storage, { pedidoId: "p1", statusToken: "tok" })).not.toThrow();
    expect(() => limparReferenciaPixPendente(storage)).not.toThrow();
    expect(lerReferenciaPixPendenteDoStorage(storage)).toBeNull();
  });
});

describe("deveLimparReferenciaPixPendente", () => {
  it("limpa quando confirmado", () => {
    expect(deveLimparReferenciaPixPendente("confirmado")).toBe(true);
  });

  it("limpa quando indisponível (cancelado/expirado/sem QR)", () => {
    expect(deveLimparReferenciaPixPendente("indisponivel")).toBe(true);
  });

  it("NÃO limpa quando aguardando (ainda pendente)", () => {
    expect(deveLimparReferenciaPixPendente("aguardando")).toBe(false);
  });

  it("NÃO limpa quando em análise (comprovante em avaliação)", () => {
    expect(deveLimparReferenciaPixPendente("em_analise")).toBe(false);
  });

  it("NÃO limpa em estado desconhecido/ausente (falha segura)", () => {
    expect(deveLimparReferenciaPixPendente(undefined)).toBe(false);
  });
});

describe("resolverPixPendenteAPartirDaResposta — regra central do hook usePixPendente", () => {
  const ref = { pedidoId: "p1", statusToken: "tok-123", numero: 4821 };

  it("[caso 5] só mostra a barra quando o backend confirma estado 'aguardando'", () => {
    const { pendente, deveLimpar } = resolverPixPendenteAPartirDaResposta(ref, { estado: "aguardando", total: 89.9 });
    expect(pendente).toEqual({ pedidoId: "p1", statusToken: "tok-123", numero: 4821, total: 89.9 });
    expect(deveLimpar).toBe(false);
  });

  it("referência local sozinha nunca é suficiente — sem resposta do backend, sem barra", () => {
    const { pendente } = resolverPixPendenteAPartirDaResposta(ref, null);
    expect(pendente).toBeNull();
  });

  it("[caso 6] barra desaparece quando o backend confirma o pagamento", () => {
    const { pendente, deveLimpar } = resolverPixPendenteAPartirDaResposta(ref, { estado: "confirmado", total: 89.9 });
    expect(pendente).toBeNull();
    expect(deveLimpar).toBe(true);
  });

  it("barra desaparece quando o pedido fica indisponível (cancelado/expirado)", () => {
    const { pendente, deveLimpar } = resolverPixPendenteAPartirDaResposta(ref, { estado: "indisponivel" });
    expect(pendente).toBeNull();
    expect(deveLimpar).toBe(true);
  });

  it("[caso 7] resposta nula (token inválido/404) limpa a referência local", () => {
    const { deveLimpar } = resolverPixPendenteAPartirDaResposta(ref, null);
    expect(deveLimpar).toBe(true);
  });

  it("em_analise não mostra a barra mas também não limpa a referência (comprovante ainda em avaliação)", () => {
    const { pendente, deveLimpar } = resolverPixPendenteAPartirDaResposta(ref, { estado: "em_analise" });
    expect(pendente).toBeNull();
    expect(deveLimpar).toBe(false);
  });

  it("estado 'aguardando' sem total numérico não mostra a barra (resposta incompleta)", () => {
    const { pendente } = resolverPixPendenteAPartirDaResposta(ref, { estado: "aguardando" });
    expect(pendente).toBeNull();
  });

  it("usa numero da resposta do backend quando presente, preservando fallback do ref", () => {
    const { pendente } = resolverPixPendenteAPartirDaResposta(ref, { estado: "aguardando", total: 10, numero: 9999 });
    expect(pendente?.numero).toBe(9999);
  });
});

describe("maisRecente", () => {
  it("retorna a referência com createdAt mais alto", () => {
    const a = { pedidoId: "a", statusToken: "t", createdAt: 100 };
    const b = { pedidoId: "b", statusToken: "t", createdAt: 200 };
    expect(maisRecente([a, b])).toEqual(b);
  });

  it("retorna null para lista vazia", () => {
    expect(maisRecente([])).toBeNull();
  });
});
