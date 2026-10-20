import { describe, expect, test } from "vitest";
import { avaliarSaudeInbox, type InboxQueueHealth } from "./whatsappInboxReadiness";

const NOW = Date.parse("2026-10-19T22:00:00.000Z");
const normal: InboxQueueHealth = {
  pending: 0, inFlight: 0, queuedTotal: 2, doneTotal: 2,
  ambiguousTotal: 0, unresolved: 0, lastWorkerAt: NOW - 60_000,
};

describe("monitor técnico da inbox sem alegar capacidade falsa", () => {
  test("fila processada e agenda ativa comprovam somente processamento local", () => {
    const result = avaliarSaudeInbox(normal, "ok", true, NOW);
    expect(result.status).toBe("saudavel");
    expect(result.processamentoLocalConfirmado).toBe(true);
    expect(result.recuperacaoConfigurada).toBe(true);
    expect(result.capacidadeGeralComprovada).toBe(false);
    expect(result.liberacaoGeralAutorizada).toBe(false);
  });
  test("zero mensagens não vira sinal de saúde nem autorização geral", () => {
    const result = avaliarSaudeInbox({ ...normal, queuedTotal: 0, doneTotal: 0 }, "ok", true, NOW);
    expect(result.status).toBe("observando");
    expect(result.processamentoLocalConfirmado).toBe(false);
  });
  test("job ambíguo impede sucesso e exige reconciliação", () => {
    const result = avaliarSaudeInbox({ ...normal, ambiguousTotal: 1, pending: 1 }, "ok", true, NOW);
    expect(result.status).toBe("problema");
    expect(result.motivos.join(" ")).toContain("reconciliação individual");
  });
  test("agenda ausente ou incorreta é bloqueio", () => {
    expect(avaliarSaudeInbox(normal, "ausente", true, NOW).status).toBe("problema");
    expect(avaliarSaudeInbox(normal, "incorreta", true, NOW).status).toBe("problema");
  });
  test("QStash inacessível não é sucesso", () => {
    const result = avaliarSaudeInbox(normal, "indisponivel", true, NOW);
    expect(result.status).toBe("observando");
    expect(result.recuperacaoConfigurada).toBe(false);
  });
  test("worker antigo não prova recuperação atual", () => {
    const result = avaliarSaudeInbox({ ...normal, lastWorkerAt: NOW - 16 * 60_000 }, "ok", true, NOW);
    expect(result.status).toBe("observando");
    expect(result.recuperacaoConfigurada).toBe(false);
  });
  test("rollout desligado não é operação saudável", () => {
    expect(avaliarSaudeInbox(normal, "ok", false, NOW).status).toBe("problema");
  });
});
