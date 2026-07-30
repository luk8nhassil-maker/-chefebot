import { describe, test, expect } from "vitest";
import {
  LIMIAR_PIX_PENDENTE_MIN,
  LIMIAR_NOVO_SEM_ACEITE_MIN,
  LIMIAR_PREPARO_MIN,
  LIMIAR_ENTREGA_MIN,
  timestampDeHoraLocal,
  timestampPedido,
  timestampDaEtapa,
  idadeDaEtapaMinutos,
  classificarPendencia,
  listarPendencias,
  acaoPrincipal,
  acaoSecundaria,
  registrarResolucao,
  calcularAnaliseOperacional,
  sanitizarEntradaLimpeza,
  type PedidoLimpeza,
} from "./limpezaOperacionalPedidos";

// 2026-07-30T20:00:00Z = 17:00 em America/Sao_Paulo (UTC-3).
const AGORA = Date.parse("2026-07-30T20:00:00.000Z");
const MIN = 60_000;

function pedido(overrides: Partial<PedidoLimpeza> = {}): PedidoLimpeza {
  return {
    id: String(AGORA - 5 * MIN),
    numero: 42,
    cliente: "Fulano",
    status: "novo",
    ...overrides,
  };
}

describe("timestampDeHoraLocal", () => {
  test("reconstrói o horário de hoje no fuso do estabelecimento", () => {
    // 16:30 em SP = 19:30Z.
    expect(timestampDeHoraLocal("16:30", AGORA)).toBe(Date.parse("2026-07-30T19:30:00.000Z"));
  });

  test("horário no futuro pertence ao dia anterior (virada de meia-noite)", () => {
    // Consulta às 00:10 de SP; pedido carimbado 23:50 é de ontem.
    const meiaNoiteEDez = Date.parse("2026-07-31T03:10:00.000Z");
    expect(timestampDeHoraLocal("23:50", meiaNoiteEDez)).toBe(
      Date.parse("2026-07-31T02:50:00.000Z")
    );
  });

  test("nunca lança: formato desconhecido devolve null", () => {
    expect(timestampDeHoraLocal("", AGORA)).toBeNull();
    expect(timestampDeHoraLocal("abc", AGORA)).toBeNull();
    expect(timestampDeHoraLocal("99:99", AGORA)).toBeNull();
    expect(timestampDeHoraLocal(undefined, AGORA)).toBeNull();
  });
});

describe("timestampPedido — cadeia de fallback", () => {
  test("usa o próprio ID quando ele é um Date.now() de 13 dígitos", () => {
    const ts = AGORA - 30 * MIN;
    expect(timestampPedido(pedido({ id: String(ts) }), AGORA)).toBe(ts);
  });

  test("cai para o carimbo do Pix quando o ID não é timestamp", () => {
    const p = pedido({ id: "ped_abc", pix: { criadoEm: "2026-07-30T19:00:00.000Z" } });
    expect(timestampPedido(p, AGORA)).toBe(Date.parse("2026-07-30T19:00:00.000Z"));
  });

  test("cai para o horário HH:MM quando não há ID nem Pix", () => {
    const p = pedido({ id: "ped_abc", horario: "16:00" });
    expect(timestampPedido(p, AGORA)).toBe(Date.parse("2026-07-30T19:00:00.000Z"));
  });

  test("devolve null quando nada resolve", () => {
    expect(timestampPedido(pedido({ id: "ped_abc" }), AGORA)).toBeNull();
  });
});

