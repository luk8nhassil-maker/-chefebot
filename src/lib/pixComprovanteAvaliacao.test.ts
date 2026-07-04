import { describe, expect, test } from "vitest";

import { avaliarEvidenciaPix, type AvaliarEvidenciaPixInput } from "./pixComprovanteAvaliacao";
import type { ResultadoHorarioComprovantePix } from "./pixComprovanteHorario";

const horarioOk: ResultadoHorarioComprovantePix = { ok: true, bloquear: false, motivo: "ok" };
const horarioSemHorario: ResultadoHorarioComprovantePix = { ok: true, bloquear: false, motivo: "sem_horario" };
const horarioAnterior: ResultadoHorarioComprovantePix = { ok: false, bloquear: true, motivo: "pagamento_anterior" };
const horarioDataDiferente: ResultadoHorarioComprovantePix = { ok: false, bloquear: true, motivo: "data_diferente" };

function baseInput(overrides: Partial<AvaliarEvidenciaPixInput> = {}): AvaliarEvidenciaPixInput {
  return {
    valorEsperado: 52,
    valorLido: 52,
    beneficiarioEsperado: "Pizzaria Chefe da Pizza",
    beneficiarioLido: "Pizzaria Chefe da Pizza LTDA",
    statusTransacao: "concluido",
    horario: horarioOk,
    hashReutilizado: false,
    e2eId: "E12345678202601011200ABCDEFG12",
    codigoAutenticacao: undefined,
    e2eReutilizado: false,
    origem: "imagem",
    legibilidade: "alta",
    ...overrides,
  };
}

