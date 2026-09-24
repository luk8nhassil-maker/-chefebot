import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  store,
  redisMock,
  derivarClienteIdMock,
  customerKeyMock,
  eventosPeriodoMock,
  eventosAntesMock,
  candidatoMock,
  gateMock,
  instrumentoMock,
  enviarMock,
  registrarMensagemMock,
  registrarContatoMock,
  registrarPendenteMock,
} = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    redisMock: {
      get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
      set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
        if (opts?.nx && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      }),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
      eval: vi.fn(async (script: string, keys: string[], args: string[]) => {
        const key = keys[0];
        if (store.get(key) === args[0]) {
          store.delete(key);
          return 1;
        }
        return 0;
      }),
    },
    derivarClienteIdMock: vi.fn(),
    customerKeyMock: vi.fn(),
    eventosPeriodoMock: vi.fn(),
    eventosAntesMock: vi.fn(),
    candidatoMock: vi.fn(),
    gateMock: vi.fn(),
    instrumentoMock: vi.fn(),
    enviarMock: vi.fn(),
    registrarMensagemMock: vi.fn(),
    registrarContatoMock: vi.fn(),
    registrarPendenteMock: vi.fn(),
  };
});

vi.mock("./redis", () => ({ redis: redisMock }));
vi.mock("./fidelidade", () => ({
  derivarClienteIdPorTelefone: derivarClienteIdMock,
}));
vi.mock("./pesquisaPreferenciaContatosRedis", () => ({
  derivarResearchCustomerKey: customerKeyMock,
  registrarContatoPesquisaConfirmado: registrarContatoMock,
}));
vi.mock("./historicoAnalitico", async (importOriginal) => {
  const original = await importOriginal<typeof import("./historicoAnalitico")>();
  return {
    ...original,
    consultarEventosPorPeriodo: eventosPeriodoMock,
    consultarEventosAntesDe: eventosAntesMock,
  };
});
vi.mock("./pesquisaPreferenciaCandidato", () => ({
  validarCandidatoMomentoControlado: candidatoMock,
}));
vi.mock("./pesquisaPreferenciaElegibilidadeCompleta.server", () => ({
  avaliarElegibilidadeContatoPesquisaCompleta: gateMock,
}));
vi.mock("./pesquisaPreferenciaRegistro", () => ({
  obterInstrumentoPesquisa: instrumentoMock,
}));
vi.mock("./whatsappMensagem", () => ({
  enviarTextoWhatsApp: enviarMock,
}));
vi.mock("./conversa", () => ({
  registrarMensagem: registrarMensagemMock,
}));
vi.mock("./pesquisaPreferenciaRespostaRedis", () => ({
  registrarPesquisaPendente: registrarPendenteMock,
}));

import { executarEnvioPesquisaControlado } from "./pesquisaPreferenciaEnvioControlado.server";

const PHONE = "5599999999999";
const AGORA = Date.UTC(2026, 9, 20, 12, 0, 0);

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  derivarClienteIdMock.mockReturnValue("cli_5599999999999");
  customerKeyMock.mockReturnValue("a".repeat(64));
  eventosPeriodoMock.mockResolvedValue([]);
  eventosAntesMock.mockResolvedValue([]);
  candidatoMock.mockReturnValue({ valido: true, motivo: "ok" });
  gateMock.mockResolvedValue({
    elegibilidade: {
      status: "elegivel",
      motivos: [],
      contatosUltimos14Dias: 0,
      contatosUltimos90Dias: 0,
    },
    diagnostico: {},
  });
  instrumentoMock.mockReturnValue({
    questionId: "research-m1-main",
    version: 1,
    momentId: "M1",
    pergunta: "Pergunta aprovada?",
    objetivo: "teste",
    tipoResposta: "texto_livre",
    habilitadaParaEnvio: false,
  });
  enviarMock.mockResolvedValue({
    ok: true,
    tentativas: 1,
    latenciaMs: 10,
    statusHttp: 201,
  });
  registrarMensagemMock.mockResolvedValue(undefined);
  registrarContatoMock.mockResolvedValue(true);
  registrarPendenteMock.mockResolvedValue(true);
});

function executar() {
  return executarEnvioPesquisaControlado({
    telefone: PHONE,
    momentId: "M1",
    triggerEventId: "pedido-1",
    checkoutWebEmAndamento: false,
    disputaOuEstornoExternoAberto: false,
    agoraMs: AGORA,
  });
}

