import { beforeEach, describe, expect, test, vi } from "vitest";

const { listarContatosMock } = vi.hoisted(() => ({
  listarContatosMock: vi.fn(),
}));

vi.mock("./pesquisaPreferenciaContatosRedis", () => ({
  listarContatosPesquisaPorTelefone: listarContatosMock,
}));

import { avaliarElegibilidadeContatoPesquisaPorTelefone } from "./pesquisaPreferenciaElegibilidade.server";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 8, 24, 12, 0, 0);

beforeEach(() => {
  vi.clearAllMocks();
  listarContatosMock.mockResolvedValue([]);
});

describe("avaliarElegibilidadeContatoPesquisaPorTelefone", () => {
  test("conecta a pesquisa pós-entrega existente ao cooldown de 14 dias", async () => {
    listarContatosMock.mockResolvedValue([
      {
        origem: "avaliacao_pos_entrega",
        eventId: "pedido-1",
        sentAtMs: AGORA - 2 * DIA,
      },
    ]);

    const resultado = await avaliarElegibilidadeContatoPesquisaPorTelefone({
      telefone: "5599999999999",
      agoraMs: AGORA,
      contexto: { fontesOperacionaisCompletas: true },
    });

    expect(listarContatosMock).toHaveBeenCalledWith({
      telefone: "5599999999999",
      agoraMs: AGORA,
    });
    expect(resultado.status).toBe("suprimido");
    expect(resultado.contatosUltimos14Dias).toBe(1);
    expect(resultado.motivos).toContain("cooldown_14_dias");
  });

  test("contabiliza avaliação pós-entrega e Motor juntos no limite de 3 em 90 dias", async () => {
    listarContatosMock.mockResolvedValue([
      {
        origem: "avaliacao_pos_entrega",
        eventId: "pedido-1",
        sentAtMs: AGORA - 20 * DIA,
      },
      {
        origem: "motor_preferencia",
        eventId: "m1-1",
        sentAtMs: AGORA - 40 * DIA,
      },
      {
        origem: "avaliacao_pos_entrega",
        eventId: "pedido-2",
        sentAtMs: AGORA - 80 * DIA,
      },
    ]);

    const resultado = await avaliarElegibilidadeContatoPesquisaPorTelefone({
      telefone: "5599999999999",
      agoraMs: AGORA,
      contexto: { fontesOperacionaisCompletas: true },
    });

    expect(resultado.status).toBe("suprimido");
    expect(resultado.contatosUltimos14Dias).toBe(0);
    expect(resultado.contatosUltimos90Dias).toBe(3);
    expect(resultado.motivos).toContain("limite_3_contatos_90_dias");
  });

  test("mantém fail-closed enquanto os demais sinais operacionais não estiverem completos", async () => {
    listarContatosMock.mockResolvedValue([
      {
        origem: "avaliacao_pos_entrega",
        eventId: "pedido-1",
        sentAtMs: AGORA - 30 * DIA,
      },
    ]);

    const resultado = await avaliarElegibilidadeContatoPesquisaPorTelefone({
      telefone: "5599999999999",
      agoraMs: AGORA,
      contexto: { fontesOperacionaisCompletas: false },
    });

    expect(resultado.status).toBe("suprimido");
    expect(resultado.motivos).toContain("fontes_operacionais_incompletas");
  });

  test("não libera por ausência de histórico se houver outro gate operacional bloqueando", async () => {
    listarContatosMock.mockResolvedValue([]);

    const resultado = await avaliarElegibilidadeContatoPesquisaPorTelefone({
      telefone: "5599999999999",
      agoraMs: AGORA,
      contexto: {
        fontesOperacionaisCompletas: true,
        pagamentoPendente: true,
      },
    });

    expect(resultado.status).toBe("suprimido");
    expect(resultado.motivos).toContain("pagamento_pendente");
  });
});
