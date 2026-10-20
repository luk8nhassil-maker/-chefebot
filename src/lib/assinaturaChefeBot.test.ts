import { describe, expect, it } from "vitest";
import {
  PLANOS_ASSINATURA_CHEFEBOT,
  avaliarAssinaturaChefeBot,
  calcularMudancaPlanoChefeBot,
  estadoInicialAssinaturaChefeBot,
  proximoVencimento,
  type EstadoAssinaturaChefeBot,
} from "./assinaturaChefeBot";

describe("assinatura ChefeBot — regras comerciais", () => {
  it("mantém os mesmos três planos e créditos do piloto aprovado", () => {
    expect(PLANOS_ASSINATURA_CHEFEBOT.basic).toMatchObject({ valorCentavos: 24999, creditosEvolucaoMensais: 0 });
    expect(PLANOS_ASSINATURA_CHEFEBOT.plus).toMatchObject({ valorCentavos: 38747, creditosEvolucaoMensais: 5 });
    expect(PLANOS_ASSINATURA_CHEFEBOT.pro).toMatchObject({ valorCentavos: 51399, creditosEvolucaoMensais: 10 });
  });

  it("cobra o primeiro ciclo imediatamente em 19/08/2026, sem esperar carência", () => {
    const estado = estadoInicialAssinaturaChefeBot();
    expect(avaliarAssinaturaChefeBot(estado, "2026-08-18").blocked).toBe(false);
    expect(avaliarAssinaturaChefeBot(estado, "2026-08-19")).toMatchObject({ status: "blocked", blocked: true });
  });

  it("avisa três dias antes e bloqueia no próprio vencimento sem carência", () => {
    const estado: EstadoAssinaturaChefeBot = {
      activePlanId: "basic",
      nextDueDate: "2026-10-20",
      paidThroughDate: null,
      pendingDowngradePlanId: null,
    };

    expect(avaliarAssinaturaChefeBot(estado, "2026-10-16")).toMatchObject({ status: "regular", blocked: false });
    expect(avaliarAssinaturaChefeBot(estado, "2026-10-17")).toMatchObject({ status: "warning", blocked: false });
    expect(avaliarAssinaturaChefeBot(estado, "2026-10-19")).toMatchObject({ status: "warning", blocked: false });
    expect(avaliarAssinaturaChefeBot(estado, "2026-10-20")).toMatchObject({ status: "blocked", blocked: true, daysLate: 0 });
    expect(avaliarAssinaturaChefeBot(estado, "2026-10-21")).toMatchObject({ status: "blocked", blocked: true, daysLate: 1 });
    expect(avaliarAssinaturaChefeBot(estado, "2026-10-22")).toMatchObject({ status: "blocked", blocked: true, daysLate: 2 });
    expect(avaliarAssinaturaChefeBot(estado, "2026-10-23")).toMatchObject({ status: "blocked", blocked: true, daysLate: 3 });
  });

  it("libera após confirmação real que avança o próximo vencimento no estado", () => {
    const quitada: EstadoAssinaturaChefeBot = {
      activePlanId: "basic",
      nextDueDate: "2026-11-20",
      paidThroughDate: "2026-11-20",
      pendingDowngradePlanId: null,
    };
    expect(avaliarAssinaturaChefeBot(quitada, "2026-10-20")).toMatchObject({ status: "regular", blocked: false });
    expect(avaliarAssinaturaChefeBot(quitada, "2026-11-17")).toMatchObject({ status: "warning", blocked: false });
    expect(avaliarAssinaturaChefeBot(quitada, "2026-11-20")).toMatchObject({ status: "blocked", blocked: true });
  });

  it("avança o vencimento mensal sempre para o dia 20", () => {
    expect(proximoVencimento("2026-08-20")).toBe("2026-09-20");
    expect(proximoVencimento("2026-12-20")).toBe("2027-01-20");
  });

  it("upgrade cobra somente diferença proporcional aos dias restantes", () => {
    const change = calcularMudancaPlanoChefeBot({
      currentPlanId: "basic",
      targetPlanId: "plus",
      nextDueDate: "2026-09-20",
      today: "2026-09-01",
    });
    expect(change).toEqual({
      kind: "upgrade",
      amountCentavos: 8426,
      differenceCentavos: 13748,
      remainingDays: 19,
      cycleDays: 31,
    });
  });

  it("downgrade não reembolsa e entra no próximo vencimento", () => {
    expect(calcularMudancaPlanoChefeBot({
      currentPlanId: "pro",
      targetPlanId: "basic",
      nextDueDate: "2026-09-20",
      today: "2026-09-01",
    })).toEqual({ kind: "downgrade", amountCentavos: 0, effectiveOn: "2026-09-20" });
  });
});