describe("timestampDaEtapa — idade medida na etapa, não na criação", () => {
  test("usa o carimbo de mudança de status quando o pedido saiu do estado inicial", () => {
    const p = pedido({
      id: String(AGORA - 300 * MIN), // criado há 5 horas
      status: "em_preparo",
      statusAtualizadoEm: new Date(AGORA - 4 * MIN).toISOString(),
    });
    expect(idadeDaEtapaMinutos(p, AGORA)).toBe(4);
  });

  test("em preparo sem carimbo, reconstrói pelo horarioInicio", () => {
    const p = pedido({ id: String(AGORA - 300 * MIN), status: "em_preparo", horarioInicio: "16:30" });
    expect(timestampDaEtapa(p, AGORA)).toBe(Date.parse("2026-07-30T19:30:00.000Z"));
    expect(idadeDaEtapaMinutos(p, AGORA)).toBe(30);
  });

  test("pedido novo ignora carimbo de status e usa a criação", () => {
    const p = pedido({
      id: String(AGORA - 20 * MIN),
      status: "novo",
      statusAtualizadoEm: new Date(AGORA - 1 * MIN).toISOString(),
    });
    expect(idadeDaEtapaMinutos(p, AGORA)).toBe(20);
  });

  test("idade indeterminada é 0 — na dúvida o sistema não acusa pendência", () => {
    expect(idadeDaEtapaMinutos(pedido({ id: "ped_abc" }), AGORA)).toBe(0);
  });

  test("carimbo no futuro não produz idade negativa", () => {
    const p = pedido({ id: String(AGORA + 10 * MIN) });
    expect(idadeDaEtapaMinutos(p, AGORA)).toBe(0);
  });
});

describe("classificarPendencia", () => {
  test("pedido arquivado nunca gera pendência", () => {
    const p = pedido({ id: String(AGORA - 600 * MIN), isArchived: true });
    expect(classificarPendencia(p, AGORA)).toBeNull();
  });

  test("estado terminal nunca gera pendência", () => {
    for (const status of ["entregue", "cancelado"]) {
      const p = pedido({ id: String(AGORA - 600 * MIN), status });
      expect(classificarPendencia(p, AGORA)).toBeNull();
    }
  });

  test("pedido já resolvido não volta a aparecer (registro durável)", () => {
    const p = pedido({
      id: String(AGORA - 600 * MIN),
      limpezaOperacional: { motivo: "novo_sem_aceite", acao: "cancelou", resolvidoEm: new Date(AGORA).toISOString() },
    });
    expect(classificarPendencia(p, AGORA)).toBeNull();
  });

  test("pedido recente não gera pendência", () => {
    expect(classificarPendencia(pedido(), AGORA)).toBeNull();
  });

  test("novo sem aceite acima do limiar", () => {
    const p = pedido({ id: String(AGORA - (LIMIAR_NOVO_SEM_ACEITE_MIN + 1) * MIN) });
    const r = classificarPendencia(p, AGORA);
    expect(r?.motivo).toBe("novo_sem_aceite");
    expect(r?.idadeMinutos).toBe(LIMIAR_NOVO_SEM_ACEITE_MIN + 1);
    expect(r?.titulo).toContain("min");
  });

  test("Pix pendente tem precedência sobre a falta de aceite", () => {
    const p = pedido({
      id: String(AGORA - (LIMIAR_PIX_PENDENTE_MIN + 5) * MIN),
      pagamento: "Pix",
    });
    expect(classificarPendencia(p, AGORA)?.motivo).toBe("pagamento_pix_pendente");
  });

  test("Pix já confirmado volta a ser apenas falta de aceite", () => {
    const p = pedido({
      id: String(AGORA - (LIMIAR_PIX_PENDENTE_MIN + 5) * MIN),
      pagamento: "Pix",
      pixConfirmado: true,
    });
    expect(classificarPendencia(p, AGORA)?.motivo).toBe("novo_sem_aceite");
  });

  test("pagamento misto conta como Pix para efeito de pendência", () => {
    const p = pedido({
      id: String(AGORA - (LIMIAR_PIX_PENDENTE_MIN + 5) * MIN),
      pagamento: "Pix (R$ 30,00) + Dinheiro (R$ 20,00)",
    });
    expect(classificarPendencia(p, AGORA)?.motivo).toBe("pagamento_pix_pendente");
  });

  test("preparo longo e entrega longa", () => {
    const preparo = pedido({
      status: "em_preparo",
      statusAtualizadoEm: new Date(AGORA - (LIMIAR_PREPARO_MIN + 1) * MIN).toISOString(),
    });
    expect(classificarPendencia(preparo, AGORA)?.motivo).toBe("preparo_longo");

    const entrega = pedido({
      status: "saiu_entrega",
      statusAtualizadoEm: new Date(AGORA - (LIMIAR_ENTREGA_MIN + 1) * MIN).toISOString(),
    });
    expect(classificarPendencia(entrega, AGORA)?.motivo).toBe("entrega_longa");
  });

  test("status desconhecido nunca gera pendência", () => {
    const p = pedido({ id: String(AGORA - 600 * MIN), status: "aguardando_algo_novo" });
    expect(classificarPendencia(p, AGORA)).toBeNull();
  });

  test("pedido sem ID é descartado sem lançar", () => {
    expect(classificarPendencia({ status: "novo" } as PedidoLimpeza, AGORA)).toBeNull();
  });

  test("a descrição já vem redigida — a interface não monta texto", () => {
    const p = pedido({ id: String(AGORA - 200 * MIN), status: "em_preparo" });
    const r = classificarPendencia(p, AGORA);
    expect(r?.descricao.length).toBeGreaterThan(20);
    expect(r?.titulo).toContain("h");
  });
});

