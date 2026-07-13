import { beforeEach, describe, expect, test, vi } from "vitest";

// Nível 6.7 — recuperação administrativa auditada de UM pedido cujo crédito
// automático foi corretamente recusado só por `PEDIDO_ANTERIOR_ATIVACAO`,
// usando exatamente o caso real comprovado no Preview: pedido #14
// (1783967630709), proprietário sessão …0691, compra confirmada via Pix
// automático, 63 pontos elegíveis, único gate falso é
// `ativacaoAnteriorAoPedido` (a ativação foi persistida DEPOIS do pedido,
// apesar do cliente afirmar ter ativado antes — falha de persistência, não
// de regra).

const redisStore = new Map<string, unknown>();
const auditoria: string[] = [];

function defaultGetImpl(key: string) {
  return Promise.resolve(redisStore.has(key) ? redisStore.get(key) : null);
}
function defaultSetImpl(key: string, value: unknown, opts?: { nx?: boolean }) {
  if (opts?.nx && redisStore.has(key)) return Promise.resolve(null);
  redisStore.set(key, value);
  return Promise.resolve("OK");
}
function defaultEvalImpl(_script: string, keys: string[], args: unknown[]) {
  if (keys.length === 1) {
    const [key] = keys;
    const [token] = args;
    if (redisStore.get(key) === token) {
      redisStore.delete(key);
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  }
  const [lockKey, estadoKey] = keys;
  const [token, estadoJson] = args;
  if (redisStore.get(lockKey) === token) {
    redisStore.set(estadoKey, JSON.parse(String(estadoJson)));
    return Promise.resolve(1);
  }
  return Promise.resolve(0);
}

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
    eval: vi.fn(defaultEvalImpl),
    rpush: vi.fn((key: string, value: string) => {
      auditoria.push(value);
      return Promise.resolve(auditoria.length);
    }),
    ltrim: vi.fn(() => Promise.resolve("OK")),
    expire: vi.fn(() => Promise.resolve(1)),
    lrange: vi.fn(() => Promise.resolve([...auditoria])),
  },
}));

import {
  obterAuditoriaRecuperacaoPontos,
  obterExtratoPontos,
  previsualizarRecuperacaoCreditoPontosPedidoAdmin,
  recuperarCreditoPontosPedidoAdmin,
  type ConfigFidelidadePontos,
  type PedidoParaCreditoPontos,
} from "./fidelidade";

const TELEFONE_SESSAO = "99974000691";
const TELEFONE_CONTATO = "86999999999";
const CLIENTE_ID_SESSAO = `cli_${TELEFONE_SESSAO}`;

const pedido14Real: PedidoParaCreditoPontos = {
  id: "1783967630709",
  numero: 14,
  origem: "site",
  clienteId: CLIENTE_ID_SESSAO,
  telefone: TELEFONE_CONTATO,
  criadoEm: "2026-07-13T18:33:50.709Z",
  status: "novo",
  pixConfirmado: false,
  pix: { provider: "mercadopago", status: "approved" },
  total: 68,
  taxaEntrega: 5,
};

const configAtiva: ConfigFidelidadePontos = {
  ativo: true,
  metaPontos: 60,
  descricaoRecompensa: "1 Pizza Familia",
};

// Ativação persistida DEPOIS do pedido (18:33) — reproduz a causa real
// comprovada: pedidoCriadoDepoisDaAtivacao(pedido, cliente) retorna false,
// então gates.ativacaoAnteriorAoPedido é false e o fluxo automático recusa
// com PEDIDO_ANTERIOR_ATIVACAO, mesmo a compra estando confirmada e o
// cliente participando do programa.
const clienteSessao = {
  clienteId: CLIENTE_ID_SESSAO,
  telefone: TELEFONE_SESSAO,
  nome: "Cliente 0691",
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-13T19:00:00.000Z",
  lastLoginAt: "2026-07-13T19:00:00.000Z",
  pontosAtivos: true,
  pontosAtivadoEm: "2026-07-13T19:00:00.000Z",
};

function seedPedidosPadrao(pedidos: PedidoParaCreditoPontos[] = [pedido14Real]) {
  redisStore.set("pedidos", pedidos);
}

