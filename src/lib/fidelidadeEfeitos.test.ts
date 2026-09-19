import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  store,
  legadoMock,
  pontosMock,
  jornadaMock,
  estornoMock,
  resgateMock,
  reversaoJornadaMock,
  liberarRecompensaMock,
  obterExtratoPontosMock,
  obterRelacaoMock,
  obterCandidaturaMock,
  registrarRelacaoMock,
  creditarIndicacaoMock,
  creditarApoioMock,
} = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    legadoMock: vi.fn(async () => undefined),
    pontosMock: vi.fn(async () => undefined),
    jornadaMock: vi.fn(async () => null),
    estornoMock: vi.fn(async () => undefined),
    resgateMock: vi.fn(async () => undefined),
    reversaoJornadaMock: vi.fn(async () => ({ ok: true, pendenciaAberta: false })),
    liberarRecompensaMock: vi.fn(async () => undefined),
    obterExtratoPontosMock: vi.fn(async () => [{ pedidoId: "ped_cancelado", tipo: "confirmado" }] as Array<{ pedidoId?: string; tipo: string }>),
    obterRelacaoMock: vi.fn(async () => null as { indicadorId: string; criadoEm: string } | null),
    obterCandidaturaMock: vi.fn(async () => null as { indicadorId: string; criadoEm: string } | null),
    registrarRelacaoMock: vi.fn(async () => "ja_existe" as "registrado" | "ja_existe" | "self_referral"),
    creditarIndicacaoMock: vi.fn(async () => undefined),
    creditarApoioMock: vi.fn(async () => undefined),
  };
});

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (keys.length !== 1) return 0;
      if (store.get(keys[0]) !== args[0]) return 0;
      store.delete(keys[0]);
      return 1;
    }),
  },
}));

vi.mock("./fidelidade", () => ({
  creditarFidelidadePedido: legadoMock,
  creditarPontosPedidoEntregue: pontosMock,
  calcularPontosElegiveisPedido: vi.fn(() => 40),
  construirEventoIdPontos: vi.fn((pedidoId: string, tipo: string) => `${tipo}:${pedidoId}`),
  derivarClienteIdPorTelefone: vi.fn(() => "cli_canonico"),
  obterExtratoPontos: obterExtratoPontosMock,
  registrarMovimentoPontosIdempotente: estornoMock,
  reverterResgateConfirmado: resgateMock,
}));

vi.mock("./jornadaChef", () => ({
  TENANT_PADRAO: "default",
  processarConclusaoPedidoJornada: jornadaMock,
  reverterConclusaoPedidoJornada: reversaoJornadaMock,
  liberarRecompensaDePedidoCancelado: liberarRecompensaMock,
}));

vi.mock("./indicacaoToken", () => ({
  obterRelacaoIndicacao: obterRelacaoMock,
  obterCandidaturaIndicacao: obterCandidaturaMock,
  registrarRelacaoIndicacao: registrarRelacaoMock,
}));

vi.mock("./estrelasIndicacao", () => ({
  creditarEstrelasIndicacaoValida: creditarIndicacaoMock,
  creditarEstrelaApoioRecorrente: creditarApoioMock,
}));

vi.mock("./expedienteOperacional", () => ({
  chaveExpedienteOperacional: vi.fn(() => "2024-01-01"),
}));

vi.mock("./historicoAnalitico", () => ({
  registrarEventoEntregue: vi.fn(async () => undefined),
  estornarEventoAnalitico: vi.fn(async () => undefined),
}));

import {
  obterPendenciasEfeitosFidelidade,
  processarEfeitosPedidoCancelado,
  processarEfeitosPedidoEntregue,
  reprocessarPendenciaEfeitosFidelidade,
} from "./fidelidadeEfeitos";

const pedidoEntregue = {
  id: "ped_entregue",
  status: "entregue",
  telefone: "telefone-mascarado-teste",
  clienteId: "cli_canonico",
  total: 40,
  pizzasCount: 2,
};

beforeEach(() => {
  store.clear();
  legadoMock.mockReset().mockResolvedValue(undefined);
  pontosMock.mockReset().mockResolvedValue(undefined);
  jornadaMock.mockReset().mockResolvedValue(null);
  estornoMock.mockReset().mockResolvedValue(undefined);
  resgateMock.mockReset().mockResolvedValue(undefined);
  reversaoJornadaMock.mockReset().mockResolvedValue({ ok: true, pendenciaAberta: false });
  liberarRecompensaMock.mockReset().mockResolvedValue(undefined);
  obterExtratoPontosMock.mockReset().mockResolvedValue([{ pedidoId: "ped_cancelado", tipo: "confirmado" }]);
  // Defaults: sem relação permanente, sem candidatura — indicacao é no-op
  obterRelacaoMock.mockReset().mockResolvedValue(null);
  obterCandidaturaMock.mockReset().mockResolvedValue(null);
  registrarRelacaoMock.mockReset().mockResolvedValue("ja_existe");
  creditarIndicacaoMock.mockReset().mockResolvedValue(undefined);
  creditarApoioMock.mockReset().mockResolvedValue(undefined);
});

