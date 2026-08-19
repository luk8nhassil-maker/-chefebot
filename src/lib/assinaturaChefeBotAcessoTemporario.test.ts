import { describe, expect, test } from "vitest";
import {
  ACESSO_TEMPORARIO_CHEFEBOT_MS,
  ACESSO_TEMPORARIO_CHEFEBOT_MINUTOS,
  avaliarAcessoTemporarioChefeBot,
  criarRegistroAcessoTemporarioChefeBot,
} from "./assinaturaChefeBotAcessoTemporario";

describe("acesso temporário da assinatura do ChefeBot", () => {
  test("a janela dura exatamente 60 minutos", () => {
    const agora = new Date("2026-08-19T22:00:00.000Z");
    const registro = criarRegistroAcessoTemporarioChefeBot("2026-08-20", agora);

    expect(ACESSO_TEMPORARIO_CHEFEBOT_MINUTOS).toBe(60);
    expect(Date.parse(registro.expiresAt) - Date.parse(registro.startedAt)).toBe(ACESSO_TEMPORARIO_CHEFEBOT_MS);
    expect(registro.expiresAt).toBe("2026-08-19T23:00:00.000Z");
  });

  test("fica ativo durante a janela e informa o tempo restante", () => {
    const registro = criarRegistroAcessoTemporarioChefeBot(
      "2026-08-20",
      new Date("2026-08-19T22:00:00.000Z"),
    );

    const estado = avaliarAcessoTemporarioChefeBot({
      registro,
      dueDate: "2026-08-20",
      agora: new Date("2026-08-19T22:30:00.000Z"),
    });

    expect(estado.active).toBe(true);
    expect(estado.used).toBe(true);
    expect(estado.remainingMs).toBe(30 * 60 * 1000);
    expect(estado.endsAt).toBe("2026-08-19T23:00:00.000Z");
  });

  test("ao completar 60 minutos fica consumido e não volta a ficar disponível", () => {
    const registro = criarRegistroAcessoTemporarioChefeBot(
      "2026-08-20",
      new Date("2026-08-19T22:00:00.000Z"),
    );

    const estado = avaliarAcessoTemporarioChefeBot({
      registro,
      dueDate: "2026-08-20",
      agora: new Date("2026-08-19T23:00:00.000Z"),
    });

    expect(estado.active).toBe(false);
    expect(estado.used).toBe(true);
    expect(estado.remainingMs).toBe(0);
  });

  test("um novo ciclo de cobrança pode ter sua própria janela", () => {
    const registroAnterior = criarRegistroAcessoTemporarioChefeBot(
      "2026-08-20",
      new Date("2026-08-19T22:00:00.000Z"),
    );

    expect(avaliarAcessoTemporarioChefeBot({
      registro: registroAnterior,
      dueDate: "2026-09-20",
      agora: new Date("2026-09-23T12:00:00.000Z"),
    })).toEqual({ active: false, used: false, endsAt: null, remainingMs: 0 });
  });

  test("registro inválido falha fechado e não permite nova janela no mesmo ciclo", () => {
    expect(avaliarAcessoTemporarioChefeBot({
      registro: {
        dueDate: "2026-08-20",
        startedAt: "2026-08-19T22:00:00.000Z",
        expiresAt: "invalido",
      },
      dueDate: "2026-08-20",
      agora: new Date("2026-08-19T22:10:00.000Z"),
    })).toEqual({ active: false, used: true, endsAt: null, remainingMs: 0 });
  });
});