describe("listarPendencias", () => {
  test("ordena por prioridade do motivo e desempata pela mais antiga", () => {
    const pendentes = listarPendencias(
      [
        pedido({ id: String(AGORA - 20 * MIN), numero: 1 }), // novo_sem_aceite
        pedido({ id: String(AGORA - 90 * MIN), numero: 2, status: "em_preparo" }), // preparo_longo
        pedido({ id: String(AGORA - 40 * MIN), numero: 3, pagamento: "Pix" }), // pix
        pedido({ id: String(AGORA - 200 * MIN), numero: 4 }), // novo_sem_aceite, mais antigo
      ],
      AGORA
    );
    expect(pendentes.map((p) => p.numero)).toEqual([3, 2, 4, 1]);
  });

  test("entrada não-array devolve lista vazia sem lançar", () => {
    expect(listarPendencias(null as unknown as PedidoLimpeza[], AGORA)).toEqual([]);
  });
});

describe("ações de resolução", () => {
  test("Pix pendente: a ação primária é verificar o provedor, não cancelar", () => {
    const p = classificarPendencia(
      pedido({ id: String(AGORA - 40 * MIN), pagamento: "Pix" }),
      AGORA
    )!;
    expect(acaoPrincipal(p).acao).toBe("verificou_pagamento");
    expect(acaoPrincipal(p).status).toBeUndefined();
    expect(acaoSecundaria(p).status).toBe("cancelado");
  });

  test("demais motivos avançam para o estado seguinte", () => {
    const novo = classificarPendencia(pedido({ id: String(AGORA - 40 * MIN) }), AGORA)!;
    expect(acaoPrincipal(novo)).toMatchObject({ acao: "avancou", status: "em_preparo" });

    const preparo = classificarPendencia(
      pedido({ id: String(AGORA - 200 * MIN), status: "em_preparo" }),
      AGORA
    )!;
    expect(acaoPrincipal(preparo)).toMatchObject({ acao: "avancou", status: "saiu_entrega" });

    const entrega = classificarPendencia(
      pedido({ id: String(AGORA - 200 * MIN), status: "saiu_entrega" }),
      AGORA
    )!;
    expect(acaoPrincipal(entrega)).toMatchObject({ acao: "avancou", status: "entregue" });
  });

  test("toda pendência tem uma segunda saída", () => {
    const p = classificarPendencia(pedido({ id: String(AGORA - 40 * MIN) }), AGORA)!;
    expect(acaoSecundaria(p).acao).toBe("cancelou");
  });

  test("registrarResolucao produz o registro durável", () => {
    const r = registrarResolucao("novo_sem_aceite", "cancelou", AGORA, "Kellyne");
    expect(r).toEqual({
      motivo: "novo_sem_aceite",
      acao: "cancelou",
      resolvidoEm: new Date(AGORA).toISOString(),
      resolvidoPor: "Kellyne",
    });
  });

  test("resolvidoPor é omitido quando não informado", () => {
    expect(registrarResolucao("preparo_longo", "avancou", AGORA)).not.toHaveProperty("resolvidoPor");
  });
});

