import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { CF_SESSAO_KEY, VERSAO_PERFIL3, guardarSessaoFallback, sessaoFallbackAtual, limparSessaoFallback, fetchCliente } from "./clienteSessaoFront";

const SESSAO_PORTATIL = "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..kHup-U6l3uDYUfkn.o5A9Iky0cHITZb1g8f-nnrUoS6WPm76D_4HVsmO7Vwinrv9WJ1qgA2BJp5TEvzFK0bIkakOxlAdTGppYAVSsjJ8VDZBL4XK9OEY6FLX-3MUvzdK4JXQYfFVQBWaofA.5EnvHTHCG2PEeo8NwOKnFw";
const SESSAO_OPACA_LEGADA = "a".repeat(32);

// Repo não usa jsdom nos testes (ver page.test.ts) — polyfill mínimo de
// localStorage/sessionStorage só para exercitar guardarSessaoFallback/
// sessaoFallbackAtual/limparSessaoFallback e a migração entre os dois.
class StorageFake {
  private mapa = new Map<string, string>();
  getItem(k: string) { return this.mapa.has(k) ? this.mapa.get(k)! : null; }
  setItem(k: string, v: string) { this.mapa.set(k, v); }
  removeItem(k: string) { this.mapa.delete(k); }
  clear() { this.mapa.clear(); }
}
(globalThis as unknown as { localStorage: StorageFake }).localStorage = new StorageFake();
(globalThis as unknown as { sessionStorage: StorageFake }).sessionStorage = new StorageFake();

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("clienteSessaoFront — sessão portátil (JWE) com compatibilidade com a opaca legada", () => {
  test("marcador de versão do bundle avançou para p3d6", () => {
    expect(VERSAO_PERFIL3).toBe("p3d6");
  });

  test("aceita e devolve uma sessão portátil (JWE, 5 partes) do localStorage — sobrevive fechar a aba", () => {
    expect(guardarSessaoFallback(SESSAO_PORTATIL)).toBe(true);
    expect(localStorage.getItem(CF_SESSAO_KEY)).toBe(SESSAO_PORTATIL);
    expect(sessaoFallbackAtual()).toBe(SESSAO_PORTATIL);
  });

  test("continua aceitando o formato opaco legado (compatibilidade)", () => {
    expect(guardarSessaoFallback(SESSAO_OPACA_LEGADA)).toBe(true);
    expect(sessaoFallbackAtual()).toBe(SESSAO_OPACA_LEGADA);
  });

  test("rejeita valores fora dos dois formatos conhecidos", () => {
    expect(guardarSessaoFallback("qualquer-coisa")).toBe(false);
    expect(guardarSessaoFallback("11999998888")).toBe(false);
  });

  test("limparSessaoFallback remove a sessão guardada", () => {
    guardarSessaoFallback(SESSAO_PORTATIL);
    limparSessaoFallback();
    expect(sessaoFallbackAtual()).toBeNull();
  });

  test("limparSessaoFallback remove de localStorage E sessionStorage (nunca deixa resquício da era anterior)", () => {
    localStorage.setItem(CF_SESSAO_KEY, SESSAO_PORTATIL);
    sessionStorage.setItem(CF_SESSAO_KEY, SESSAO_PORTATIL);
    limparSessaoFallback();
    expect(localStorage.getItem(CF_SESSAO_KEY)).toBeNull();
    expect(sessionStorage.getItem(CF_SESSAO_KEY)).toBeNull();
  });
});

describe("clienteSessaoFront — migração de sessão gravada em sessionStorage antes desta mudança", () => {
  test("sessão só em sessionStorage (aba antiga) é movida para localStorage e devolvida normalmente", () => {
    sessionStorage.setItem(CF_SESSAO_KEY, SESSAO_PORTATIL);
    expect(sessaoFallbackAtual()).toBe(SESSAO_PORTATIL);
    expect(localStorage.getItem(CF_SESSAO_KEY)).toBe(SESSAO_PORTATIL);
    expect(sessionStorage.getItem(CF_SESSAO_KEY)).toBeNull();
  });

  test("se já existe sessão em localStorage, ignora qualquer coisa em sessionStorage (localStorage nunca é sobrescrito por um valor mais antigo)", () => {
    localStorage.setItem(CF_SESSAO_KEY, SESSAO_PORTATIL);
    sessionStorage.setItem(CF_SESSAO_KEY, SESSAO_OPACA_LEGADA);
    expect(sessaoFallbackAtual()).toBe(SESSAO_PORTATIL);
  });

  test("sem sessão em nenhum dos dois storages, continua retornando null (sem erro)", () => {
    expect(sessaoFallbackAtual()).toBeNull();
  });
});

describe("fetchCliente — prioridade do token", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("token em memória (portátil) tem prioridade sobre o storage e vai no header Authorization", async () => {
    guardarSessaoFallback(SESSAO_OPACA_LEGADA);
    await fetchCliente("/api/cliente/perfil", undefined, SESSAO_PORTATIL);
    const [, init] = fetchSpy.mock.calls[0];
    const headers = new Headers((init as RequestInit)?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${SESSAO_PORTATIL}`);
  });

  test("sem token em memória nem no storage, faz um fetch normal (cookie do navegador)", async () => {
    await fetchCliente("/api/cliente/perfil");
    const [, init] = fetchSpy.mock.calls[0];
    expect(init).toBeUndefined();
  });
});