beforeEach(() => {
  redisStore.clear();
  auditoria.length = 0;
  redisStore.set("config:fidelidade:pontos", configAtiva);
  redisStore.set(`cliente:${TELEFONE_SESSAO}`, clienteSessao);
  redisStore.set(`cliente:${TELEFONE_CONTATO}`, {
    ...clienteSessao,
    clienteId: `cli_${TELEFONE_CONTATO}`,
    telefone: TELEFONE_CONTATO,
    nome: "Contato 9999",
  });
  seedPedidosPadrao();
});

describe("previsualizarRecuperacaoCreditoPontosPedidoAdmin", () => {
  test("mostra numero, proprietario mascarado, pontos calculados e motivo real de recusa", async () => {
    const previa = await previsualizarRecuperacaoCreditoPontosPedidoAdmin(pedido14Real.id);
    expect(previa.encontrado).toBe(true);
    expect(previa.numero).toBe(14);
    expect(previa.proprietarioClienteIdMascarado).toBe("…0691");
    expect(previa.pontosCalculados).toBe(63);
    expect(previa.motivoRecusaAutomatica).toBe("PEDIDO_ANTERIOR_ATIVACAO");
    expect(previa.elegivelParaRecuperacao).toBe(true);
  });

  test("pedido inexistente nao e encontrado", async () => {
    const previa = await previsualizarRecuperacaoCreditoPontosPedidoAdmin("nao-existe");
    expect(previa.encontrado).toBe(false);
    expect(previa.elegivelParaRecuperacao).toBe(false);
  });
});

