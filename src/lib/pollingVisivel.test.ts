import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { iniciarPollingVisivel } from "./pollingVisivel";

class DocumentoFake {
  hidden = false;
  private listeners = new Set<() => void>();
  addEventListener(_type: "visibilitychange", listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_type: "visibilitychange", listener: () => void) { this.listeners.delete(listener); }
  mudar(hidden: boolean) {
    this.hidden = hidden;
    for (const listener of this.listeners) listener();
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("iniciarPollingVisivel", () => {
  test("mantém a cadência nominal medida pelo início quando a chamada é rápida", async () => {
    const doc = new DocumentoFake();
    const executar = vi.fn(async () => {});
    const parar = iniciarPollingVisivel({
      executar,
      intervaloMs: 3000,
      pausarOculto: true,
      ambiente: { documento: doc },
    });

    await vi.runAllTicks();
    expect(executar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(executar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(executar).toHaveBeenCalledTimes(2);
    parar();
  });

  test("nunca sobrepõe requisições lentas e roda de novo assim que a anterior libera", async () => {
    const doc = new DocumentoFake();
    let resolver!: () => void;
    const pendente = new Promise<void>(resolve => { resolver = resolve; });
    const executar = vi.fn().mockImplementationOnce(() => pendente).mockResolvedValue(undefined);
    const parar = iniciarPollingVisivel({ executar, intervaloMs: 3000, pausarOculto: false, ambiente: { documento: doc } });

    await vi.runAllTicks();
    expect(executar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9000);
    expect(executar).toHaveBeenCalledTimes(1);
    resolver();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(executar).toHaveBeenCalledTimes(2);
    parar();
  });

  test("aba oculta zera tráfego secundário e voltar ao foreground atualiza imediatamente", async () => {
    const doc = new DocumentoFake();
    const executar = vi.fn(async () => {});
    const parar = iniciarPollingVisivel({ executar, intervaloMs: 3000, pausarOculto: true, ambiente: { documento: doc } });

    await vi.runAllTicks();
    expect(executar).toHaveBeenCalledTimes(1);
    doc.mudar(true);
    await vi.advanceTimersByTimeAsync(30000);
    expect(executar).toHaveBeenCalledTimes(1);
    doc.mudar(false);
    await vi.runAllTicks();
    expect(executar).toHaveBeenCalledTimes(2);
    parar();
  });

  test("polling crítico pode continuar em segundo plano quando pausarOculto=false", async () => {
    const doc = new DocumentoFake();
    doc.hidden = true;
    const executar = vi.fn(async () => {});
    const parar = iniciarPollingVisivel({ executar, intervaloMs: 3000, pausarOculto: false, ambiente: { documento: doc } });

    await vi.runAllTicks();
    expect(executar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(executar).toHaveBeenCalledTimes(2);
    parar();
  });

  test("cleanup cancela timer e listener", async () => {
    const doc = new DocumentoFake();
    const executar = vi.fn(async () => {});
    const parar = iniciarPollingVisivel({ executar, intervaloMs: 3000, pausarOculto: true, ambiente: { documento: doc } });
    await vi.runAllTicks();
    parar();
    doc.mudar(true);
    doc.mudar(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(executar).toHaveBeenCalledTimes(1);
  });
});