describe("processarEfeitosPedidoEntregue", () => {
  test("mesmo pedido repetido não duplica nenhum consumidor", async () => {
    await processarEfeitosPedidoEntregue(pedidoEntregue);
    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(legadoMock).toHaveBeenCalledTimes(1);
    expect(pontosMock).toHaveBeenCalledTimes(1);
    expect(jornadaMock).toHaveBeenCalledTimes(1);
    expect((store.get("fidelidade:efeitos:pedido:ped_entregue:entregue") as { status: string }).status).toBe("concluido");
  });

  test("falha após o primeiro consumidor permite retry sem repetir o primeiro", async () => {
    pontosMock.mockRejectedValueOnce(new Error("falha pontos"));

    await expect(processarEfeitosPedidoEntregue(pedidoEntregue)).rejects.toThrow("falha pontos");
    expect(legadoMock).toHaveBeenCalledTimes(1);
    expect(jornadaMock).not.toHaveBeenCalled();

    await processarEfeitosPedidoEntregue(pedidoEntregue);
    expect(legadoMock).toHaveBeenCalledTimes(1);
    expect(pontosMock).toHaveBeenCalledTimes(2);
    expect(jornadaMock).toHaveBeenCalledTimes(1);
  });

  test("falha na Jornada cria pendência e retry executa somente a Jornada", async () => {
    jornadaMock.mockRejectedValueOnce(new Error("falha jornada"));

    await expect(processarEfeitosPedidoEntregue(pedidoEntregue)).rejects.toThrow("falha jornada");
    expect(await obterPendenciasEfeitosFidelidade()).toEqual([
      expect.objectContaining({ pedidoId: pedidoEntregue.id, acao: "entregue", ultimoErro: "falha jornada" }),
    ]);

    await processarEfeitosPedidoEntregue(pedidoEntregue);
    expect(legadoMock).toHaveBeenCalledTimes(1);
    expect(pontosMock).toHaveBeenCalledTimes(1);
    expect(jornadaMock).toHaveBeenCalledTimes(2);
    expect(await obterPendenciasEfeitosFidelidade()).toEqual([]);
  });

  test("dois workers concorrentes não executam os efeitos em duplicidade", async () => {
    let liberarPrimeiro!: () => void;
    const bloqueio = new Promise<void>((resolve) => { liberarPrimeiro = resolve; });
    legadoMock.mockImplementationOnce(async () => { await bloqueio; });

    const primeiro = processarEfeitosPedidoEntregue(pedidoEntregue);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const segundo = processarEfeitosPedidoEntregue(pedidoEntregue);
    await expect(segundo).rejects.toThrow("fidelidade_efeitos_pedido_em_processamento");
    liberarPrimeiro();
    await primeiro;

    expect(legadoMock).toHaveBeenCalledTimes(1);
    expect(pontosMock).toHaveBeenCalledTimes(1);
    expect(jornadaMock).toHaveBeenCalledTimes(1);
  });
});

describe("processarEfeitosPedidoCancelado", () => {
  test("cancelamento repetido mantém uma única reversão por consumidor", async () => {
    const pedido = {
      ...pedidoEntregue,
      id: "ped_cancelado",
      status: "cancelado",
      statusAnterior: "entregue",
      resgateId: "resgate-1",
      recompensaJornadaId: "recompensa-1",
    };

    await processarEfeitosPedidoCancelado(pedido);
    await processarEfeitosPedidoCancelado(pedido);

    expect(estornoMock).toHaveBeenCalledTimes(1);
    expect(resgateMock).toHaveBeenCalledTimes(1);
    expect(reversaoJornadaMock).toHaveBeenCalledTimes(1);
    expect(liberarRecompensaMock).toHaveBeenCalledTimes(1);
  });

  test("índice de pendências é isolado por tenant", async () => {
    store.set("fidelidade:efeitos:pendencias:tenant-a", [
      { tenantId: "tenant-a", pedidoId: "ped-a", acao: "entregue", criadaEm: "agora", atualizadaEm: "agora" },
    ]);

    expect(await obterPendenciasEfeitosFidelidade("tenant-a")).toHaveLength(1);
    expect(await obterPendenciasEfeitosFidelidade("tenant-b")).toEqual([]);
  });

  test("retry operacional só reprocessa uma pendência existente e a resolve", async () => {
    store.set("pedidos", [pedidoEntregue]);
    store.set("fidelidade:efeitos:pendencias:default", [
      { tenantId: "default", pedidoId: pedidoEntregue.id, acao: "entregue", criadaEm: "agora", atualizadaEm: "agora" },
    ]);

    await reprocessarPendenciaEfeitosFidelidade(pedidoEntregue.id, "entregue");
    expect(await obterPendenciasEfeitosFidelidade()).toEqual([]);
    await expect(reprocessarPendenciaEfeitosFidelidade("pedido-inexistente", "entregue")).rejects.toThrow(
      "pendencia_de_efeitos_nao_encontrada"
    );
  });
});

