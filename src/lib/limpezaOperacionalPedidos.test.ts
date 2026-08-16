import { describe, expect, test } from "vitest";
import {
  LIMIAR_ENTREGA_MIN,
  LIMIAR_NOVO_SEM_ACEITE_MIN,
  LIMIAR_PIX_PENDENTE_MIN,
  LIMIAR_PREPARO_MIN,
  LIMIAR_REAVISO_PREPARO_MIN,
  acaoPrincipal,
  acaoSecundaria,
  acaoTerciaria,
  calcularAnaliseOperacional,
  classificarPendencia,
  idadeDaEtapaMinutos,
  listarPendencias,
  registrarResolucao,
  sanitizarEntradaLimpeza,
  timestampDaEtapa,
  timestampDeHoraLocal,
  timestampPedido,
  type PedidoLimpeza,
} from "./limpezaOperacionalPedidos";

// 2026-07-30T20:00:00Z = 17:00 em America/Sao_Paulo.
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

describe("reconstrução de tempo", () => {
  test("reconstrói HH:MM no fuso da pizzaria", () => {
    expect(timestampDeHoraLocal("16:30", AGORA)).toBe(Date.parse("2026-07-30T19:30:00.000Z"));
  });

  test("23:50 consultado depois da meia-noite pertence ao dia anterior", () => {
    const meiaNoiteEDez = Date.parse("2026-07-31T03:10:00.000Z");
    expect(timestampDeHoraLocal("23:50", meiaNoiteEDez)).toBe(Date.parse("2026-07-31T02:50:00.000Z"));
  });

  test("formato inválido nunca lança", () => {
    expect(timestampDeHoraLocal("abc", AGORA)).toBeNull();
    expect(timestampDeHoraLocal("99:99", AGORA)).toBeNull();
    expect(timestampDeHoraLocal(undefined, AGORA)).toBeNull();
  });

  test("usa os 13 primeiros dígitos do ID quando houve desempate de colisão", () => {
    const ts = AGORA - 30 * MIN;
    expect(timestampPedido(pedido({ id: `${ts}7` }), AGORA)).toBe(ts);
  });

  test("cai para Pix e depois para horário legado", () => {
    expect(
      timestampPedido(
        pedido({ id: "ped_abc", pix: { criadoEm: "2026-07-30T19:00:00.000Z" } }),
        AGORA
      )
    ).toBe(Date.parse("2026-07-30T19:00:00.000Z"));
    expect(timestampPedido(pedido({ id: "ped_abc", horario: "16:00" }), AGORA)).toBe(
      Date.parse("2026-07-30T19:00:00.000Z")
    );
  });
});

describe("idade da etapa", () => {
  test("status não-novo mede desde statusAtualizadoEm", () => {
    const p = pedido({
      id: String(AGORA - 300 * MIN),
      status: "em_preparo",
      statusAtualizadoEm: new Date(AGORA - 4 * MIN).toISOString(),
    });
    expect(idadeDaEtapaMinutos(p, AGORA)).toBe(4);
  });

  test("em preparo legado cai para horarioInicio", () => {
    const p = pedido({ id: "ped_legado", status: "em_preparo", horarioInicio: "16:30" });
    expect(timestampDaEtapa(p, AGORA)).toBe(Date.parse("2026-07-30T19:30:00.000Z"));
  });

  test("novo normal ignora statusAtualizadoEm e mede desde a criação", () => {
    const p = pedido({
      id: String(AGORA - 20 * MIN),
      statusAtualizadoEm: new Date(AGORA - 1 * MIN).toISOString(),
    });
    expect(idadeDaEtapaMinutos(p, AGORA)).toBe(20);
  });

  test("novo adiado reinicia o relógio no mesmo status", () => {
    const p = pedido({
      id: String(AGORA - 80 * MIN),
      statusAtualizadoEm: new Date(AGORA - 6 * MIN).toISOString(),
      limpezaOperacional: {
        motivo: "novo_sem_aceite",
        acao: "adiou",
        resolvidoEm: new Date(AGORA - 6 * MIN).toISOString(),
      },
    });
    expect(idadeDaEtapaMinutos(p, AGORA)).toBe(6);
  });

  test("idade indeterminada é zero e carimbo futuro não vira negativo", () => {
    expect(idadeDaEtapaMinutos(pedido({ id: "ped_abc" }), AGORA)).toBe(0);
    expect(idadeDaEtapaMinutos(pedido({ id: String(AGORA + 10 * MIN) }), AGORA)).toBe(0);
  });
});

