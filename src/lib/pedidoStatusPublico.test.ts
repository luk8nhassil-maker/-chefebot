import { describe, expect, test } from "vitest";

import { classificarPagamentoPixPublico, montarStatusPublicoPedido } from "./pedidoStatusPublico";

describe("status publico de pedido Pix", () => {
  test("classifica Pix pendente como aguardando_pix", () => {
    expect(classificarPagamentoPixPublico({
      id: "1",
      status: "novo",
      total: 50,
      pagamento: "Pix",
      pix: { status: "pendente" },
    })).toBe("aguardando_pix");
  });

  test("classifica Pix confirmado como pago", () => {
    expect(classificarPagamentoPixPublico({
      id: "1",
      status: "novo",
      total: 50,
      pagamento: "Pix",
      pixConfirmado: true,
      pix: { status: "confirmado", confirmadoPor: "comprovante" },
    })).toBe("pago");
  });

  test("classifica revisao e suspeito sem marcar pago", () => {
    expect(classificarPagamentoPixPublico({
      id: "1",
      status: "novo",
      total: 50,
      pagamento: "Pix",
      pix: { status: "em_revisao" },
    })).toBe("em_revisao");

    expect(classificarPagamentoPixPublico({
      id: "2",
      status: "novo",
      total: 50,
      pagamento: "Pix",
      pix: { status: "suspeito" },
    })).toBe("conferencia_manual");
  });

  test("resposta publica nao inclui dados sensiveis", () => {
    const resposta = montarStatusPublicoPedido({
      id: "1",
      numero: 123,
      status: "novo",
      total: 50,
      tipoEntrega: "delivery",
      pagamento: "Pix",
      pix: { status: "em_revisao", evidencia: { decisao: "revisar" } },
    });

    expect(resposta).toMatchObject({
      id: "1",
      numero: 123,
      status: "novo",
      total: 50,
      pagamentoStatus: "em_revisao",
      pixConfirmado: false,
      pix: { status: "em_revisao", evidencia: { decisao: "revisar" } },
    });
    expect(resposta).not.toHaveProperty("telefone");
    expect(resposta).not.toHaveProperty("endereco");
    expect(resposta).not.toHaveProperty("cliente");
  });
});
