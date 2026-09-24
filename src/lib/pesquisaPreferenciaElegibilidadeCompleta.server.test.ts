import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  redisGetMock,
  derivarClienteIdMock,
  listarContatosMock,
  optOutMock,
} = vi.hoisted(() => ({
  redisGetMock: vi.fn(),
  derivarClienteIdMock: vi.fn(),
  listarContatosMock: vi.fn(),
  optOutMock: vi.fn(),
}));

vi.mock("./redis", () => ({
  redis: { get: redisGetMock },
}));

vi.mock("./fidelidade", () => ({
  derivarClienteIdPorTelefone: derivarClienteIdMock,
}));

vi.mock("./pesquisaPreferenciaContatosRedis", () => ({
  listarContatosPesquisaPorTelefone: listarContatosMock,
}));

vi.mock("./pesquisaPreferenciaOptOutRedis", () => ({
  clienteTemOptOutPesquisa: optOutMock,
}));

import {
  CONTATOS_PESQUISA_PROSPECTIVOS_DESDE_MS,
  avaliarElegibilidadeContatoPesquisaCompleta,
  montarContatosBootstrapConservador,
} from "./pesquisaPreferenciaElegibilidadeCompleta.server";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 9, 20, 12, 0, 0);
const PHONE = "5599999999999";
const CLIENTE_ID = "cli_5599999999999";

function pedido(overrides: Record<string, unknown> = {}) {
  return {
    id: "pedido-1",
    telefone: PHONE,
    status: "entregue",
    statusAtualizadoEm: "2026-09-20T12:00:00.000Z",
    origem: "whatsapp",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  derivarClienteIdMock.mockImplementation((telefone?: string) =>
    telefone && telefone.replace(/\D/g, "").length >= 10
      ? CLIENTE_ID
      : undefined
  );
  listarContatosMock.mockResolvedValue([]);
  optOutMock.mockResolvedValue(false);
  redisGetMock.mockImplementation(async (key: string) => {
    if (key === "pedidos") return [pedido()];
    if (key.startsWith("session:")) return null;
    return null;
  });
});

describe("montarContatosBootstrapConservador", () => {
  test("pedido terminal sem ledger vira contato potencial sem gravar backfill", () => {
    const bootstrap = montarContatosBootstrapConservador({
      pedidos: [pedido()],
      clienteId: CLIENTE_ID,
      historicoPersistido: [],
      agoraMs: AGORA,
    });

    expect(bootstrap).toEqual([{ sentAtMs: AGORA - 20 * DIA }]);
  });

  test("não duplica pedido que já possui exposição pós-entrega confirmada", () => {
    const bootstrap = montarContatosBootstrapConservador({
      pedidos: [pedido()],
      clienteId: CLIENTE_ID,
      historicoPersistido: [
        {
          origem: "avaliacao_pos_entrega",
          eventId: "pedido-1",
          sentAtMs: AGORA - 20 * DIA,
        },
      ],
      agoraMs: AGORA,
    });

    expect(bootstrap).toEqual([]);
  });

  test("pedido legado sem carimbo envelhece a partir do início prospectivo", () => {
    const bootstrap = montarContatosBootstrapConservador({
      pedidos: [
        pedido({
          id: "legado",
          statusAtualizadoEm: undefined,
        }),
      ],
      clienteId: CLIENTE_ID,
      historicoPersistido: [],
      agoraMs: AGORA,
    });

    expect(bootstrap).toEqual([
      { sentAtMs: CONTATOS_PESQUISA_PROSPECTIVOS_DESDE_MS - 1 },
    ]);
  });
});