describe("classificarPendencia", () => {
  test("arquivado e terminal nunca geram modal", () => {
    expect(classificarPendencia(pedido({ id: String(AGORA - 600 * MIN), isArchived: true }), AGORA)).toBeNull();
    expect(classificarPendencia(pedido({ id: String(AGORA - 600 * MIN), status: "entregue" }), AGORA)).toBeNull();
    expect(classificarPendencia(pedido({ id: String(AGORA - 600 * MIN), status: "cancelado" }), AGORA)).toBeNull();
  });

  test("novo só cobra depois do primeiro prazo", () => {
    const antes = pedido({ id: String(AGORA - (LIMIAR_NOVO_SEM_ACEITE_MIN - 1) * MIN) });
    const depois = pedido({ id: String(AGORA - LIMIAR_NOVO_SEM_ACEITE_MIN * MIN) });
    expect(classificarPendencia(antes, AGORA)).toBeNull();
    expect(classificarPendencia(depois, AGORA)?.motivo).toBe("novo_sem_aceite");
  });

  test("aguardar no NOVO dá outro ciclo completo do mesmo tamanho", () => {
    const p = pedido({
      id: String(AGORA - 90 * MIN),
      statusAtualizadoEm: new Date(AGORA - (LIMIAR_NOVO_SEM_ACEITE_MIN - 1) * MIN).toISOString(),
      limpezaOperacional: {
        motivo: "novo_sem_aceite",
        acao: "adiou",
        resolvidoEm: new Date(AGORA - (LIMIAR_NOVO_SEM_ACEITE_MIN - 1) * MIN).toISOString(),
      },
    });
    expect(classificarPendencia(p, AGORA)).toBeNull();
    expect(
      classificarPendencia(
        {
          ...p,
          statusAtualizadoEm: new Date(AGORA - LIMIAR_NOVO_SEM_ACEITE_MIN * MIN).toISOString(),
          limpezaOperacional: {
            motivo: "novo_sem_aceite",
            acao: "adiou",
            resolvidoEm: new Date(AGORA - LIMIAR_NOVO_SEM_ACEITE_MIN * MIN).toISOString(),
          },
        },
        AGORA
      )?.motivo
    ).toBe("novo_sem_aceite");
  });

  test("Pix pendente preserva a trava financeira e não libera cozinha aos 15 min", () => {
    const p15 = pedido({ id: String(AGORA - LIMIAR_NOVO_SEM_ACEITE_MIN * MIN), pagamento: "Pix" });
    const p20 = pedido({ id: String(AGORA - LIMIAR_PIX_PENDENTE_MIN * MIN), pagamento: "Pix" });
    expect(classificarPendencia(p15, AGORA)).toBeNull();
    expect(classificarPendencia(p20, AGORA)?.motivo).toBe("pagamento_pix_pendente");
  });

  test("Pix confirmado volta ao fluxo normal de aceite", () => {
    const p = pedido({
      id: String(AGORA - LIMIAR_PIX_PENDENTE_MIN * MIN),
      pagamento: "Pix",
      pixConfirmado: true,
    });
    expect(classificarPendencia(p, AGORA)?.motivo).toBe("novo_sem_aceite");
  });

  test("pagamento misto é protegido como Pix", () => {
    const p = pedido({
      id: String(AGORA - LIMIAR_PIX_PENDENTE_MIN * MIN),
      pagamento: "Pix (R$ 30,00) + Dinheiro (R$ 20,00)",
    });
    expect(classificarPendencia(p, AGORA)?.motivo).toBe("pagamento_pix_pendente");
  });

  test("cozinha alerta no limite previsto e, após confirmar atraso, volta em 5 min", () => {
    const inicial = pedido({
      status: "em_preparo",
      statusAtualizadoEm: new Date(AGORA - LIMIAR_PREPARO_MIN * MIN).toISOString(),
    });
    expect(classificarPendencia(inicial, AGORA)?.motivo).toBe("preparo_longo");

    const adiado4 = pedido({
      status: "em_preparo",
      statusAtualizadoEm: new Date(AGORA - (LIMIAR_REAVISO_PREPARO_MIN - 1) * MIN).toISOString(),
      limpezaOperacional: {
        motivo: "preparo_longo",
        acao: "adiou",
        resolvidoEm: new Date(AGORA - (LIMIAR_REAVISO_PREPARO_MIN - 1) * MIN).toISOString(),
      },
    });
    expect(classificarPendencia(adiado4, AGORA)).toBeNull();

    const adiado5 = {
      ...adiado4,
      statusAtualizadoEm: new Date(AGORA - LIMIAR_REAVISO_PREPARO_MIN * MIN).toISOString(),
      limpezaOperacional: {
        motivo: "preparo_longo" as const,
        acao: "adiou" as const,
        resolvidoEm: new Date(AGORA - LIMIAR_REAVISO_PREPARO_MIN * MIN).toISOString(),
      },
    };
    expect(classificarPendencia(adiado5, AGORA)?.motivo).toBe("preparo_longo");
  });

  test("na rua alerta no limite existente e aguardar reinicia o mesmo limite", () => {
    const inicial = pedido({
      status: "saiu_entrega",
      statusAtualizadoEm: new Date(AGORA - LIMIAR_ENTREGA_MIN * MIN).toISOString(),
    });
    expect(classificarPendencia(inicial, AGORA)?.motivo).toBe("entrega_longa");

    const adiado = pedido({
      status: "saiu_entrega",
      statusAtualizadoEm: new Date(AGORA - 10 * MIN).toISOString(),
      limpezaOperacional: {
        motivo: "entrega_longa",
        acao: "adiou",
        resolvidoEm: new Date(AGORA - 10 * MIN).toISOString(),
      },
    });
    expect(classificarPendencia(adiado, AGORA)).toBeNull();
  });

  test("decisão de etapa anterior não silencia a próxima etapa", () => {
    const p = pedido({
      status: "em_preparo",
      statusAtualizadoEm: new Date(AGORA - LIMIAR_PREPARO_MIN * MIN).toISOString(),
      limpezaOperacional: {
        motivo: "novo_sem_aceite",
        acao: "avancou",
        resolvidoEm: new Date(AGORA - LIMIAR_PREPARO_MIN * MIN).toISOString(),
      },
    });
    expect(classificarPendencia(p, AGORA)?.motivo).toBe("preparo_longo");
  });

  test("status desconhecido e pedido sem id falham fechado", () => {
    expect(classificarPendencia(pedido({ id: String(AGORA - 600 * MIN), status: "outro" }), AGORA)).toBeNull();
    expect(classificarPendencia({ status: "novo" }, AGORA)).toBeNull();
  });
});

