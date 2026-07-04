import { vi, describe, test, expect } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));
vi.mock("./mercadoPagoPix", () => ({ criarCobrancaPixMercadoPago: vi.fn() }));

import { confirmarPixMetadata, marcarPixRevisaoOuSuspeito, registrarPixEvidencia, type PixMetadata } from "./pix";
import { avaliarEvidenciaPix } from "./pixComprovanteAvaliacao";
import type { ResultadoHorarioComprovantePix } from "./pixComprovanteHorario";

const horarioOk: ResultadoHorarioComprovantePix = { ok: true, bloquear: false, motivo: "ok" };

// Reproduz a mesma composicao usada em src/app/api/whatsapp/route.ts (Etapa 2E):
// avaliarEvidenciaPix() decide, e o resultado e persistido via registrarPixEvidencia +
// confirmarPixMetadata (aprovar) ou marcarPixRevisaoOuSuspeito (revisar/suspeito).
function aplicarDecisaoPix(pix: PixMetadata | undefined, avaliacao: ReturnType<typeof avaliarEvidenciaPix>): PixMetadata {
  const comEvidencia = registrarPixEvidencia(pix || {}, {
    origem: "midia",
    hash: "hash-fake",
    decisao: avaliacao.decisao,
    score: avaliacao.score,
    criterios: avaliacao.criterios,
    motivos: avaliacao.motivos,
  });

  if (avaliacao.decisao === "aprovar") return confirmarPixMetadata(comEvidencia, "comprovante");
  return marcarPixRevisaoOuSuspeito(comEvidencia, avaliacao.decisao === "suspeito" ? "suspeito" : "em_revisao");
}