describe("recuperarCreditoPontosPedidoAdmin — caso real #14", () => {
  test("1. fluxo automatico continua recusando com PEDIDO_ANTERIOR_ATIVACAO (nao mudamos a regra geral)", async () => {
    const previa = await previsualizarRecuperacaoCreditoPontosPedidoAdmin(pedido14Real.id);
    expect(previa.motivoRecusaAutomatica).toBe("PEDIDO_ANTERIOR_ATIVACAO");
  });

  test("2/3/4. operacao admin recupera o #14, grava confirmado:1783967630709 e calcula 63 no servidor", async () => {
    const resultado = await recuperarCreditoPontosPedidoAdmin(pedido14Real.id, {
      motivo: "RECUPERACAO_VALIDACAO_ATIVACAO_NAO_PERSISTIDA",
    });

    expect(resultado.ok).toBe(true);
    expect(resultado.jaExistia).toBe(false);
    expect(resultado.pontosCreditados).toBe(63);
    expect(resultado.eventoId).toBe("confirmado:1783967630709");

    const extrato = await obterExtratoPontos(CLIENTE_ID_SESSAO);
    expect(extrato).toHaveLength(1);
    expect(extrato[0].eventoId).toBe("confirmado:1783967630709");
    expect(extrato[0].pontos).toBe(63);
  });

  test("5/6. nao aceita pontos nem clienteId vindos de fora — mesmo enviados, sao ignorados e o valor real vem do servidor", async () => {
    const contextoMalicioso = { motivo: "x", pontos: 999999, clienteId: "cli_outro" } as unknown as Parameters<
      typeof recuperarCreditoPontosPedidoAdmin
    >[1];
    const resultado = await recuperarCreditoPontosPedidoAdmin(pedido14Real.id, contextoMalicioso);

    expect(resultado.pontosCreditados).toBe(63);
    const extratoOutro = await obterExtratoPontos("cli_outro");
    expect(extratoOutro).toHaveLength(0);
  });

  test("7/8. proprietario correto (sessao) recebe os pontos; telefone de contato nao recebe movimento", async () => {
    await recuperarCreditoPontosPedidoAdmin(pedido14Real.id, { motivo: "teste" });

    const extratoSessao = await obterExtratoPontos(CLIENTE_ID_SESSAO);
    expect(extratoSessao).toHaveLength(1);

    const extratoContato = await obterExtratoPontos(`cli_${TELEFONE_CONTATO}`);
    expect(extratoContato).toHaveLength(0);
  });

  test("9. segunda execucao nao duplica — retorna jaExistia true e pontosCreditados 0", async () => {
    await recuperarCreditoPontosPedidoAdmin(pedido14Real.id, { motivo: "primeira" });
    const segunda = await recuperarCreditoPontosPedidoAdmin(pedido14Real.id, { motivo: "segunda" });

    expect(segunda.ok).toBe(true);
    expect(segunda.jaExistia).toBe(true);
    expect(segunda.pontosCreditados).toBe(0);

    const extrato = await obterExtratoPontos(CLIENTE_ID_SESSAO);
    expect(extrato).toHaveLength(1);
  });

  test("10. outros pedidos antigos com o mesmo gate permanecem sem credito (recuperacao e por pedido)", async () => {
    const pedidoAntigo: PedidoParaCreditoPontos = {
      ...pedido14Real,
      id: "pedido-antigo-1",
      numero: 3,
      total: 40,
      taxaEntrega: 0,
    };
    seedPedidosPadrao([pedido14Real, pedidoAntigo]);

    await recuperarCreditoPontosPedidoAdmin(pedido14Real.id, { motivo: "so o #14" });

    const extrato = await obterExtratoPontos(CLIENTE_ID_SESSAO);
    expect(extrato.some((m) => m.pedidoId === "pedido-antigo-1")).toBe(false);
  });

  test("11. pedido cancelado nao pode ser recuperado", async () => {
    seedPedidosPadrao([{ ...pedido14Real, status: "cancelado" }]);
    const resultado = await recuperarCreditoPontosPedidoAdmin(pedido14Real.id, { motivo: "teste" });
    expect(resultado.ok).toBe(false);
    expect(resultado.motivoRecusa).toBe("PEDIDO_CANCELADO");
  });

  test("12. pedido nao confirmado nao pode ser recuperado", async () => {
    seedPedidosPadrao([{ ...pedido14Real, pixConfirmado: false, pix: { provider: "mercadopago", status: "pendente" } }]);
    const resultado = await recuperarCreditoPontosPedidoAdmin(pedido14Real.id, { motivo: "teste" });
    expect(resultado.ok).toBe(false);
    expect(resultado.motivoRecusa).toBe("COMPRA_NAO_CONFIRMADA");
  });

  test("13. programa inativo bloqueia", async () => {
    redisStore.set("config:fidelidade:pontos", { ...configAtiva, ativo: false });
    const resultado = await recuperarCreditoPontosPedidoAdmin(pedido14Real.id, { motivo: "teste" });
    expect(resultado.ok).toBe(false);
    expect(resultado.motivoRecusa).toBe("PROGRAMA_INATIVO");
  });

  test("14. cliente nao participante bloqueia", async () => {
    redisStore.set(`cliente:${TELEFONE_SESSAO}`, { ...clienteSessao, pontosAtivos: false, pontosAtivadoEm: undefined });
    const resultado = await recuperarCreditoPontosPedidoAdmin(pedido14Real.id, { motivo: "teste" });
    expect(resultado.ok).toBe(false);
    expect(resultado.motivoRecusa).toBe("CLIENTE_NAO_ATIVOU_PONTOS");
  });

  test("15/16. auditoria e persistida, mascara o clienteId e nunca expoe telefone completo/PII", async () => {
    await recuperarCreditoPontosPedidoAdmin(pedido14Real.id, {
      motivo: "RECUPERACAO_VALIDACAO_ATIVACAO_NAO_PERSISTIDA",
      adminId: "admin-teste",
    });

    const entradas = await obterAuditoriaRecuperacaoPontos();
    expect(entradas).toHaveLength(1);
    const [entrada] = entradas;
    expect(entrada.pedidoId).toBe(pedido14Real.id);
    expect(entrada.numero).toBe(14);
    expect(entrada.pontosCreditados).toBe(63);
    expect(entrada.resultado).toBe("creditado");
    expect(entrada.admin).toBe("admin-teste");
    expect(entrada.clienteIdMascarado).toBe("…0691");
    expect(JSON.stringify(entrada)).not.toContain(TELEFONE_SESSAO);
    expect(JSON.stringify(entrada)).not.toContain(CLIENTE_ID_SESSAO);
  });

  test("pedido inexistente retorna PEDIDO_INVALIDO e registra auditoria de recusa", async () => {
    const resultado = await recuperarCreditoPontosPedidoAdmin("nao-existe", { motivo: "teste" });
    expect(resultado.ok).toBe(false);
    expect(resultado.motivoRecusa).toBe("PEDIDO_INVALIDO");

    const entradas = await obterAuditoriaRecuperacaoPontos();
    expect(entradas[0].resultado).toBe("recusado");
  });
});