describe("fila de pendências", () => {
  test("prioriza Pix, rua, cozinha e novo; desempata pelo mais antigo", () => {
    const pendentes = listarPendencias(
      [
        pedido({ id: String(AGORA - 20 * MIN), numero: 1 }),
        pedido({
          id: String(AGORA - 90 * MIN),
          numero: 2,
          status: "em_preparo",
          statusAtualizadoEm: new Date(AGORA - 90 * MIN).toISOString(),
        }),
        pedido({ id: String(AGORA - 40 * MIN), numero: 3, pagamento: "Pix" }),
        pedido({
          id: String(AGORA - 80 * MIN),
          numero: 4,
          status: "saiu_entrega",
          statusAtualizadoEm: new Date(AGORA - 80 * MIN).toISOString(),
        }),
        pedido({ id: String(AGORA - 200 * MIN), numero: 5 }),
      ],
      AGORA
    );
    expect(pendentes.map((p) => p.numero)).toEqual([3, 4, 2, 5, 1]);
  });
});

describe("ações e hierarquia", () => {
  test("NOVO destaca começar, depois aguardar, e deixa cancelar como terceira ação", () => {
    const p = classificarPendencia(
      pedido({ id: String(AGORA - LIMIAR_NOVO_SEM_ACEITE_MIN * MIN) }),
      AGORA
    )!;
    expect(acaoPrincipal(p)).toMatchObject({ label: "COMEÇAR A FAZER", acao: "avancou", status: "em_preparo", tom: "principal" });
    expect(acaoSecundaria(p)).toMatchObject({ acao: "adiou", status: "novo", tom: "secundario" });
    expect(acaoTerciaria(p)).toMatchObject({ acao: "cancelou", status: "cancelado", tom: "perigo" });
  });

  test("cozinha delivery: avançar é principal e continuar fazendo é secundário", () => {
    const p = classificarPendencia(
      pedido({
        status: "em_preparo",
        tipoEntrega: "delivery",
        statusAtualizadoEm: new Date(AGORA - LIMIAR_PREPARO_MIN * MIN).toISOString(),
      }),
      AGORA
    )!;
    expect(acaoPrincipal(p)).toMatchObject({ label: "SAIU PARA ENTREGA", status: "saiu_entrega", tom: "principal" });
    expect(acaoSecundaria(p)).toMatchObject({ acao: "adiou", status: "em_preparo", tom: "secundario" });
    expect(acaoTerciaria(p)).toBeNull();
  });

  test("cozinha respeita retirada e salão", () => {
    const retirada = classificarPendencia(
      pedido({
        status: "em_preparo",
        tipoEntrega: "retirada",
        statusAtualizadoEm: new Date(AGORA - LIMIAR_PREPARO_MIN * MIN).toISOString(),
      }),
      AGORA
    )!;
    expect(acaoPrincipal(retirada)).toMatchObject({ label: "PRONTO PARA RETIRADA", status: "saiu_entrega" });

    const salao = classificarPendencia(
      pedido({
        status: "em_preparo",
        tipoEntrega: "dine_in",
        statusAtualizadoEm: new Date(AGORA - LIMIAR_PREPARO_MIN * MIN).toISOString(),
      }),
      AGORA
    )!;
    expect(acaoPrincipal(salao)).toMatchObject({ label: "PEDIDO PRONTO", status: "entregue" });
  });

  test("NA RUA oferece confirmar entrega e ainda está na rua", () => {
    const p = classificarPendencia(
      pedido({
        status: "saiu_entrega",
        tipoEntrega: "delivery",
        statusAtualizadoEm: new Date(AGORA - LIMIAR_ENTREGA_MIN * MIN).toISOString(),
      }),
      AGORA
    )!;
    expect(acaoPrincipal(p)).toMatchObject({ label: "CONFIRMAR ENTREGA", status: "entregue", tom: "principal" });
    expect(acaoSecundaria(p)).toMatchObject({ label: "AINDA ESTÁ NA RUA", acao: "adiou", status: "saiu_entrega" });
  });

  test("Pix exige verificação antes de qualquer avanço", () => {
    const p = classificarPendencia(
      pedido({ id: String(AGORA - LIMIAR_PIX_PENDENTE_MIN * MIN), pagamento: "Pix" }),
      AGORA
    )!;
    expect(acaoPrincipal(p)).toMatchObject({ acao: "verificou_pagamento", tom: "principal" });
    expect(acaoPrincipal(p)).not.toHaveProperty("status");
    expect(acaoSecundaria(p)).toMatchObject({ acao: "adiou", status: "novo" });
    expect(acaoTerciaria(p)).toMatchObject({ acao: "cancelou", status: "cancelado" });
  });
});