describe("integracao avaliarEvidenciaPix + pix.ts (Etapa 2E)", () => {
  test("decisao aprovar confirma o Pix normalmente", () => {
    const avaliacao = avaliarEvidenciaPix({
      valorEsperado: 52,
      valorLido: 52,
      beneficiarioEsperado: "Chefe da Pizza",
      beneficiarioLido: "Chefe da Pizza LTDA",
      statusTransacao: "concluido",
      horario: horarioOk,
      hashReutilizado: false,
      e2eId: "E12345678202607041200ABCDEFG12",
      e2eReutilizado: false,
      origem: "imagem",
      legibilidade: "alta",
    });

    const pix = aplicarDecisaoPix({ txid: "chefebot_1", valorEsperado: 52, status: "pendente" }, avaliacao);

    expect(avaliacao.decisao).toBe("aprovar");
    expect(pix.status).toBe("confirmado");
    expect(pix.confirmadoPor).toBe("comprovante");
    expect(pix.evidencia?.decisao).toBe("aprovar");
    expect(pix.evidencia?.score).toBe(avaliacao.score);
    expect(pix.evidencia?.criterios).toEqual(avaliacao.criterios);
  });

  test("tudo correto mas sem E2E/ID visivel nao confirma: pix.status = em_revisao", () => {
    const avaliacao = avaliarEvidenciaPix({
      valorEsperado: 52,
      valorLido: 52,
      beneficiarioEsperado: "Chefe da Pizza",
      beneficiarioLido: "Chefe da Pizza LTDA",
      statusTransacao: "concluido",
      horario: horarioOk,
      hashReutilizado: false,
      e2eReutilizado: false,
      origem: "imagem",
      legibilidade: "alta",
    });

    const pix = aplicarDecisaoPix({ txid: "chefebot_9", valorEsperado: 52, status: "pendente" }, avaliacao);

    expect(avaliacao.decisao).toBe("revisar");
    expect(pix.status).toBe("em_revisao");
    expect(pix.confirmadoPor).toBeUndefined();
    expect(pix.evidencia?.motivos).toContain("ID da transacao/E2E nao identificado no comprovante.");
  });

  test("decisao revisar nao confirma e marca pix.status = em_revisao", () => {
    const avaliacao = avaliarEvidenciaPix({
      valorEsperado: 52,
      valorLido: 40,
      beneficiarioEsperado: "Chefe da Pizza",
      beneficiarioLido: "Chefe da Pizza LTDA",
      statusTransacao: "concluido",
      horario: horarioOk,
      hashReutilizado: false,
      e2eReutilizado: false,
      origem: "imagem",
      legibilidade: "alta",
    });

    const pix = aplicarDecisaoPix({ txid: "chefebot_2", valorEsperado: 52, status: "pendente" }, avaliacao);

    expect(avaliacao.decisao).toBe("revisar");
    expect(pix.status).toBe("em_revisao");
    expect(pix.confirmadoPor).toBeUndefined();
    expect(pix.evidencia?.decisao).toBe("revisar");
    expect(pix.evidencia?.motivos?.length).toBeGreaterThan(0);
  });

  test("decisao suspeito nao confirma e marca pix.status = suspeito", () => {
    const avaliacao = avaliarEvidenciaPix({
      valorEsperado: 52,
      valorLido: 52,
      beneficiarioEsperado: "Chefe da Pizza",
      beneficiarioLido: "Chefe da Pizza LTDA",
      statusTransacao: "concluido",
      horario: horarioOk,
      hashReutilizado: true,
      e2eReutilizado: false,
      origem: "imagem",
      legibilidade: "alta",
    });

    const pix = aplicarDecisaoPix({ txid: "chefebot_3", valorEsperado: 52, status: "pendente" }, avaliacao);

    expect(avaliacao.decisao).toBe("suspeito");
    expect(pix.status).toBe("suspeito");
    expect(pix.confirmadoPor).toBeUndefined();
    expect(pix.evidencia?.decisao).toBe("suspeito");
  });

  test("pedido antigo sem pix.evidencia (so pixConfirmado legado) continua compativel: revisao nao quebra e nao rebaixa nada, pois nao ha status confirmado", () => {
    const pixLegado: PixMetadata = { status: "pendente" };
    const avaliacao = avaliarEvidenciaPix({
      valorEsperado: 30,
      valorLido: undefined,
      beneficiarioEsperado: "Chefe da Pizza",
      beneficiarioLido: undefined,
      statusTransacao: undefined,
      horario: horarioOk,
      hashReutilizado: false,
      e2eReutilizado: false,
      origem: "texto",
      legibilidade: undefined,
    });

    const pix = aplicarDecisaoPix(pixLegado, avaliacao);

    expect(avaliacao.decisao).not.toBe("aprovar");
    expect(pix.status).toBe(avaliacao.decisao === "suspeito" ? "suspeito" : "em_revisao");
  });

  test("pix ja confirmado (ex: webhook) nunca e rebaixado para em_revisao/suspeito", () => {
    const pixConfirmadoPorWebhook: PixMetadata = {
      status: "confirmado",
      confirmadoPor: "webhook",
      confirmadoEm: "2026-07-04T19:00:00.000Z",
    };

    expect(marcarPixRevisaoOuSuspeito(pixConfirmadoPorWebhook, "em_revisao")).toBe(pixConfirmadoPorWebhook);
    expect(marcarPixRevisaoOuSuspeito(pixConfirmadoPorWebhook, "suspeito")).toBe(pixConfirmadoPorWebhook);
  });

  test("marcarPixRevisaoOuSuspeito aceita pix undefined (pedido antigo sem metadata)", () => {
    expect(marcarPixRevisaoOuSuspeito(undefined, "em_revisao")).toEqual({ status: "em_revisao" });
  });

  test("registrarPixEvidencia com apenas decisao/score persiste sem exigir e2e/motivo antigos", () => {
    const pix: PixMetadata = { status: "pendente" };
    const atualizado = registrarPixEvidencia(pix, {
      origem: "midia",
      hash: "abc123",
      decisao: "revisar",
      score: 45,
      criterios: {
        valor: "ok",
        beneficiario: "ausente",
        status: "ok",
        horario: "ok",
        hash: "novo",
        e2e: "ausente",
        legibilidade: "desconhecida",
      },
      motivos: ["Nao foi possivel identificar o beneficiario/chave no comprovante."],
    });

    expect(atualizado.evidencia?.hash).toBe("abc123");
    expect(atualizado.evidencia?.decisao).toBe("revisar");
    expect(atualizado.evidencia?.score).toBe(45);
    expect(atualizado.evidencia?.motivos).toEqual(["Nao foi possivel identificar o beneficiario/chave no comprovante."]);
  });
});