describe("avaliarElegibilidadeContatoPesquisaCompleta", () => {
  test("libera somente quando sinais reais e confirmações controladas estão completos", async () => {
    const resultado = await avaliarElegibilidadeContatoPesquisaCompleta({
      telefone: PHONE,
      agoraMs: AGORA,
      sinaisControlados: {
        checkoutWebEmAndamento: false,
        disputaOuEstornoExternoAberto: false,
      },
    });

    expect(resultado.elegibilidade.status).toBe("elegivel");
    expect(resultado.diagnostico).toMatchObject({
      fontesOperacionaisCompletas: true,
      identidadeConfirmada: true,
      checkoutWhatsappEmAndamento: false,
      checkoutWebSinalInformado: true,
      disputaExternaSinalInformado: true,
      contatosBootstrapConservador: 1,
    });
  });

  test("pedido pós-ledger sem exposição confirmada não inventa contato", async () => {
    redisGetMock.mockImplementation(async (key: string) => {
      if (key === "pedidos") {
        return [
          pedido({
            statusAtualizadoEm: new Date(AGORA - 2 * DIA).toISOString(),
          }),
        ];
      }
      return null;
    });

    const resultado = await avaliarElegibilidadeContatoPesquisaCompleta({
      telefone: PHONE,
      agoraMs: AGORA,
      sinaisControlados: {
        checkoutWebEmAndamento: false,
        disputaOuEstornoExternoAberto: false,
      },
    });

    expect(resultado.elegibilidade.status).toBe("elegivel");
    expect(resultado.elegibilidade.contatosUltimos14Dias).toBe(0);
    expect(resultado.diagnostico.contatosBootstrapConservador).toBe(0);
  });

  test("três pedidos terminais legados sem ledger fecham o teto de 3 em 90", async () => {
    redisGetMock.mockImplementation(async (key: string) => {
      if (key === "pedidos") {
        return [
          pedido({ id: "legacy-1", statusAtualizadoEm: undefined }),
          pedido({ id: "legacy-2", statusAtualizadoEm: undefined }),
          pedido({ id: "legacy-3", statusAtualizadoEm: undefined }),
        ];
      }
      return null;
    });

    const resultado = await avaliarElegibilidadeContatoPesquisaCompleta({
      telefone: PHONE,
      agoraMs: AGORA,
      sinaisControlados: {
        checkoutWebEmAndamento: false,
        disputaOuEstornoExternoAberto: false,
      },
    });

    expect(resultado.elegibilidade.status).toBe("suprimido");
    expect(resultado.elegibilidade.motivos).toContain(
      "limite_3_contatos_90_dias"
    );
  });

  test("pedido ativo, Pix pendente e problema operacional bloqueiam contato", async () => {
    redisGetMock.mockImplementation(async (key: string) => {
      if (key === "pedidos") {
        return [
          pedido({
            id: "ativo",
            status: "saiu_entrega",
            pagamento: "Pix",
            pix: { status: "pendente" },
            entregaProblema: { motivo: "cliente_ausente" },
          }),
        ];
      }
      return null;
    });

    const resultado = await avaliarElegibilidadeContatoPesquisaCompleta({
      telefone: PHONE,
      agoraMs: AGORA,
      sinaisControlados: {
        checkoutWebEmAndamento: false,
        disputaOuEstornoExternoAberto: false,
      },
    });

    expect(resultado.elegibilidade.status).toBe("suprimido");
    expect(resultado.elegibilidade.motivos).toEqual(
      expect.arrayContaining([
        "pagamento_pendente",
        "pedido_em_producao_ou_entrega",
        "problema_aberto",
      ])
    );
  });

  test("sessão ativa do bot é tratada como checkout/conversa em andamento", async () => {
    redisGetMock.mockImplementation(async (key: string) => {
      if (key === "pedidos") return [pedido()];
      if (key.startsWith("session:")) return { step: "payment" };
      return null;
    });

    const resultado = await avaliarElegibilidadeContatoPesquisaCompleta({
      telefone: PHONE,
      agoraMs: AGORA,
      sinaisControlados: {
        checkoutWebEmAndamento: false,
        disputaOuEstornoExternoAberto: false,
      },
    });

    expect(resultado.elegibilidade.motivos).toContain("checkout_em_andamento");
  });

  test("bot pausado ou atendimento manual bloqueiam o piloto", async () => {
    redisGetMock.mockImplementation(async (key: string) => {
      if (key === "pedidos") return [pedido()];
      if (key === "bot_ativo") return false;
      if (key.startsWith("manual:")) return true;
      return null;
    });

    const resultado = await avaliarElegibilidadeContatoPesquisaCompleta({
      telefone: PHONE,
      agoraMs: AGORA,
      sinaisControlados: {
        checkoutWebEmAndamento: false,
        disputaOuEstornoExternoAberto: false,
      },
    });

    expect(resultado.elegibilidade.status).toBe("suprimido");
    expect(resultado.elegibilidade.motivos).toContain(
      "atendimento_humano_ou_bot_pausado"
    );
    expect(resultado.diagnostico).toMatchObject({
      botAtivo: false,
      atendimentoManualAtivo: true,
    });
  });

  test("opt-out bloqueia contato", async () => {
    optOutMock.mockResolvedValue(true);

    const resultado = await avaliarElegibilidadeContatoPesquisaCompleta({
      telefone: PHONE,
      agoraMs: AGORA,
      sinaisControlados: {
        checkoutWebEmAndamento: false,
        disputaOuEstornoExternoAberto: false,
      },
    });

    expect(resultado.elegibilidade.motivos).toContain("opt_out");
  });

  test("telefone só digitado no checkout não vira identidade confirmada", async () => {
    redisGetMock.mockImplementation(async (key: string) => {
      if (key === "pedidos") {
        return [pedido({ origem: "site", whatsappVinculado: false })];
      }
      return null;
    });

    const resultado = await avaliarElegibilidadeContatoPesquisaCompleta({
      telefone: PHONE,
      agoraMs: AGORA,
      sinaisControlados: {
        checkoutWebEmAndamento: false,
        disputaOuEstornoExternoAberto: false,
      },
    });

    expect(resultado.elegibilidade.motivos).toContain("identidade_incerta");
  });

  test("omitir checkout web ou disputa externa mantém fail-closed", async () => {
    const resultado = await avaliarElegibilidadeContatoPesquisaCompleta({
      telefone: PHONE,
      agoraMs: AGORA,
      sinaisControlados: {
        checkoutWebEmAndamento: false,
      },
    });

    expect(resultado.elegibilidade.motivos).toContain(
      "fontes_operacionais_incompletas"
    );
    expect(resultado.diagnostico.fontesOperacionaisCompletas).toBe(false);
  });

  test("falha de leitura permanece fechada e explícita", async () => {
    redisGetMock.mockRejectedValue(new Error("redis down"));

    const resultado = await avaliarElegibilidadeContatoPesquisaCompleta({
      telefone: PHONE,
      agoraMs: AGORA,
      sinaisControlados: {
        checkoutWebEmAndamento: false,
        disputaOuEstornoExternoAberto: false,
      },
    });

    expect(resultado.elegibilidade.status).toBe("suprimido");
    expect(resultado.elegibilidade.motivos).toEqual(
      expect.arrayContaining([
        "fontes_operacionais_incompletas",
        "falha_tecnica",
        "identidade_incerta",
      ])
    );
  });
});
