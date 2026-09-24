import { describe, expect, test } from "vitest";
import {
  INSTRUMENTOS_PESQUISA,
  obterInstrumentoPesquisa,
  possuiCampoPessoalProibido,
  type ResearchExposure,
  type ResearchResponse,
} from "./pesquisaPreferenciaRegistro";

describe("INSTRUMENTOS_PESQUISA", () => {
  test("mantém questionId único, versão explícita e envio desligado", () => {
    const ids = INSTRUMENTOS_PESQUISA.map((instrumento) => instrumento.questionId);

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(INSTRUMENTOS_PESQUISA.every((instrumento) => instrumento.version === 1)).toBe(true);
    expect(INSTRUMENTOS_PESQUISA.every((instrumento) => instrumento.habilitadaParaEnvio === false)).toBe(true);
  });

  test("M1, M2 e M5 possuem instrumento versionado mas continuam sem envio", () => {
    for (const momentId of ["M1", "M2", "M5"] as const) {
      const instrumento = obterInstrumentoPesquisa(momentId);
      expect(instrumento).not.toBeNull();
      expect(instrumento?.questionId).toBe(`research-${momentId.toLowerCase()}-main`);
      expect(instrumento?.version).toBe(1);
      expect(instrumento?.habilitadaParaEnvio).toBe(false);
    }
  });

  test("M0 e M14 não fabricam pergunta automática", () => {
    expect(obterInstrumentoPesquisa("M0")).toBeNull();
    expect(obterInstrumentoPesquisa("M14")).toBeNull();
  });
});

describe("contrato de registro de pesquisa", () => {
  test("exposição usa customerKey pseudonimizada e não precisa de telefone/nome/endereço", () => {
    const exposure: ResearchExposure = {
      exposureId: "exp_1",
      customerKey: "anon_abc",
      momentId: "M2",
      behaviorState: "S2",
      triggerEventId: "event_1",
      questionId: "research-m2-main",
      questionVersion: 1,
      variantId: "default",
      channel: "app",
      sentAtMs: 1,
      answeredAtMs: null,
      skippedAtMs: null,
      suppressionReason: null,
      experimentBucket: null,
    };

    expect(possuiCampoPessoalProibido(exposure)).toBe(false);
  });

  test("resposta preserva rawAnswer separado de temas codificados", () => {
    const response: ResearchResponse = {
      responseId: "resp_1",
      exposureId: "exp_1",
      rawAnswer: "Foi a pizza que eu já conhecia.",
      codedThemes: ["familiaridade"],
      otherFlag: false,
      researcherNote: null,
      confidenceTag: null,
      followUpEligible: false,
      createdAtMs: 2,
    };

    expect(response.rawAnswer).toBe("Foi a pizza que eu já conhecia.");
    expect(response.codedThemes).toEqual(["familiaridade"]);
    expect(possuiCampoPessoalProibido(response)).toBe(false);
  });

  test("detecta campo pessoal proibido antes de futura persistência", () => {
    expect(possuiCampoPessoalProibido({ telefone: "5599999999999" })).toBe(true);
    expect(possuiCampoPessoalProibido({ nested: { endereco: "Rua X" } })).toBe(true);
  });
});