describe("calcularAnaliseOperacional", () => {
  test("conta resoluções, o dia corrente no fuso fixo e a taxa de abandono", () => {
    const ontem = Date.parse("2026-07-29T20:00:00.000Z");
    const analise = calcularAnaliseOperacional(
      [
        pedido({ id: "a", status: "cancelado", limpezaOperacional: { motivo: "novo_sem_aceite", acao: "cancelou", resolvidoEm: new Date(AGORA).toISOString() } }),
        pedido({ id: "b", status: "entregue", limpezaOperacional: { motivo: "entrega_longa", acao: "avancou", resolvidoEm: new Date(AGORA).toISOString() } }),
        pedido({ id: "c", status: "cancelado", limpezaOperacional: { motivo: "novo_sem_aceite", acao: "cancelou", resolvidoEm: new Date(ontem).toISOString() } }),
      ],
      AGORA
    );

    expect(analise.totalResolvidas).toBe(3);
    expect(analise.resolvidasHoje).toBe(2);
    expect(analise.porMotivo.novo_sem_aceite).toBe(2);
    expect(analise.porMotivo.entrega_longa).toBe(1);
    expect(analise.taxaAbandono).toBeCloseTo(2 / 3);
    expect(analise.pendentesAgora).toBe(0);
  });

  test("sem resoluções a taxa é 0, nunca NaN", () => {
    const analise = calcularAnaliseOperacional([pedido()], AGORA);
    expect(analise.totalResolvidas).toBe(0);
    expect(analise.taxaAbandono).toBe(0);
  });

  test("registro com motivo desconhecido é ignorado em vez de quebrar a métrica", () => {
    const analise = calcularAnaliseOperacional(
      [pedido({ limpezaOperacional: { motivo: "motivo_de_outra_versao", acao: "avancou", resolvidoEm: new Date(AGORA).toISOString() } as never })],
      AGORA
    );
    expect(analise.totalResolvidas).toBe(0);
  });

  test("conta as pendências abertas no mesmo passe", () => {
    const analise = calcularAnaliseOperacional([pedido({ id: String(AGORA - 40 * MIN) })], AGORA);
    expect(analise.pendentesAgora).toBe(1);
  });
});

describe("sanitizarEntradaLimpeza — predicado de fronteira", () => {
  test("aceita motivo e ação conhecidos", () => {
    expect(sanitizarEntradaLimpeza({ motivo: "preparo_longo", acao: "avancou" })).toEqual({
      motivo: "preparo_longo",
      acao: "avancou",
    });
  });

  test("recusa valores fora do conjunto fechado", () => {
    expect(sanitizarEntradaLimpeza({ motivo: "qualquer_coisa", acao: "avancou" })).toBeNull();
    expect(sanitizarEntradaLimpeza({ motivo: "preparo_longo", acao: "apagou" })).toBeNull();
  });

  test("nunca lança para entrada de forma inesperada", () => {
    expect(sanitizarEntradaLimpeza(null)).toBeNull();
    expect(sanitizarEntradaLimpeza(undefined)).toBeNull();
    expect(sanitizarEntradaLimpeza("preparo_longo")).toBeNull();
    expect(sanitizarEntradaLimpeza(42)).toBeNull();
    expect(sanitizarEntradaLimpeza({})).toBeNull();
    expect(sanitizarEntradaLimpeza([])).toBeNull();
  });

  test("descarta campos extras — só motivo e ação atravessam a fronteira", () => {
    const r = sanitizarEntradaLimpeza({
      motivo: "novo_sem_aceite",
      acao: "cancelou",
      resolvidoPor: "invasor",
      resolvidoEm: "1970-01-01T00:00:00.000Z",
    });
    expect(r).toEqual({ motivo: "novo_sem_aceite", acao: "cancelou" });
  });
});