describe("executarEnvioPesquisaControlado", () => {
  test("envia uma vez, registra orçamento e arma captura de resposta", async () => {
    const resultado = await executar();

    expect(resultado.status).toBe("enviado");
    expect(enviarMock).toHaveBeenCalledTimes(1);
    expect(enviarMock.mock.calls[0][1]).toContain("Pergunta aprovada?");
    expect(enviarMock.mock.calls[0][1]).toContain("SAIR");
    expect(registrarContatoMock).toHaveBeenCalledTimes(1);
    expect(registrarPendenteMock).toHaveBeenCalledTimes(1);
    expect(registrarMensagemMock).toHaveBeenCalledTimes(1);
  });

  test("gate suprimido nunca chama Evolution", async () => {
    gateMock.mockResolvedValue({
      elegibilidade: {
        status: "suprimido",
        motivos: ["cooldown_14_dias"],
        contatosUltimos14Dias: 1,
        contatosUltimos90Dias: 1,
      },
      diagnostico: {},
    });

    const resultado = await executar();

    expect(resultado).toEqual({
      status: "suprimido",
      motivos: ["cooldown_14_dias"],
    });
    expect(enviarMock).not.toHaveBeenCalled();
  });

  test("candidato inválido nunca chama Evolution", async () => {
    candidatoMock.mockReturnValue({
      valido: false,
      motivo: "gatilho_nao_corresponde_ao_momento",
    });

    const resultado = await executar();

    expect(resultado.status).toBe("candidato_invalido");
    expect(enviarMock).not.toHaveBeenCalled();
  });

  test("provider recusou com 4xx libera claim para correção e nova tentativa", async () => {
    enviarMock.mockResolvedValue({
      ok: false,
      tentativas: 1,
      latenciaMs: 10,
      statusHttp: 400,
      motivo: "http_400",
    });

    const resultado = await executar();

    expect(resultado.status).toBe("envio_nao_realizado");
    const estadoKeys = [...store.keys()].filter((key) =>
      key.startsWith("pesquisa:envio-controlado:v1:")
    );
    expect(estadoKeys).toHaveLength(0);
  });

  test("timeout mantém claim e bloqueia retry cego", async () => {
    enviarMock.mockResolvedValue({
      ok: false,
      tentativas: 2,
      latenciaMs: 20_000,
      motivo: "timeout",
    });

    const primeiro = await executar();
    expect(primeiro.status).toBe("resultado_envio_indeterminado");

    enviarMock.mockClear();
    const segundo = await executar();
    expect(segundo.status).toBe("em_processamento");
    expect(enviarMock).not.toHaveBeenCalled();
  });

  test("subscription guard silencioso não é contado como envio", async () => {
    enviarMock.mockResolvedValue({
      ok: true,
      tentativas: 0,
      latenciaMs: 1,
      motivo: "subscription_silenced_new_contact",
    });

    const resultado = await executar();

    expect(resultado.status).toBe("envio_nao_realizado");
    expect(registrarContatoMock).not.toHaveBeenCalled();
    expect(registrarPendenteMock).not.toHaveBeenCalled();
  });

  test("estado enviado nunca reenvia e apenas reconcilia persistências", async () => {
    const primeiro = await executar();
    expect(primeiro.status).toBe("enviado");
    expect(enviarMock).toHaveBeenCalledTimes(1);

    // Simula perda parcial pós-envio: retry deve reconciliar, nunca reenviar.
    registrarContatoMock.mockClear();
    registrarPendenteMock.mockClear();
    enviarMock.mockClear();

    const segundo = await executar();

    expect(segundo.status).toBe("ja_enviado_reconciliado");
    expect(enviarMock).not.toHaveBeenCalled();
    expect(registrarContatoMock).toHaveBeenCalledTimes(1);
    expect(registrarPendenteMock).toHaveBeenCalledTimes(1);
  });

  test("lock por cliente impede dois disparos simultâneos", async () => {
    const mutexKey = `pesquisa:envio-controlado:mutex:v1:${"a".repeat(64)}`;
    store.set(mutexKey, "outro-dono");

    const resultado = await executar();

    expect(resultado.status).toBe("em_processamento");
    expect(enviarMock).not.toHaveBeenCalled();
  });
});
