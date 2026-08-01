import { describe, expect, test } from "vitest";

import { encontrarPedidoPixPendentePorTelefone } from "./pixPedidoMatching";
import { formatarTelefoneExibicao, normalizarTelefoneBrasil, telefonesCorrespondem } from "./telefone";

describe("matching seguro de telefone", () => {
  test("telefone mascarado do cardapio bate com WhatsApp com 55", () => {
    expect(telefonesCorrespondem("(99) 9 9999-9999", "5599999999999")).toBe(true);
  });

  test("telefone sem mascara bate com WhatsApp com 55", () => {
    expect(telefonesCorrespondem("99999999999", "5599999999999")).toBe(true);
  });

  test("telefone com nono digito bate com legado sem nono digito no mesmo DDD", () => {
    expect(telefonesCorrespondem("(99) 9999-9999", "55 99 9 9999-9999")).toBe(true);
  });

  test("telefones diferentes nao batem", () => {
    expect(telefonesCorrespondem("(99) 9 9999-9999", "5599888888888")).toBe(false);
  });

  test("numero curto ou invalido nao bate", () => {
    expect(normalizarTelefoneBrasil("9999-9999")).toBeNull();
    expect(telefonesCorrespondem("9999-9999", "5599999999999")).toBe(false);
  });

  test("caso legado igual continua batendo", () => {
    expect(telefonesCorrespondem("5599999999999", "5599999999999")).toBe(true);
  });
});

describe("máscara de exibição do telefone (sem DDD fixo)", () => {
  test("aplica o padrão conforme o número de dígitos já digitados", () => {
    expect(formatarTelefoneExibicao("")).toBe("");
    expect(formatarTelefoneExibicao("86")).toBe("86");
    expect(formatarTelefoneExibicao("8699")).toBe("(86) 99");
    expect(formatarTelefoneExibicao("86999998888")).toBe("(86) 99999-8888");
    expect(formatarTelefoneExibicao("8699998888")).toBe("(86) 9999-8888");
  });

  test("ignora não-dígitos e trunca em 11 dígitos, sem assumir nenhum DDD", () => {
    expect(formatarTelefoneExibicao("(11) 91234-5678extra")).toBe("(11) 91234-5678");
    expect(formatarTelefoneExibicao(null)).toBe("");
  });
});

describe("busca de pedido Pix pendente por telefone", () => {
  test("encontra pedido Pix do cardapio com telefone mascarado pelo phone do WhatsApp", () => {
    const pedido = encontrarPedidoPixPendentePorTelefone([
      {
        id: "1",
        telefone: "(99) 9 9999-9999",
        status: "novo",
        pagamento: "Pix",
        pix: { status: "pendente", valorEsperado: 50 },
      },
    ], "5599999999999");

    expect(pedido?.id).toBe("1");
  });

  test("ignora pedido nao Pix e pedido Pix ja confirmado", () => {
    const pedido = encontrarPedidoPixPendentePorTelefone([
      {
        id: "1",
        telefone: "(99) 9 9999-9999",
        status: "novo",
        pagamento: "Dinheiro",
      },
      {
        id: "2",
        telefone: "(99) 9 9999-9999",
        status: "novo",
        pagamento: "Pix",
        pixConfirmado: true,
        pix: { status: "confirmado", valorEsperado: 50 },
      },
    ], "5599999999999");

    expect(pedido).toBeUndefined();
  });
});
