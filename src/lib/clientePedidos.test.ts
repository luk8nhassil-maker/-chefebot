import { describe, test, expect } from "vitest";
import {
  pedidoPertenceAoCliente,
  filtrarPedidosDoCliente,
  timestampOrdenacaoPedido,
  ordenarPedidosMaisNovoPrimeiro,
  paraResumoPublico,
  statusVisualPedido,
  tipoEntregaLabel,
  normalizarBusca,
  campoBuscavelPedido,
  filtrarPedidosPorBusca,
  destinoNextPermitido,
  type PedidoClienteFonte,
  type PedidoClienteResumo,
} from "./clientePedidos";

describe("pedidoPertenceAoCliente / filtrarPedidosDoCliente", () => {
  test("clienteId direto tem prioridade — nunca cai para telefone quando presente", () => {
    const p: PedidoClienteFonte = { id: "1", clienteId: "cli_a", telefone: "11900000009" };
    expect(pedidoPertenceAoCliente(p, "cli_a", "11900000001")).toBe(true);
    expect(pedidoPertenceAoCliente(p, "cli_b", "11900000009")).toBe(false);
  });

  test("sem clienteId, cai para telefone normalizado (aceita formatação com parênteses/traço)", () => {
    const p: PedidoClienteFonte = { id: "2", telefone: "(11) 90000-0001" };
    expect(pedidoPertenceAoCliente(p, "cli_a", "11900000001")).toBe(true);
  });

  test("sem clienteId e telefone diferente -> não pertence", () => {
    const p: PedidoClienteFonte = { id: "3", telefone: "11900000009" };
    expect(pedidoPertenceAoCliente(p, "cli_a", "11900000001")).toBe(false);
  });

  test("sem clienteId e sem telefone -> nunca pertence a ninguém", () => {
    const p: PedidoClienteFonte = { id: "4" };
    expect(pedidoPertenceAoCliente(p, "cli_a", "11900000001")).toBe(false);
  });

  test("filtrarPedidosDoCliente deduplica por id e ignora pedidos sem id", () => {
    const pedidos: PedidoClienteFonte[] = [
      { id: "1", clienteId: "cli_a" },
      { id: "1", clienteId: "cli_a" },
      { id: "2", clienteId: "cli_b" },
      { id: "" as unknown as string, clienteId: "cli_a" },
    ];
    const resultado = filtrarPedidosDoCliente(pedidos, "cli_a", "11900000001");
    expect(resultado).toHaveLength(1);
    expect(resultado[0].id).toBe("1");
  });
});

describe("timestampOrdenacaoPedido / ordenarPedidosMaisNovoPrimeiro", () => {
  test("id numérico (Date.now().toString()) é o critério primário", () => {
    expect(timestampOrdenacaoPedido({ id: "1700000000000" })).toBe(1700000000000);
  });

  test("id não numérico cai para data+horario (pt-BR) como fallback", () => {
    const t = timestampOrdenacaoPedido({ id: "abc", data: "10/01/2026", horario: "20:30" });
    expect(t).toBe(new Date(2026, 0, 10, 20, 30).getTime());
  });

  test("sem id numérico nem data/horario interpretável -> não quebra, vai para o fim", () => {
    expect(timestampOrdenacaoPedido({ id: "abc" })).toBe(-Infinity);
  });

  test("ordena do mais novo para o mais antigo", () => {
    const pedidos: PedidoClienteFonte[] = [
      { id: "1600000000000" },
      { id: "1700000000000" },
      { id: "1650000000000" },
    ];
    expect(ordenarPedidosMaisNovoPrimeiro(pedidos).map((p) => p.id)).toEqual([
      "1700000000000",
      "1650000000000",
      "1600000000000",
    ]);
  });
});

