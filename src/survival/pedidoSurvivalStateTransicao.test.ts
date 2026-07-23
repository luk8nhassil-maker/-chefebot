import { describe, expect, test } from "vitest";
import { validarTransicaoSurvivalState } from "./pedidoSurvivalStateTransicao";

describe("validarTransicaoSurvivalState", () => {
  test("pedido novo (sem estado) pode ir para qualquer estado válido", () => {
    expect(validarTransicaoSurvivalState(undefined, "pending_critical_confirmation")).toEqual({ permitida: true });
    expect(validarTransicaoSurvivalState(undefined, "completed")).toEqual({ permitida: true });
    expect(validarTransicaoSurvivalState(undefined, "recovery_required")).toEqual({ permitida: true });
  });

  test("pending_critical_confirmation -> completed: permitida", () => {
    expect(validarTransicaoSurvivalState("pending_critical_confirmation", "completed")).toEqual({ permitida: true });
  });

  test("pending_critical_confirmation -> recovery_required: permitida", () => {
    expect(validarTransicaoSurvivalState("pending_critical_confirmation", "recovery_required")).toEqual({ permitida: true });
  });

  test("completed nunca volta para pending_critical_confirmation", () => {
    expect(validarTransicaoSurvivalState("completed", "pending_critical_confirmation")).toEqual({
      permitida: false,
      motivo: "transicao_nao_permitida",
    });
  });

  test("completed nunca vira recovery_required", () => {
    expect(validarTransicaoSurvivalState("completed", "recovery_required")).toEqual({
      permitida: false,
      motivo: "transicao_nao_permitida",
    });
  });

  test("recovery_required nunca vira completed sem recuperação comprovada (fora deste fluxo)", () => {
    expect(validarTransicaoSurvivalState("recovery_required", "completed")).toEqual({
      permitida: false,
      motivo: "transicao_nao_permitida",
    });
  });

  test("recovery_required nunca volta para pending_critical_confirmation", () => {
    expect(validarTransicaoSurvivalState("recovery_required", "pending_critical_confirmation")).toEqual({
      permitida: false,
      motivo: "transicao_nao_permitida",
    });
  });

  test("estado desconhecido/corrompido nunca é sobrescrito silenciosamente", () => {
    expect(validarTransicaoSurvivalState("estado_invalido_corrompido", "completed")).toEqual({
      permitida: false,
      motivo: "estado_atual_invalido",
    });
  });

  test("novo estado desconhecido/corrompido nunca é aceito, mesmo vindo de um estado válido", () => {
    expect(validarTransicaoSurvivalState("pending_critical_confirmation", "estado_bugado")).toEqual({
      permitida: false,
      motivo: "transicao_nao_permitida",
    });
  });

  test("repetir o mesmo estado (retry idempotente) não é tratado como transição nova", () => {
    expect(validarTransicaoSurvivalState("pending_critical_confirmation", "pending_critical_confirmation")).toEqual({
      permitida: false,
      motivo: "estado_inalterado",
    });
    expect(validarTransicaoSurvivalState("completed", "completed")).toEqual({
      permitida: false,
      motivo: "estado_inalterado",
    });
  });
});
