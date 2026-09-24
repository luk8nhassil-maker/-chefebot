import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockZadd,
  mockZrange,
  mockZscore,
  mockZremrangebyscore,
  mockExpire,
  mockDerivarClienteId,
} = vi.hoisted(() => ({
  mockZadd: vi.fn(),
  mockZrange: vi.fn(),
  mockZscore: vi.fn(),
  mockZremrangebyscore: vi.fn(),
  mockExpire: vi.fn(),
  mockDerivarClienteId: vi.fn(),
}));

vi.mock("./redis", () => ({
  redis: {
    zadd: mockZadd,
    zrange: mockZrange,
    zscore: mockZscore,
    zremrangebyscore: mockZremrangebyscore,
    expire: mockExpire,
  },
}));

vi.mock("./fidelidade", () => ({
  derivarClienteIdPorTelefone: mockDerivarClienteId,
}));

import {
  derivarResearchCustomerKey,
  listarContatosPesquisaPorTelefone,
  registrarContatoPesquisaConfirmado,
} from "./pesquisaPreferenciaContatosRedis";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 8, 24, 12, 0, 0);

beforeEach(() => {
  vi.clearAllMocks();
  mockDerivarClienteId.mockReturnValue("cli_5599999999999");
  mockZadd.mockResolvedValue(1);
  mockZrange.mockResolvedValue([]);
  mockZscore.mockResolvedValue(null);
  mockZremrangebyscore.mockResolvedValue(0);
  mockExpire.mockResolvedValue(1);
});

describe("derivarResearchCustomerKey", () => {
  test("não persiste telefone bruto na chave derivada", () => {
    const key = derivarResearchCustomerKey("5599999999999");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("5599999999999");
    expect(key).not.toContain("cli_");
  });

  test("identidade inválida não gera chave", () => {
    mockDerivarClienteId.mockReturnValue(null);
    expect(derivarResearchCustomerKey("123")).toBeNull();
  });
});

describe("registrarContatoPesquisaConfirmado", () => {
  test("grava contato idempotente em zset e mantém só a janela de 90 dias", async () => {
    const ok = await registrarContatoPesquisaConfirmado({
      telefone: "5599999999999",
      origem: "avaliacao_pos_entrega",
      eventId: "pedido-123",
      sentAtMs: AGORA,
    });

    expect(ok).toBe(true);
    const [key, entry] = mockZadd.mock.calls[0];
    expect(key).toMatch(/^pesquisa:contatos:v1:[a-f0-9]{64}$/);
    expect(key).not.toContain("5599999999999");
    expect(entry).toEqual({
      score: AGORA,
      member: "avaliacao_pos_entrega:pedido-123",
    });
    expect(mockZremrangebyscore).toHaveBeenCalledWith(
      key,
      "-inf",
      AGORA - 90 * DIA
    );
    expect(mockExpire).toHaveBeenCalledWith(key, 90 * 24 * 60 * 60);
  });

  test("não grava sem identidade ou eventId válido", async () => {
    mockDerivarClienteId.mockReturnValue(null);
    expect(
      await registrarContatoPesquisaConfirmado({
        telefone: "123",
        origem: "avaliacao_pos_entrega",
        eventId: "pedido",
        sentAtMs: AGORA,
      })
    ).toBe(false);
    expect(mockZadd).not.toHaveBeenCalled();
  });
});

describe("listarContatosPesquisaPorTelefone", () => {
  test("retorna apenas contatos válidos dentro da janela", async () => {
    mockZrange.mockResolvedValue([
      "avaliacao_pos_entrega:pedido-1",
      "motor_preferencia:exp-2",
      "origem_invalida:x",
    ]);
    mockZscore
      .mockResolvedValueOnce(AGORA - 2 * DIA)
      .mockResolvedValueOnce(AGORA - 20 * DIA)
      .mockResolvedValueOnce(AGORA - DIA);

    const contatos = await listarContatosPesquisaPorTelefone({
      telefone: "5599999999999",
      agoraMs: AGORA,
    });

    expect(contatos).toEqual([
      {
        origem: "motor_preferencia",
        eventId: "exp-2",
        sentAtMs: AGORA - 20 * DIA,
      },
      {
        origem: "avaliacao_pos_entrega",
        eventId: "pedido-1",
        sentAtMs: AGORA - 2 * DIA,
      },
    ]);
  });
});