describe("paraResumoPublico — sanitização", () => {
  test("nunca inclui telefone/clienteId/statusToken/pix mesmo se presentes na fonte", () => {
    const fonte = {
      id: "1",
      clienteId: "cli_a",
      telefone: "11900000001",
      numero: 5,
      total: 10,
      status: "novo",
      itens: ["1x Suco"],
      // Campos que não existem no tipo público — simula vazamento acidental
      // de um objeto de fonte mais completo (ex.: com Pix/tokens) chegando
      // aqui sem querer; paraResumoPublico nunca deve repassá-los.
      statusToken: "segredo",
      pix: { qrCode: "segredo" },
    } as PedidoClienteFonte;
    const resumo = paraResumoPublico(fonte);
    expect(resumo).not.toHaveProperty("telefone");
    expect(resumo).not.toHaveProperty("clienteId");
    expect(resumo).not.toHaveProperty("statusToken");
    expect(resumo).not.toHaveProperty("pix");
    expect(resumo.id).toBe("1");
  });

  test("total ausente/malformado nunca quebra — cai para 0", () => {
    const resumo = paraResumoPublico({ id: "1", status: "novo" } as PedidoClienteFonte);
    expect(resumo.total).toBe(0);
    expect(resumo.itens).toEqual([]);
  });
});

describe("statusVisualPedido — rótulos por tipo de entrega", () => {
  test("delivery: a caminho / entregue", () => {
    expect(statusVisualPedido("saiu_entrega", "delivery").label).toBe("A caminho");
    expect(statusVisualPedido("entregue", "delivery").label).toBe("Entregue");
  });

  test("retirada: pronto para retirada / retirado", () => {
    expect(statusVisualPedido("saiu_entrega", "retirada").label).toBe("Pronto para retirada");
    expect(statusVisualPedido("entregue", "retirada").label).toBe("Retirado");
  });

  test("consumo local: pronto para servir / finalizado", () => {
    expect(statusVisualPedido("saiu_entrega", "dine_in").label).toBe("Pronto para servir");
    expect(statusVisualPedido("entregue", "dine_in").label).toBe("Finalizado");
  });

  test("cancelado é sempre perigo (vermelho), em qualquer tipo de entrega", () => {
    expect(statusVisualPedido("cancelado", "delivery").cor).toBe("perigo");
    expect(statusVisualPedido("cancelado", "retirada").cor).toBe("perigo");
  });

  test("em_preparo nunca usa a cor de marca (amarelo) — usa 'atencao' (roxo)", () => {
    expect(statusVisualPedido("em_preparo", "delivery").cor).toBe("atencao");
  });

  test("status desconhecido nunca lança erro — cai em rótulo neutro", () => {
    const visual = statusVisualPedido("estado-esquisito", "delivery");
    expect(visual.cor).toBe("neutro");
    expect(visual.label).toBe("estado-esquisito");
  });

  test("tipoEntregaLabel humaniza tipos conhecidos e devolve o valor cru para desconhecidos", () => {
    expect(tipoEntregaLabel("delivery")).toBe("Entrega");
    expect(tipoEntregaLabel("retirada")).toBe("Retirada");
    expect(tipoEntregaLabel("dine_in")).toBe("Consumo no local");
    expect(tipoEntregaLabel(undefined)).toBe("Entrega");
    expect(tipoEntregaLabel("outro")).toBe("outro");
  });
});

describe("normalizarBusca", () => {
  test("minúsculas e sem acento", () => {
    expect(normalizarBusca("Calabresa")).toBe("calabresa");
    expect(normalizarBusca("São João")).toBe("sao joao");
  });

  test("remove '#' e unifica ponto/vírgula em valor monetário", () => {
    expect(normalizarBusca("#42")).toBe("42");
    expect(normalizarBusca("45.90")).toBe("45,90");
    expect(normalizarBusca("45,90")).toBe("45,90");
  });

  test("pontuação vira espaço e espaços colapsam", () => {
    expect(normalizarBusca("Calabresa/Frango-Catupiry")).toBe("calabresa frango catupiry");
    expect(normalizarBusca("  muitos   espaços  ")).toBe("muitos espacos");
  });

  test("string vazia continua vazia", () => {
    expect(normalizarBusca("")).toBe("");
  });
});

function pedido(overrides: Partial<PedidoClienteResumo> = {}): PedidoClienteResumo {
  return {
    id: "1700000000000",
    numero: 42,
    cliente: "Ana Silva",
    data: "10/01/2026",
    horario: "20:30",
    total: 45.9,
    status: "em_preparo",
    tipoEntrega: "delivery",
    itens: ["1x Pizza G - Calabresa/Frango Catupiry", "1x Coca-Cola 2L"],
    pagamento: "Pix",
    bairro: "Centro",
    ...overrides,
  };
}