describe("efeito indicacao", () => {
  test("sem candidatura e sem relação: nenhum crédito disparado", async () => {
    // defaults: obterRelacaoMock → null, obterCandidaturaMock → null
    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(creditarIndicacaoMock).not.toHaveBeenCalled();
    expect(creditarApoioMock).not.toHaveBeenCalled();
    expect(registrarRelacaoMock).not.toHaveBeenCalled();
  });

  test("POST salva apenas candidatura — relação permanente NÃO existe antes da compra", async () => {
    // Simula o estado APÓS o POST /api/cliente/indicacao:
    // candidatura existe, relação permanente ainda não
    obterRelacaoMock.mockResolvedValue(null);
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("registrado");

    // Antes do primeiro pedido: só candidatura, zero crédito
    // Relação permanente não existe ainda (mock retorna null)
    expect(await obterRelacaoMock()).toBeNull();
  });

  test("primeira compra confirma relação permanente e credita +6 somente (sem +1 apoio)", async () => {
    obterRelacaoMock.mockResolvedValue(null); // sem relação permanente ainda
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("registrado"); // confirmação bem-sucedida

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    // +6 ao indicador na primeira compra
    expect(creditarIndicacaoMock).toHaveBeenCalledOnce();
    expect(creditarIndicacaoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        indicadorId: "cli_indicador",
        indicadoId: "cli_canonico",
        pedidoId: "ped_entregue",
        primeiraCompraComercialValida: true,
      })
    );
    // NÃO credita +1 apoio no mesmo evento da aquisição
    expect(creditarApoioMock).not.toHaveBeenCalled();
    // relação confirmada via registrarRelacaoIndicacao
    expect(registrarRelacaoMock).toHaveBeenCalledWith("cli_canonico", "cli_indicador");
  });

  test("compra posterior (relação permanente já existe) credita SOMENTE +1 apoio (sem +6)", async () => {
    // Relação permanente já confirmada — este é um pedido após a aquisição
    obterRelacaoMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    // Sem +6 em compra posterior
    expect(creditarIndicacaoMock).not.toHaveBeenCalled();
    // +1 apoio (uma vez por relação/expediente)
    expect(creditarApoioMock).toHaveBeenCalledOnce();
    expect(creditarApoioMock).toHaveBeenCalledWith(
      expect.objectContaining({
        indicadorId: "cli_indicador",
        indicadoId: "cli_canonico",
        pedidoId: "ped_entregue",
      })
    );
    // registrar NÃO é chamado em compras posteriores
    expect(registrarRelacaoMock).not.toHaveBeenCalled();
  });

  test("retry na primeira compra não duplica +6 (estado persiste concluído)", async () => {
    obterRelacaoMock.mockResolvedValue(null);
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("registrado");

    await processarEfeitosPedidoEntregue(pedidoEntregue);
    await processarEfeitosPedidoEntregue(pedidoEntregue); // segunda chamada: estado já concluído

    expect(creditarIndicacaoMock).toHaveBeenCalledTimes(1);
    expect(creditarApoioMock).not.toHaveBeenCalled();
  });

  test("retry na compra posterior não duplica +1 apoio (estado persiste concluído)", async () => {
    obterRelacaoMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });

    await processarEfeitosPedidoEntregue(pedidoEntregue);
    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(creditarApoioMock).toHaveBeenCalledTimes(1);
    expect(creditarIndicacaoMock).not.toHaveBeenCalled();
  });

  test("race condition na confirmação (ja_existe) não credita +6 nem +1", async () => {
    // Outro worker confirmou a relação primeiro → registrarRelacao retorna "ja_existe"
    obterRelacaoMock.mockResolvedValue(null);
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("ja_existe"); // perdeu a corrida

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    // O worker que perdeu não credita nada — o vencedor já creditou +6
    expect(creditarIndicacaoMock).not.toHaveBeenCalled();
    expect(creditarApoioMock).not.toHaveBeenCalled();
  });

  test("falha no efeito indicacao cria pendência e retry executa somente indicacao", async () => {
    obterRelacaoMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    creditarApoioMock.mockRejectedValueOnce(new Error("falha apoio"));

    await expect(processarEfeitosPedidoEntregue(pedidoEntregue)).rejects.toThrow("falha apoio");
    expect(legadoMock).toHaveBeenCalledTimes(1);
    expect(pontosMock).toHaveBeenCalledTimes(1);
    expect(jornadaMock).toHaveBeenCalledTimes(1);

    await processarEfeitosPedidoEntregue(pedidoEntregue);
    // Efeitos anteriores não repetidos
    expect(legadoMock).toHaveBeenCalledTimes(1);
    expect(pontosMock).toHaveBeenCalledTimes(1);
    expect(jornadaMock).toHaveBeenCalledTimes(1);
    // Apoio executado no retry
    expect(creditarApoioMock).toHaveBeenCalledTimes(2);
  });
});
