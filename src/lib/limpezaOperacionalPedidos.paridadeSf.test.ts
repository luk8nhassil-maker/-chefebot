import { describe, expect, test } from "vitest";
import {
  LIMIAR_ENTREGA_MIN,
  LIMIAR_REAVISO_ENTREGA_MIN,
  acaoPrincipal,
  acaoSecundaria,
  classificarPendencia,
  type PedidoLimpeza,
} from "./limpezaOperacionalPedidos";

const MIN = 60_000;

function pedido(base: Partial<PedidoLimpeza>): PedidoLimpeza {
  return { id: String(Date.now()), cliente: "Teste operacional", status: "novo", ...base };
}

describe("paridade do gate operacional com a referência São Francisco", () => {
  test("pedido não resolvido do expediente anterior bloqueia imediatamente após 03:00", () => {
    const criado = Date.parse("2026-08-20T05:55:00.000Z"); // 02:55 BRT
    const agora = Date.parse("2026-08-20T06:01:00.000Z"); // 03:01 BRT
    const p = pedido({ id: String(criado), status: "novo" });
    const pendencia = classificarPendencia(p, agora);
    expect(pendencia).toMatchObject({ motivo: "novo_sem_aceite", titulo: "Esse pedido ficou do expediente anterior" });
  });

  test.each(["em_revisao", "suspeito", "comprovante_recebido"])("Pix %s nunca cai na cozinha genérica", (statusPix) => {
    const agora = Date.parse("2026-08-20T20:00:00.000Z");
    const p = pedido({
      id: String(agora - 90 * MIN),
      status: "novo",
      pagamento: "Pix",
      pix: { status: statusPix },
    });
    expect(classificarPendencia(p, agora)).toBeNull();
  });

  test("delivery cobra em 20 min e depois a cada 5 min", () => {
    const agora = Date.parse("2026-08-20T20:00:00.000Z");
    const inicial = pedido({
      id: String(agora - 200 * MIN),
      status: "saiu_entrega",
      tipoEntrega: "delivery",
      statusAtualizadoEm: new Date(agora - LIMIAR_ENTREGA_MIN * MIN).toISOString(),
    });
    expect(classificarPendencia(inicial, agora)?.motivo).toBe("entrega_longa");

    const adiado = pedido({
      ...inicial,
      statusAtualizadoEm: new Date(agora - LIMIAR_REAVISO_ENTREGA_MIN * MIN).toISOString(),
      limpezaOperacional: {
        motivo: "entrega_longa",
        acao: "adiou",
        resolvidoEm: new Date(agora - LIMIAR_REAVISO_ENTREGA_MIN * MIN).toISOString(),
        tentativas: 1,
      },
    });
    expect(classificarPendencia(adiado, agora)?.motivo).toBe("entrega_longa");
  });

  test("depois de duas confirmações delivery exige problema ou conclusão", () => {
    const agora = Date.parse("2026-08-20T20:00:00.000Z");
    const p = pedido({
      id: String(agora - 200 * MIN),
      status: "saiu_entrega",
      tipoEntrega: "delivery",
      statusAtualizadoEm: new Date(agora - 5 * MIN).toISOString(),
      limpezaOperacional: {
        motivo: "entrega_longa",
        acao: "adiou",
        resolvidoEm: new Date(agora - 5 * MIN).toISOString(),
        tentativas: 2,
      },
    });
    const pendencia = classificarPendencia(p, agora)!;
    expect(pendencia.exigirProblema).toBe(true);
    expect(pendencia.podeRelatarProblema).toBe(true);
    expect(acaoSecundaria(pendencia)).toBeNull();
  });

  test("Salão preserva Pronto para servir antes de Servido", () => {
    const agora = Date.parse("2026-08-20T20:00:00.000Z");
    const cozinha = classificarPendencia(pedido({
      id: String(agora - 200 * MIN),
      status: "em_preparo",
      tipoEntrega: "dine_in",
      statusAtualizadoEm: new Date(agora - 75 * MIN).toISOString(),
    }), agora)!;
    expect(acaoPrincipal(cozinha)).toMatchObject({ label: "PRONTO PARA SERVIR", status: "saiu_entrega" });

    const pronto = classificarPendencia(pedido({
      id: String(agora - 200 * MIN),
      status: "saiu_entrega",
      tipoEntrega: "dine_in",
      statusAtualizadoEm: new Date(agora - 20 * MIN).toISOString(),
    }), agora)!;
    expect(pronto.titulo).toContain("pronto para servir");
    expect(acaoPrincipal(pronto)).toMatchObject({ label: "PEDIDO SERVIDO", status: "entregue" });
    expect(acaoSecundaria(pronto)?.label).toContain("5 MIN");
  });

  test("retirada após duas confirmações exige contato se cliente não foi avisado", () => {
    const agora = Date.parse("2026-08-20T20:00:00.000Z");
    const pronto = classificarPendencia(pedido({
      id: String(agora - 200 * MIN),
      status: "saiu_entrega",
      tipoEntrega: "retirada",
      statusAtualizadoEm: new Date(agora - 5 * MIN).toISOString(),
      limpezaOperacional: {
        motivo: "entrega_longa",
        acao: "adiou",
        resolvidoEm: new Date(agora - 5 * MIN).toISOString(),
        tentativas: 2,
      },
    }), agora)!;
    expect(pronto.modalidade).toBe("retirada");
    expect(pronto.podeRelatarProblema).toBe(false);
    expect(acaoSecundaria(pronto)).toBeNull();
  });
});