describe("filtrarPedidosPorBusca — campos pesquisáveis", () => {
  const pedidos = [pedido()];

  test("busca vazia retorna todos", () => {
    expect(filtrarPedidosPorBusca(pedidos, "")).toHaveLength(1);
    expect(filtrarPedidosPorBusca(pedidos, "   ")).toHaveLength(1);
  });

  test("por número", () => {
    expect(filtrarPedidosPorBusca(pedidos, "42")).toHaveLength(1);
  });

  test("por #número", () => {
    expect(filtrarPedidosPorBusca(pedidos, "#42")).toHaveLength(1);
  });

  test("por id", () => {
    expect(filtrarPedidosPorBusca(pedidos, "1700000000000")).toHaveLength(1);
  });

  test("por nome do cliente, sem diferenciar acento/caixa", () => {
    expect(filtrarPedidosPorBusca(pedidos, "ANA")).toHaveLength(1);
    expect(filtrarPedidosPorBusca([pedido({ cliente: "José" })], "jose")).toHaveLength(1);
  });

  test("por item/sabor/borda", () => {
    expect(filtrarPedidosPorBusca(pedidos, "calabresa")).toHaveLength(1);
    expect(filtrarPedidosPorBusca(pedidos, "coca-cola")).toHaveLength(1);
  });

  test("por status técnico e por status em linguagem humana", () => {
    expect(filtrarPedidosPorBusca(pedidos, "em_preparo")).toHaveLength(1);
    expect(filtrarPedidosPorBusca(pedidos, "em preparo")).toHaveLength(1);
  });

  test("por data e por horário", () => {
    expect(filtrarPedidosPorBusca(pedidos, "10/01/2026")).toHaveLength(1);
    expect(filtrarPedidosPorBusca(pedidos, "20:30")).toHaveLength(1);
  });

  test("por total, com vírgula ou ponto", () => {
    expect(filtrarPedidosPorBusca(pedidos, "45,90")).toHaveLength(1);
    expect(filtrarPedidosPorBusca(pedidos, "45.90")).toHaveLength(1);
  });

  test("por tipo de entrega e por pagamento", () => {
    expect(filtrarPedidosPorBusca(pedidos, "entrega")).toHaveLength(1);
    expect(filtrarPedidosPorBusca(pedidos, "pix")).toHaveLength(1);
  });

  test("por bairro, quando existe", () => {
    expect(filtrarPedidosPorBusca(pedidos, "centro")).toHaveLength(1);
  });

  test("termo sem correspondência não retorna nada", () => {
    expect(filtrarPedidosPorBusca(pedidos, "xablau")).toHaveLength(0);
  });

  test("campoBuscavelPedido nunca inclui token/campo interno (não existe no tipo público)", () => {
    const alvo = campoBuscavelPedido(pedido());
    expect(alvo).not.toContain("token");
  });
});

describe("destinoNextPermitido — retorno seguro do login (nunca open redirect)", () => {
  test("aceita destino da allowlist", () => {
    expect(destinoNextPermitido("/cliente/pedidos")).toBe("/cliente/pedidos");
  });

  test("null/ausente -> null", () => {
    expect(destinoNextPermitido(null)).toBeNull();
    expect(destinoNextPermitido(undefined)).toBeNull();
    expect(destinoNextPermitido("")).toBeNull();
  });

  test("rejeita qualquer destino fora da allowlist, incluindo URLs externas/absolutas", () => {
    expect(destinoNextPermitido("https://evil.example.com")).toBeNull();
    expect(destinoNextPermitido("//evil.example.com")).toBeNull();
    expect(destinoNextPermitido("/cardapio")).toBeNull();
    expect(destinoNextPermitido("/cliente")).toBeNull();
    expect(destinoNextPermitido("javascript:alert(1)")).toBeNull();
  });

  test("rejeita variações que tentam parecer com o destino permitido", () => {
    expect(destinoNextPermitido("/cliente/pedidos/")).toBeNull();
    expect(destinoNextPermitido("/cliente/pedidos?x=1")).toBeNull();
    expect(destinoNextPermitido("/cliente/pedidosXYZ")).toBeNull();
  });
});
