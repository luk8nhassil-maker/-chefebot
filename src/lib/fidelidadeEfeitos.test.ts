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
  obterTemporadaAtivaMock,
  consumirMissaoSemanalMock,
  reverterMissaoSemanalMock,
  concluirMissaoIndicacaoMock,
  reverterMissaoIndicacaoMock,
  registrarConversaoIndicacaoMock,
  obterConversaoIndicacaoMock,
  estornarEstrelasIndicacaoMock,
  marcarConversaoAtivaMock,
  obterConversaoAtivaMock,
  revogarConversaoAtivaMock,
  estornarApoioMock,
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
    obterExtratoPontosMock: vi.fn(async () => [{ pedidoId: "ped_cancelado", tipo: "confirmado" }] as Array<{ pedidoId?: string; tipo: string; pontos?: number }>),
    obterRelacaoMock: vi.fn(async () => null as { indicadorId: string; criadoEm: string } | null),
    obterCandidaturaMock: vi.fn(async () => null as { indicadorId: string; criadoEm: string } | null),
    registrarRelacaoMock: vi.fn(async () => "ja_existe" as "registrado" | "ja_existe" | "self_referral"),
    creditarIndicacaoMock: vi.fn(async () => undefined as "creditado" | "ja_creditado" | "nao_elegivel" | undefined),
    creditarApoioMock: vi.fn(async () => undefined),
    obterTemporadaAtivaMock: vi.fn(async () => null as { temporadaId: string; tenantId: string } | null),
    consumirMissaoSemanalMock: vi.fn(async (_p: unknown) => ({ consumida: false, bonusCreditado: 0 })),
    reverterMissaoSemanalMock: vi.fn(async (_pedidoId: string, _motivo: string) => undefined),
    concluirMissaoIndicacaoMock: vi.fn(async (_p: unknown) => ({ concluida: false, bonusCreditado: 0 })),
    reverterMissaoIndicacaoMock: vi.fn(async (_pedidoId: string, _motivo: string) => undefined),
    registrarConversaoIndicacaoMock: vi.fn(async (_p: unknown) => undefined),
    obterConversaoIndicacaoMock: vi.fn(async (_pedidoId: string) => null as { indicadorId: string; indicadoId: string; pedidoId: string } | null),
    estornarEstrelasIndicacaoMock: vi.fn(async (_p: unknown) => "estornado" as const),
    marcarConversaoAtivaMock: vi.fn(async (_indicadoId: string, _p: unknown) => undefined),
    obterConversaoAtivaMock: vi.fn(async (_indicadoId: string) => ({ indicadorId: "cli_indicador_padrao", pedidoId: "pedido_conversao_original" }) as { indicadorId: string; pedidoId: string } | null),
    revogarConversaoAtivaMock: vi.fn(async (_indicadoId: string, _pedidoId: string) => undefined),
    estornarApoioMock: vi.fn(async (_p: unknown) => "nao_encontrado" as const),
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
  estornarEstrelasIndicacaoValida: estornarEstrelasIndicacaoMock,
  estornarEstrelaApoioRecorrente: estornarApoioMock,
}));