describe("fronteira e métricas", () => {
  test("sanitiza adiamento e rejeita ação desconhecida", () => {
    expect(sanitizarEntradaLimpeza({ motivo: "preparo_longo", acao: "adiou" })).toEqual({
      motivo: "preparo_longo",
      acao: "adiou",
    });
    expect(sanitizarEntradaLimpeza({ motivo: "preparo_longo", acao: "inventada" })).toBeNull();
  });

  test("registrarResolucao mantém autoria quando informada", () => {
    expect(registrarResolucao("novo_sem_aceite", "avancou", AGORA, "Kellyne")).toEqual({
      motivo: "novo_sem_aceite",
      acao: "avancou",
      resolvidoEm: new Date(AGORA).toISOString(),
      resolvidoPor: "Kellyne",
    });
  });

  test("adiamento não conta como pendência resolvida", () => {
    const analise = calcularAnaliseOperacional(
      [
        pedido({
          id: "a",
          status: "em_preparo",
          limpezaOperacional: {
            motivo: "preparo_longo",
            acao: "adiou",
            resolvidoEm: new Date(AGORA).toISOString(),
          },
        }),
        pedido({
          id: "b",
          status: "entregue",
          limpezaOperacional: {
            motivo: "entrega_longa",
            acao: "avancou",
            resolvidoEm: new Date(AGORA).toISOString(),
          },
        }),
      ],
      AGORA
    );
    expect(analise.totalResolvidas).toBe(1);
    expect(analise.resolvidasHoje).toBe(1);
    expect(analise.porMotivo.entrega_longa).toBe(1);
    expect(analise.porMotivo.preparo_longo).toBe(0);
  });
});
