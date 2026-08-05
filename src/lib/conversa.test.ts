import { vi, describe, test, expect, beforeEach } from "vitest";

// Regressão: registrarMensagem() aguardar atualizarHistorico() (histórico
// permanente/conversa_full) antes de finalizar, em vez do antigo
// fire-and-forget (`atualizarHistorico(...).catch(() => {})` sem await), que
// podia deixar a gravação pendente quando a função serverless já havia
// encerrado, perdendo a mensagem em silêncio. Também confirma que uma falha
// em atualizarHistorico() nunca propaga erro para quem chamou registrarMensagem()
// e que o log curto `conversa:{phone}` continua sendo salvo normalmente.

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

const { atualizarHistoricoMock } = vi.hoisted(() => ({
  atualizarHistoricoMock: vi.fn(async () => {}),
}));

vi.mock("./conversasHistorico", () => ({
  atualizarHistorico: atualizarHistoricoMock,
}));

const { sincronizarCronometroMock } = vi.hoisted(() => ({
  sincronizarCronometroMock: vi.fn(async () => {}),
}));

vi.mock("./inatividadeConversa", () => ({
  sincronizarCronometroInatividade: sincronizarCronometroMock,
}));

import { registrarMensagem } from "./conversa";

const PHONE = "5586999990001";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  atualizarHistoricoMock.mockImplementation(async () => {});
});

describe("registrarMensagem — aguarda atualizarHistorico (histórico permanente)", () => {
  test("registrarMensagem só resolve depois que atualizarHistorico resolve", async () => {
    let liberouAtualizarHistorico = false;
    let deferredResolve!: () => void;
    const deferred = new Promise<void>(resolve => { deferredResolve = resolve; });
    atualizarHistoricoMock.mockImplementation(async () => {
      await deferred;
      liberouAtualizarHistorico = true;
    });

    const promessa = registrarMensagem(PHONE, "bot", "Olá!");

    // Ainda não liberamos o deferred — registrarMensagem não pode ter resolvido.
    let jaResolveu = false;
    promessa.then(() => { jaResolveu = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(jaResolveu).toBe(false);
    expect(liberouAtualizarHistorico).toBe(false);

    deferredResolve();
    await promessa;

    expect(liberouAtualizarHistorico).toBe(true);
    expect(atualizarHistoricoMock).toHaveBeenCalledTimes(1);
  });

  test("passa phone, autor, texto e um timestamp numérico para atualizarHistorico", async () => {
    await registrarMensagem(PHONE, "bot", "Mensagem do bot");
    expect(atualizarHistoricoMock).toHaveBeenCalledTimes(1);
    const [phoneArg, autorArg, textoArg, tsArg] = atualizarHistoricoMock.mock.calls[0];
    expect(phoneArg).toBe(PHONE);
    expect(autorArg).toBe("bot");
    expect(textoArg).toBe("Mensagem do bot");
    expect(typeof tsArg).toBe("number");
  });
});

describe("registrarMensagem — falha em atualizarHistorico nunca propaga e nunca vaza dado pessoal", () => {
  test("atualizarHistorico rejeitando não lança erro para quem chamou registrarMensagem", async () => {
    atualizarHistoricoMock.mockRejectedValue(new Error("Redis indisponível"));
    await expect(registrarMensagem(PHONE, "cliente", "Quero uma pizza")).resolves.toBeUndefined();
  });

  test("log de erro (se houver) nunca inclui telefone ou texto da mensagem", async () => {
    atualizarHistoricoMock.mockRejectedValue(new Error("Redis indisponível"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await registrarMensagem(PHONE, "cliente", "Endereço: Rua Sigilosa, 123 — Pix R$ 50");
    for (const call of spy.mock.calls) {
      const linha = call.map(String).join(" ");
      expect(linha).not.toContain(PHONE);
      expect(linha).not.toContain("Rua Sigilosa");
      expect(linha).not.toContain("R$ 50");
    }
    spy.mockRestore();
  });

  test("o fluxo continua normalmente (resolve) mesmo com atualizarHistorico rejeitando", async () => {
    atualizarHistoricoMock.mockRejectedValue(new Error("boom"));
    let completou = false;
    await registrarMensagem(PHONE, "bot", "oi").then(() => { completou = true; });
    expect(completou).toBe(true);
  });
});

describe("registrarMensagem — log curto continua sendo salvo", () => {
  test("grava conversa:{phone} normalmente, igual a antes", async () => {
    await registrarMensagem(PHONE, "cliente", "Quero uma pizza");
    expect(redisMock.set).toHaveBeenCalledWith(
      `conversa:${PHONE}`,
      expect.arrayContaining([expect.objectContaining({ autor: "cliente", texto: "Quero uma pizza" })]),
      { ex: 1800 },
    );
  });

  test("log curto é salvo mesmo quando atualizarHistorico falha", async () => {
    atualizarHistoricoMock.mockRejectedValue(new Error("boom"));
    await registrarMensagem(PHONE, "bot", "oi");
    expect(redisMock.set).toHaveBeenCalledWith(`conversa:${PHONE}`, expect.any(Array), { ex: 1800 });
  });
});

describe("registrarMensagem — sincroniza o cronômetro de cancelamento por inatividade", () => {
  test("chama sincronizarCronometroInatividade com phone e autor, para todo autor", async () => {
    await registrarMensagem(PHONE, "bot", "oi");
    expect(sincronizarCronometroMock).toHaveBeenCalledWith(PHONE, "bot");

    await registrarMensagem(PHONE, "cliente", "quero pizza");
    expect(sincronizarCronometroMock).toHaveBeenCalledWith(PHONE, "cliente");

    await registrarMensagem(PHONE, "atendente", "[Kellyne] oi");
    expect(sincronizarCronometroMock).toHaveBeenCalledWith(PHONE, "atendente");
  });

  test("falha na sincronização do cronômetro nunca propaga (registrarMensagem continua best-effort)", async () => {
    sincronizarCronometroMock.mockRejectedValueOnce(new Error("qstash indisponivel"));
    await expect(registrarMensagem(PHONE, "bot", "oi")).resolves.toBeUndefined();
  });
});

describe("registrarMensagem — guards inalterados", () => {
  test("não faz nada quando phone é vazio", async () => {
    await registrarMensagem("", "cliente", "texto");
    expect(atualizarHistoricoMock).not.toHaveBeenCalled();
  });

  test("não faz nada quando texto é vazio", async () => {
    await registrarMensagem(PHONE, "cliente", "");
    expect(atualizarHistoricoMock).not.toHaveBeenCalled();
  });
});