vi.mock("./rankingIndicacaoConversao", () => ({
  registrarConversaoIndicacao: registrarConversaoIndicacaoMock,
  obterConversaoIndicacaoDoPedido: obterConversaoIndicacaoMock,
  marcarConversaoAtivaIndicado: marcarConversaoAtivaMock,
  obterConversaoAtivaIndicado: obterConversaoAtivaMock,
  revogarConversaoAtivaIndicadoSePedido: revogarConversaoAtivaMock,
  // Passthrough: os testes deste arquivo já mockam cada passo individual do
  // ciclo (obterConversaoAtiva/creditar/marcar); o lock em si (blocker de
  // concorrência) é testado à parte em rankingIndicacaoConversao.test.ts
  // contra o Redis real (mockado como store em memória).
  comReservaConversaoAtiva: vi.fn(async (_indicadoId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("./expedienteOperacional", () => ({
  chaveExpedienteOperacional: vi.fn(() => "2024-01-01"),
}));

vi.mock("./historicoAnalitico", () => ({
  registrarEventoEntregue: vi.fn(async () => undefined),
  estornarEventoAnalitico: vi.fn(async () => undefined),
}));

vi.mock("./temporadas", () => ({
  obterTemporadaAtiva: obterTemporadaAtivaMock,
}));

vi.mock("./rankingMissaoSemanalEstado", () => ({
  consumirMissaoSemanalNoPedido: consumirMissaoSemanalMock,
  reverterMissaoSemanalDoPedido: reverterMissaoSemanalMock,
}));

vi.mock("./rankingMissaoIndicacaoEstado", () => ({
  concluirMissaoIndicacaoNoPedido: concluirMissaoIndicacaoMock,
  reverterMissaoIndicacaoDoPedido: reverterMissaoIndicacaoMock,
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
  obterTemporadaAtivaMock.mockReset().mockResolvedValue(null);
  consumirMissaoSemanalMock.mockReset().mockResolvedValue({ consumida: false, bonusCreditado: 0 });
  reverterMissaoSemanalMock.mockReset().mockResolvedValue(undefined);
  concluirMissaoIndicacaoMock.mockReset().mockResolvedValue({ concluida: false, bonusCreditado: 0 });
  reverterMissaoIndicacaoMock.mockReset().mockResolvedValue(undefined);
  registrarConversaoIndicacaoMock.mockReset().mockResolvedValue(undefined);
  obterConversaoIndicacaoMock.mockReset().mockResolvedValue(null);
  estornarEstrelasIndicacaoMock.mockReset().mockResolvedValue("estornado");
  marcarConversaoAtivaMock.mockReset().mockResolvedValue(undefined);
  // Default truthy: quando `relacao` existe, os testes pré-existentes
  // (compra posterior = apoio recorrente) continuam tomando esse caminho
  // sem precisar mockar isto explicitamente. Testes do blocker "nova
  // conversão após cancelamento" mockam `null` para exercer o outro ramo.
  obterConversaoAtivaMock.mockReset().mockResolvedValue({ indicadorId: "cli_indicador_padrao", pedidoId: "pedido_conversao_original" });
  revogarConversaoAtivaMock.mockReset().mockResolvedValue(undefined);
  estornarApoioMock.mockReset().mockResolvedValue("nao_encontrado");
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

describe("efeito gamificacao (pedido entregue)", () => {
  test("sem temporada ativa, nunca consome a missão semanal (fail-closed)", async () => {
    obterTemporadaAtivaMock.mockResolvedValue(null);
    obterExtratoPontosMock.mockResolvedValue([{ pedidoId: "ped_entregue", tipo: "confirmado", pontos: 50 }]);

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(consumirMissaoSemanalMock).not.toHaveBeenCalled();
  });

  test("sem crédito de pontos para ESTE pedidoId exato, nunca consome a missão", async () => {
    obterTemporadaAtivaMock.mockResolvedValue({ temporadaId: "temp_1", tenantId: "default" });
    // extrato sem nenhum movimento para "ped_entregue" — nunca inventa crédito
    obterExtratoPontosMock.mockResolvedValue([{ pedidoId: "outro_pedido", tipo: "confirmado", pontos: 50 }]);

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(consumirMissaoSemanalMock).not.toHaveBeenCalled();
  });

  test("com temporada ativa e crédito do pedido exato, consome a missão semanal com as estrelas base do PEDIDO", async () => {
    obterTemporadaAtivaMock.mockResolvedValue({ temporadaId: "temp_1", tenantId: "default" });
    obterExtratoPontosMock.mockResolvedValue([{ pedidoId: "ped_entregue", tipo: "confirmado", pontos: 40 }]);

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(consumirMissaoSemanalMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "default",
      temporadaId: "temp_1",
      clienteId: "cli_canonico",
      pedidoId: "ped_entregue",
      estrelasBaseDoPedido: 40,
    }));
  });

  test("retry do efeito já concluído nunca chama a missão semanal de novo", async () => {
    obterTemporadaAtivaMock.mockResolvedValue({ temporadaId: "temp_1", tenantId: "default" });
    obterExtratoPontosMock.mockResolvedValue([{ pedidoId: "ped_entregue", tipo: "confirmado", pontos: 40 }]);

    await processarEfeitosPedidoEntregue(pedidoEntregue);
    consumirMissaoSemanalMock.mockClear();
    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(consumirMissaoSemanalMock).not.toHaveBeenCalled();
  });
});

describe("efeito gamificacao (pedido cancelado) — reversão da missão semanal", () => {
  test("cancelamento sempre tenta reverter a missão semanal pelo pedidoId exato (idempotente e no-op sem consumo prévio)", async () => {
    const pedido = {
      ...pedidoEntregue,
      id: "ped_cancelado",
      status: "cancelado",
      statusAnterior: "entregue",
    };

    await processarEfeitosPedidoCancelado(pedido);

    expect(reverterMissaoSemanalMock).toHaveBeenCalledWith("ped_cancelado", expect.stringContaining("ped_cancelado"));
  });

  test("retry do efeito já concluído nunca chama a reversão de novo", async () => {
    const pedido = {
      ...pedidoEntregue,
      id: "ped_cancelado",
      status: "cancelado",
      statusAnterior: "entregue",
    };

    await processarEfeitosPedidoCancelado(pedido);
    reverterMissaoSemanalMock.mockClear();
    await processarEfeitosPedidoCancelado(pedido);

    expect(reverterMissaoSemanalMock).not.toHaveBeenCalled();
  });

  test("cancelamento também tenta reverter a missão de indicação pelo mesmo pedidoId", async () => {
    const pedido = { ...pedidoEntregue, id: "ped_cancelado", status: "cancelado", statusAnterior: "entregue" };
    await processarEfeitosPedidoCancelado(pedido);
    expect(reverterMissaoIndicacaoMock).toHaveBeenCalledWith("ped_cancelado", expect.stringContaining("ped_cancelado"));
  });

  test("CANCELAMENTO TARDIO DE INDICAÇÃO: pedido com conversão registrada estorna as estrelas base do indicador", async () => {
    const pedido = { ...pedidoEntregue, id: "ped_cancelado", status: "cancelado", statusAnterior: "entregue" };
    obterConversaoIndicacaoMock.mockResolvedValue({ indicadorId: "cli_indicador", indicadoId: "cli_canonico", pedidoId: "ped_cancelado" });

    await processarEfeitosPedidoCancelado(pedido);

    expect(estornarEstrelasIndicacaoMock).toHaveBeenCalledWith(expect.objectContaining({
      indicadorId: "cli_indicador",
      indicadoId: "cli_canonico",
      pedidoId: "ped_cancelado",
    }));
  });

  test("sem migalha de conversão (pedido nunca gerou indicação), nunca tenta estornar estrelas de indicação", async () => {
    const pedido = { ...pedidoEntregue, id: "ped_cancelado", status: "cancelado", statusAnterior: "entregue" };
    obterConversaoIndicacaoMock.mockResolvedValue(null);

    await processarEfeitosPedidoCancelado(pedido);

    expect(estornarEstrelasIndicacaoMock).not.toHaveBeenCalled();
  });

  test("BLOCKER 4: cancelamento com conversão registrada revoga a marca de conversão ATIVA do indicado (libera nova conversão futura)", async () => {
    const pedido = { ...pedidoEntregue, id: "ped_cancelado", status: "cancelado", statusAnterior: "entregue" };
    obterConversaoIndicacaoMock.mockResolvedValue({ indicadorId: "cli_indicador", indicadoId: "cli_canonico", pedidoId: "ped_cancelado" });

    await processarEfeitosPedidoCancelado(pedido);

    expect(revogarConversaoAtivaMock).toHaveBeenCalledWith("cli_canonico", "ped_cancelado");
  });

  test("BLOCKER 5: todo cancelamento tenta reavaliar/estornar o apoio recorrente pelo pedidoId (idempotente, nunca invade dados de outro pedido)", async () => {
    const pedido = { ...pedidoEntregue, id: "ped_cancelado", status: "cancelado", statusAnterior: "entregue" };

    await processarEfeitosPedidoCancelado(pedido);

    expect(estornarApoioMock).toHaveBeenCalledWith(expect.objectContaining({ pedidoId: "ped_cancelado" }));
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

  test("crédito real ('creditado') registra o fato idempotente 'indicacao_convertida' — nunca por regex/diff no navegador", async () => {
    obterRelacaoMock.mockResolvedValue(null);
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("registrado");
    creditarIndicacaoMock.mockResolvedValue("creditado");

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(store.get("ranking:gamificacao:fato:indicacao_convertida:indicacao:cli_canonico:primeira-compra:ped_entregue")).toBeTruthy();
  });

  test("crédito real com temporada ativa também tenta concluir a missão da temporada 'Indique um amigo' PARA O INDICADOR", async () => {
    obterRelacaoMock.mockResolvedValue(null);
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("registrado");
    creditarIndicacaoMock.mockResolvedValue("creditado");
    obterTemporadaAtivaMock.mockResolvedValue({ temporadaId: "temp_1", tenantId: "default" });

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(concluirMissaoIndicacaoMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "default",
      temporadaId: "temp_1",
      clienteId: "cli_indicador",
      pedidoId: "ped_entregue",
    }));
  });

  test("crédito real sempre registra a migalha de conversão (indicador/indicado/pedido) para cancelamento tardio", async () => {
    obterRelacaoMock.mockResolvedValue(null);
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("registrado");
    creditarIndicacaoMock.mockResolvedValue("creditado");

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(registrarConversaoIndicacaoMock).toHaveBeenCalledWith(expect.objectContaining({
      indicadorId: "cli_indicador",
      indicadoId: "cli_canonico",
      pedidoId: "ped_entregue",
    }));
  });

  test("BLOCKER 1: 'ja_creditado' (retry após crash entre o +6 e o breadcrumb) AINDA registra a migalha de conversão — nunca deixa o retry incompleto", async () => {
    obterRelacaoMock.mockResolvedValue(null);
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("registrado");
    creditarIndicacaoMock.mockResolvedValue("ja_creditado");

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(registrarConversaoIndicacaoMock).toHaveBeenCalledWith(expect.objectContaining({
      indicadorId: "cli_indicador",
      indicadoId: "cli_canonico",
      pedidoId: "ped_entregue",
    }));
  });

  test("'nao_elegivel' nunca registra a migalha de conversão (fail-closed de verdade, nunca houve crédito real)", async () => {
    obterRelacaoMock.mockResolvedValue(null);
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("registrado");
    creditarIndicacaoMock.mockResolvedValue("nao_elegivel");

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(registrarConversaoIndicacaoMock).not.toHaveBeenCalled();
  });

  test("crédito real sem temporada ativa nunca tenta concluir a missão da temporada (fail-closed)", async () => {
    obterRelacaoMock.mockResolvedValue(null);
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("registrado");
    creditarIndicacaoMock.mockResolvedValue("creditado");
    obterTemporadaAtivaMock.mockResolvedValue(null);

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(concluirMissaoIndicacaoMock).not.toHaveBeenCalled();
  });

  test("retry do mesmo efeito (já concluído) nunca duplica o fato — idempotência do #445", async () => {
    obterRelacaoMock.mockResolvedValue(null);
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("registrado");
    creditarIndicacaoMock.mockResolvedValue("creditado");

    await processarEfeitosPedidoEntregue(pedidoEntregue);
    creditarIndicacaoMock.mockClear();
    await processarEfeitosPedidoEntregue(pedidoEntregue); // efeito já "concluido": no-op inteiro

    expect(creditarIndicacaoMock).not.toHaveBeenCalled();
  });

  test("BLOCKER 1: 'ja_creditado' (retry interno do ledger) AINDA registra o fato — o fato em si é idempotente (SET NX), então repetir nunca duplica", async () => {
    obterRelacaoMock.mockResolvedValue(null);
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("registrado");
    creditarIndicacaoMock.mockResolvedValue("ja_creditado");

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(store.get("ranking:gamificacao:fato:indicacao_convertida:indicacao:cli_canonico:primeira-compra:ped_entregue")).toBeTruthy();
  });

  test("'nao_elegivel' nunca registra o fato (fail-closed de verdade)", async () => {
    obterRelacaoMock.mockResolvedValue(null);
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("registrado");
    creditarIndicacaoMock.mockResolvedValue("nao_elegivel");

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(store.get("ranking:gamificacao:fato:indicacao_convertida:indicacao:cli_canonico:primeira-compra:ped_entregue")).toBeFalsy();
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

  test("BLOCKER 4: relação existente SEM conversão ativa (original foi cancelada) → esta compra conta como NOVA conversão principal (+6), nunca apoio", async () => {
    // Relação permanente já existe (indicado veio de um indicador há tempos),
    // mas a conversão original foi revogada por um cancelamento anterior —
    // obterConversaoAtivaIndicado devolve null. Esta é a primeira compra
    // comercial válida REAL desde então.
    obterRelacaoMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    obterConversaoAtivaMock.mockResolvedValue(null);
    creditarIndicacaoMock.mockResolvedValue("creditado");

    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(creditarIndicacaoMock).toHaveBeenCalledOnce();
    expect(creditarIndicacaoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        indicadorId: "cli_indicador",
        indicadoId: "cli_canonico",
        pedidoId: "ped_entregue",
        primeiraCompraComercialValida: true,
      })
    );
    expect(creditarApoioMock).not.toHaveBeenCalled();
    // marca esta nova conversão como a ativa, para futuras compras caírem
    // em apoio recorrente normalmente até a próxima reversão, se houver.
    expect(marcarConversaoAtivaMock).toHaveBeenCalledWith("cli_canonico", expect.objectContaining({
      indicadorId: "cli_indicador",
      pedidoId: "ped_entregue",
    }));
    // não tenta reconfirmar a relação (ela já existia)
    expect(registrarRelacaoMock).not.toHaveBeenCalled();
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

  test("BLOCKER 1 — CRASH INJETADO: falha exatamente depois do +6 e antes do breadcrumb; retry (ledger devolve ja_creditado) reconstrói TUDO que faltou, e o cancelamento posterior encontra a conversão e estorna", async () => {
    obterRelacaoMock.mockResolvedValue(null);
    obterCandidaturaMock.mockResolvedValue({ indicadorId: "cli_indicador", criadoEm: "2024-01-01" });
    registrarRelacaoMock.mockResolvedValue("registrado");
    obterTemporadaAtivaMock.mockResolvedValue({ temporadaId: "temp_1", tenantId: "default" });

    // 1ª tentativa: o ledger credita de verdade (+6), mas o processo "morre"
    // exatamente antes do breadcrumb ser persistido — nenhum efeito auxiliar
    // (breadcrumb, conversão ativa, fato, missão) chega a rodar.
    creditarIndicacaoMock.mockResolvedValueOnce("creditado");
    registrarConversaoIndicacaoMock.mockRejectedValueOnce(new Error("crash simulado antes do breadcrumb"));
    await expect(processarEfeitosPedidoEntregue(pedidoEntregue)).rejects.toThrow("crash simulado antes do breadcrumb");

    // O que vem DEPOIS do ponto de crash (breadcrumb, conversão ativa,
    // missão) ainda não foi persistido; o fato (que roda ANTES do breadcrumb
    // no pipeline real) já foi — é exatamente esse "meio do caminho" que o
    // retry precisa completar sem duplicar nada.
    expect(marcarConversaoAtivaMock).not.toHaveBeenCalled();
    expect(concluirMissaoIndicacaoMock).not.toHaveBeenCalled();

    // Retry: o ledger real, consultado de novo com o MESMO eventoId, devolve
    // "ja_creditado" (não recredita) — mas os efeitos auxiliares que não
    // rodaram da vez passada precisam rodar agora.
    creditarIndicacaoMock.mockResolvedValue("ja_creditado");
    await processarEfeitosPedidoEntregue(pedidoEntregue);

    // Nunca duplica o +6: a segunda chamada ao ledger devolveu "ja_creditado",
    // nunca um novo "creditado".
    expect(registrarConversaoIndicacaoMock).toHaveBeenLastCalledWith(expect.objectContaining({
      indicadorId: "cli_indicador",
      indicadoId: "cli_canonico",
      pedidoId: "ped_entregue",
    }));
    expect(marcarConversaoAtivaMock).toHaveBeenCalledWith("cli_canonico", expect.objectContaining({
      indicadorId: "cli_indicador",
      pedidoId: "ped_entregue",
    }));
    expect(concluirMissaoIndicacaoMock).toHaveBeenCalledWith(expect.objectContaining({
      clienteId: "cli_indicador",
      pedidoId: "ped_entregue",
    }));
    expect(store.get("ranking:gamificacao:fato:indicacao_convertida:indicacao:cli_canonico:primeira-compra:ped_entregue")).toBeTruthy();

    // Cancelamento posterior: a migalha existe (foi recriada no retry), então
    // o cancelamento encontra a conversão e estorna corretamente.
    obterConversaoIndicacaoMock.mockResolvedValue({ indicadorId: "cli_indicador", indicadoId: "cli_canonico", pedidoId: "ped_entregue" });
    const pedidoCancelado = { ...pedidoEntregue, id: "ped_entregue", status: "cancelado", statusAnterior: "entregue" };
    await processarEfeitosPedidoCancelado(pedidoCancelado);

    expect(estornarEstrelasIndicacaoMock).toHaveBeenCalledWith(expect.objectContaining({
      indicadorId: "cli_indicador",
      indicadoId: "cli_canonico",
      pedidoId: "ped_entregue",
    }));
    expect(revogarConversaoAtivaMock).toHaveBeenCalledWith("cli_canonico", "ped_entregue");
  });
});
