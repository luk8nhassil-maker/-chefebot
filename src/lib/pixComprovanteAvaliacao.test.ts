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

  test("sem e2e nem codigo de autenticacao nunca autoaprova: cai em revisao com motivo claro", () => {
    const resultado = avaliarEvidenciaPix(
      baseInput({ e2eId: undefined, codigoAutenticacao: undefined })
    );

    expect(resultado.criterios.e2e).toBe("ausente");
    expect(resultado.decisao).toBe("revisar");
    expect(resultado.motivos).toContain("ID da transacao/E2E nao identificado no comprovante.");
  });

  test("codigo de autenticacao (sem e2eId) conta como identificador e permite aprovar", () => {
    const resultado = avaliarEvidenciaPix(
      baseInput({ e2eId: undefined, codigoAutenticacao: "A1B2C3D4E5F6G7H8" })
    );

    expect(resultado.criterios.e2e).toBe("novo");
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

  test("status ausente sozinho nao bloqueia aprovacao quando ha e2e e demais sinais fortes", () => {
    const resultado = avaliarEvidenciaPix(baseInput({ statusTransacao: undefined }));

    expect(resultado.criterios.status).toBe("ausente");
    expect(resultado.criterios.e2e).toBe("novo");
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

// Regressao do falso negativo real (pedido de R$ 1,00, PDF): a chave lida veio
// como telefone formatado pelo banco e era comparada contra o NOME do titular,
// caindo em "divergente" -> revisar mesmo com comprovante correto.
describe("avaliarEvidenciaPix — chave Pix em formato diferente (regressao falso negativo)", () => {
  test.each([
    "+55 99 97400-0691",
    "(99) 97400-0691",
    "55 99 97400-0691",
    "99974000691",
  ])("valor ok + chave equivalente %s aprova com os demais sinais fortes", (chaveLida) => {
    const resultado = avaliarEvidenciaPix({
      valorEsperado: 1,
      valorLido: 1,
      chaveEsperada: "99974000691",
      chaveLida,
      beneficiarioEsperado: "Kellyne F dos Santos",
      beneficiarioLido: null,
      statusTransacao: "concluido",
      horario: horarioOk,
      hashReutilizado: false,
      e2eId: "E12345678202607041200ABCDEFG12",
      e2eReutilizado: false,
      origem: "pdf",
      legibilidade: "alta",
    });

    expect(resultado.criterios.beneficiario).toBe("ok");
    expect(resultado.decisao).toBe("aprovar");
    expect(resultado.motivos).not.toContain("Beneficiario/chave do comprovante nao corresponde ao esperado.");
  });

  test("valor ok mas chave/beneficiario ilegiveis cai em revisar, nao suspeito", () => {
    const resultado = avaliarEvidenciaPix({
      valorEsperado: 1,
      valorLido: 1,
      chaveEsperada: "99974000691",
      chaveLida: null,
      beneficiarioEsperado: "Kellyne F dos Santos",
      beneficiarioLido: null,
      statusTransacao: "concluido",
      horario: horarioOk,
      hashReutilizado: false,
      e2eReutilizado: false,
      origem: "pdf",
      legibilidade: "alta",
    });

    expect(resultado.criterios.beneficiario).toBe("ausente");
    expect(resultado.decisao).toBe("revisar");
  });

  test("valor ok mas chave claramente de outro recebedor cai em revisar", () => {
    const resultado = avaliarEvidenciaPix({
      valorEsperado: 1,
      valorLido: 1,
      chaveEsperada: "99974000691",
      chaveLida: "(11) 98888-7777",
      beneficiarioEsperado: "Kellyne F dos Santos",
      beneficiarioLido: null,
      statusTransacao: "concluido",
      horario: horarioOk,
      hashReutilizado: false,
      e2eReutilizado: false,
      origem: "pdf",
      legibilidade: "alta",
    });

    expect(resultado.criterios.beneficiario).toBe("divergente");
    expect(resultado.decisao).toBe("revisar");
  });

  test("chave equivalente nao salva comprovante com hash reutilizado: continua suspeito", () => {
    const resultado = avaliarEvidenciaPix({
      valorEsperado: 1,
      valorLido: 1,
      chaveEsperada: "99974000691",
      chaveLida: "+55 99 97400-0691",
      statusTransacao: "concluido",
      horario: horarioOk,
      hashReutilizado: true,
      e2eReutilizado: false,
      origem: "pdf",
      legibilidade: "alta",
    });

    expect(resultado.decisao).toBe("suspeito");
  });

  test("chave equivalente nao salva comprovante com horario anterior: continua suspeito", () => {
    const resultado = avaliarEvidenciaPix({
      valorEsperado: 1,
      valorLido: 1,
      chaveEsperada: "99974000691",
      chaveLida: "+55 99 97400-0691",
      statusTransacao: "concluido",
      horario: horarioAnterior,
      hashReutilizado: false,
      e2eReutilizado: false,
      origem: "pdf",
      legibilidade: "alta",
    });

    expect(resultado.decisao).toBe("suspeito");
  });

  test("chave equivalente com valor errado nunca aprova", () => {
    const resultado = avaliarEvidenciaPix({
      valorEsperado: 52,
      valorLido: 1,
      chaveEsperada: "99974000691",
      chaveLida: "+55 99 97400-0691",
      statusTransacao: "concluido",
      horario: horarioOk,
      hashReutilizado: false,
      e2eReutilizado: false,
      origem: "pdf",
      legibilidade: "alta",
    });

    expect(resultado.decisao).not.toBe("aprovar");
  });
});

// Regressao do teste real pos-PR #139: comprovante com valor, chave, beneficiario,
// status e horario visiveis e corretos, mas com o E2E/ID da transacao escondido ou
// cortado do print, era autoaprovado. Sem identificador de transacao nao ha como
// amarrar o print a uma transacao real — deve ir para revisao humana.
describe("avaliarEvidenciaPix — E2E/ID da transacao obrigatorio para autoaprovar", () => {
  const comprovantePerfeitoSemE2E = {
    valorEsperado: 1,
    valorLido: 1,
    chaveEsperada: "99974000691",
    chaveLida: "+55 99 97400-0691",
    beneficiarioEsperado: "Kellyne F dos Santos",
    beneficiarioLido: "Kellyne F dos Santos",
    statusTransacao: "concluido",
    horario: horarioOk,
    hashReutilizado: false,
    e2eReutilizado: false,
    origem: "pdf" as const,
    legibilidade: "alta" as const,
  };

  test("tudo correto mas sem E2E/ID visivel cai em revisar, nunca aprova", () => {
    const resultado = avaliarEvidenciaPix(comprovantePerfeitoSemE2E);

    expect(resultado.criterios.e2e).toBe("ausente");
    expect(resultado.decisao).toBe("revisar");
    expect(resultado.motivos).toContain("ID da transacao/E2E nao identificado no comprovante.");
  });

  test("mesmo comprovante com E2E visivel e inedito aprova", () => {
    const resultado = avaliarEvidenciaPix({
      ...comprovantePerfeitoSemE2E,
      e2eId: "E12345678202607041200ABCDEFG12",
    });

    expect(resultado.criterios.e2e).toBe("novo");
    expect(resultado.decisao).toBe("aprovar");
    expect(resultado.motivos).not.toContain("ID da transacao/E2E nao identificado no comprovante.");
  });

  test("mesmo comprovante com E2E reutilizado continua suspeito", () => {
    const resultado = avaliarEvidenciaPix({
      ...comprovantePerfeitoSemE2E,
      e2eId: "E12345678202607041200ABCDEFG12",
      e2eReutilizado: true,
    });

    expect(resultado.decisao).toBe("suspeito");
  });
});