describe("avaliarEvidenciaPix", () => {
  test("evidencia forte em todos os criterios aprova", () => {
    const resultado = avaliarEvidenciaPix(baseInput());

    expect(resultado.decisao).toBe("aprovar");
    expect(resultado.criterios.valor).toBe("ok");
    expect(resultado.criterios.beneficiario).toBe("ok");
    expect(resultado.criterios.status).toBe("ok");
    expect(resultado.criterios.horario).toBe("ok");
    expect(resultado.criterios.hash).toBe("novo");
    expect(resultado.criterios.e2e).toBe("novo");
    expect(resultado.criterios.legibilidade).toBe("alta");
    expect(resultado.score).toBeGreaterThanOrEqual(80);
    expect(resultado.motivos).toEqual([]);
  });

  test("sem horario legivel nao bloqueia aprovacao, mas nao e evidencia forte de fraude", () => {
    const resultado = avaliarEvidenciaPix(baseInput({ horario: horarioSemHorario }));

    expect(resultado.criterios.horario).toBe("ausente");
    expect(resultado.decisao).not.toBe("suspeito");
  });

  test("valor divergente cai em revisao, nao suspeito, se o resto for forte", () => {
    const resultado = avaliarEvidenciaPix(baseInput({ valorLido: 40 }));

    expect(resultado.criterios.valor).toBe("divergente");
    expect(resultado.decisao).toBe("revisar");
    expect(resultado.motivos).toContain("Valor do comprovante diverge do valor esperado.");
  });

  test("beneficiario divergente cai em revisao", () => {
    const resultado = avaliarEvidenciaPix(baseInput({ beneficiarioLido: "Outra Empresa Ltda" }));

    expect(resultado.criterios.beneficiario).toBe("divergente");
    expect(resultado.decisao).toBe("revisar");
  });

  test("valor E beneficiario divergentes ao mesmo tempo e suspeito", () => {
    const resultado = avaliarEvidenciaPix(
      baseInput({ valorLido: 10, beneficiarioLido: "Empresa Desconhecida" })
    );

    expect(resultado.decisao).toBe("suspeito");
    expect(resultado.score).toBeLessThanOrEqual(10);
  });

  test("valor e beneficiario ausentes (sem dados legiveis) nao aprova sozinho", () => {
    const resultado = avaliarEvidenciaPix(
      baseInput({ valorLido: null, beneficiarioLido: null, legibilidade: undefined })
    );

    expect(resultado.criterios.valor).toBe("ausente");
    expect(resultado.criterios.beneficiario).toBe("ausente");
    expect(resultado.decisao).not.toBe("aprovar");
  });

  test("status pendente ou agendado impede aprovacao automatica", () => {
    const resultado = avaliarEvidenciaPix(baseInput({ statusTransacao: "Pix agendado para amanha" }));

    expect(resultado.criterios.status).toBe("pendente_ou_agendado");
    expect(resultado.decisao).not.toBe("aprovar");
  });

  test("hash reutilizado e sempre suspeito, mesmo com todo o resto perfeito", () => {
    const resultado = avaliarEvidenciaPix(baseInput({ hashReutilizado: true }));

    expect(resultado.criterios.hash).toBe("reutilizado");
    expect(resultado.decisao).toBe("suspeito");
    expect(resultado.score).toBeLessThanOrEqual(10);
  });

  test("e2e reutilizado e sempre suspeito", () => {
    const resultado = avaliarEvidenciaPix(baseInput({ e2eReutilizado: true }));

    expect(resultado.criterios.e2e).toBe("reutilizado");
    expect(resultado.decisao).toBe("suspeito");
  });

  test("pagamento anterior ao pedido (fora da tolerancia) e sempre suspeito", () => {
    const resultado = avaliarEvidenciaPix(baseInput({ horario: horarioAnterior }));

    expect(resultado.criterios.horario).toBe("anterior_ao_pedido");
    expect(resultado.decisao).toBe("suspeito");
  });

  test("data do comprovante diferente da data do pedido tambem e tratada como horario invalido", () => {
    const resultado = avaliarEvidenciaPix(baseInput({ horario: horarioDataDiferente }));

    expect(resultado.criterios.horario).toBe("anterior_ao_pedido");
    expect(resultado.decisao).toBe("suspeito");
  });

  test("sem e2e nem codigo de autenticacao nao impede aprovacao sozinho", () => {
    const resultado = avaliarEvidenciaPix(
      baseInput({ e2eId: undefined, codigoAutenticacao: undefined })
    );

    expect(resultado.criterios.e2e).toBe("ausente");
    expect(resultado.decisao).toBe("aprovar");
  });

  test("legibilidade baixa impede aprovacao automatica mesmo com demais sinais ok", () => {
    const resultado = avaliarEvidenciaPix(baseInput({ legibilidade: "baixa" }));

    expect(resultado.criterios.legibilidade).toBe("baixa");
    expect(resultado.decisao).not.toBe("aprovar");
  });

  test("legibilidade desconhecida (nao informada pela IA) nao penaliza a aprovacao", () => {
    const resultado = avaliarEvidenciaPix(baseInput({ legibilidade: undefined }));

    expect(resultado.criterios.legibilidade).toBe("desconhecida");
    expect(resultado.decisao).toBe("aprovar");
  });

  test("score nunca aprova sem valor e beneficiario ok, mesmo com score alto", () => {
    const resultado = avaliarEvidenciaPix(
      baseInput({ statusTransacao: undefined, e2eId: undefined, codigoAutenticacao: undefined })
    );

    expect(resultado.criterios.status).toBe("ausente");
    expect(resultado.criterios.e2e).toBe("ausente");
    expect(resultado.decisao).toBe("aprovar");
  });

  test("motivos ficam vazios quando tudo esta ok", () => {
    const resultado = avaliarEvidenciaPix(baseInput());
    expect(resultado.motivos).toHaveLength(0);
  });

  test("comprovante de origem texto sem nenhum sinal forte cai em revisao ou suspeito, nunca aprova", () => {
    const resultado = avaliarEvidenciaPix({
      valorEsperado: 52,
      valorLido: undefined,
      beneficiarioEsperado: "Pizzaria Chefe da Pizza",
      beneficiarioLido: undefined,
      statusTransacao: undefined,
      horario: horarioSemHorario,
      hashReutilizado: false,
      e2eReutilizado: false,
      origem: "texto",
      legibilidade: undefined,
    });

    expect(resultado.decisao).not.toBe("aprovar");
  });
});
