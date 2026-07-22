import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();

function defaultGetImpl(key: string) {
  return Promise.resolve(redisStore.has(key) ? redisStore.get(key) : null);
}
function defaultSetImpl(key: string, value: unknown, opts?: { nx?: boolean }) {
  if (opts?.nx && redisStore.has(key)) return Promise.resolve(null);
  redisStore.set(key, value);
  return Promise.resolve("OK");
}

// Replica os dois scripts Lua reais da fidelidade por pontos, sem interpretar
// Lua: liberarLockPontosSeDono (1 chave: GET==token -> DEL) e
// persistirEstadoPontosSeDono (2 chaves: GET(lock)==token -> SET(estado)).
function defaultEvalImpl(_script: string, keys: string[], args: string[]) {
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
    redisStore.set(estadoKey, JSON.parse(estadoJson));
    return Promise.resolve(1);
  }
  return Promise.resolve(0);
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
    eval: vi.fn(defaultEvalImpl),
    del: vi.fn((key: string) => {
      const existia = redisStore.has(key);
      redisStore.delete(key);
      return Promise.resolve(existia ? 1 : 0);
    }),
  },
}));

vi.mock("@/lib/numeracao", () => ({
  proximoNumeroPedido: vi.fn(async () => 100),
}));

vi.mock("@/lib/clienteAuth", () => ({
  CLIENTE_COOKIE: "cliente-token",
  verificarTokenCliente: vi.fn(async () => null),
}));

vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));

import { POST } from "./route";
import {
  derivarClienteIdPorTelefone,
  obterExtratoPontos,
  obterSaldoPontos,
  obterRecompensasPontos,
  obterReservasResgatePontos,
  reservarResgatePontos,
} from "@/lib/fidelidade";

const TELEFONE = "86999998888";
const CONFIG_KEY = "config:fidelidade:pontos";

function estadoKey(clienteId: string) {
  return `fidelidade:pontos:estado:${clienteId}`;
}

async function prepararRecompensaDisponivel() {
  const clienteId = derivarClienteIdPorTelefone(TELEFONE)!;
  redisStore.set(CONFIG_KEY, {
    ativo: true,
    metaPontos: 60,
    valorPizzaFamiliaReferencia: 60,
    metaPizzasFamilia: 1,
    descricaoRecompensa: "1 Pizza Família",
  });
  redisStore.set(estadoKey(clienteId), {
    extrato: [
      {
        movimentoId: "pt_seed",
        clienteId,
        pedidoId: "pedido_seed",
        tipo: "confirmado",
        pontos: 60,
        saldoApos: 60,
        motivo: "seed",
        createdAt: new Date().toISOString(),
      },
    ],
    recompensas: [
      {
        recompensaId: "rcp_1",
        clienteId,
        pedidoId: "pedido_seed",
        pontosNaDesbloqueio: 60,
        metaNaDesbloqueio: 60,
        status: "disponivel",
        notificacaoStatus: "pendente",
        createdAt: new Date().toISOString(),
      },
    ],
    reservas: [],
  });

  const reserva = await reservarResgatePontos(clienteId, "rcp_1");
  return { clienteId, reserva };
}

const itemPizza = { kind: "pizza" as const, name: "Pizza G", detail: "Calabresa", price: 50, qty: 1 };

function pedidoRequest(opts: { resgateId?: string; itens?: unknown[]; clientRequestId?: string } = {}) {
  const body = {
    cliente: "Fulano de Tal",
    telefone: TELEFONE,
    itens: opts.itens ?? [itemPizza],
    tipoEntrega: "retirada",
    pagamento: "Dinheiro",
    troco: "Sem troco",
    ...(opts.resgateId ? { resgateId: opts.resgateId } : {}),
    ...(opts.clientRequestId ? { clientRequestId: opts.clientRequestId } : {}),
  };
  return new NextRequest("http://localhost/api/pedido-app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  redisStore.clear();
  vi.mocked(fetch).mockClear();
  vi.unstubAllEnvs();
  const redisLib = await import("@/lib/redis");
  vi.mocked(redisLib.redis.get).mockImplementation(defaultGetImpl);
  vi.mocked(redisLib.redis.set).mockImplementation(defaultSetImpl);
  vi.mocked(redisLib.redis.eval).mockImplementation(defaultEvalImpl);
  vi.mocked(redisLib.redis.del).mockImplementation((key: string) => {
    const existia = redisStore.has(key);
    redisStore.delete(key);
    return Promise.resolve(existia ? 1 : 0);
  });
});

describe("POST /api/pedido-app — resgate de pontos no checkout (Etapa 5)", () => {
  test("resgate valido aplica desconto calculado no servidor e confirma a reserva", async () => {
    const { clienteId, reserva } = await prepararRecompensaDisponivel();

    const res = await POST(pedidoRequest({ resgateId: reserva.resgateId }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(0); // subtotal 50 - desconto 50 (capado no subtotal) + taxa 0

    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].resgateId).toBe(reserva.resgateId);
    expect(pedidosSalvos[0].descontoFidelidade).toBe(50);

    const reservas = await obterReservasResgatePontos(clienteId);
    const reservaFinal = reservas.find((r) => r.resgateId === reserva.resgateId)!;
    expect(reservaFinal.status).toBe("confirmado");

    const recompensas = await obterRecompensasPontos(clienteId);
    expect(recompensas.find((r) => r.recompensaId === "rcp_1")!.status).toBe("resgatada");

    // pontos "resgatado" debitam a meta inteira reservada, mesmo com desconto capado no subtotal
    const extrato = await obterExtratoPontos(clienteId);
    const movResgate = extrato.find((m) => m.tipo === "resgatado");
    expect(movResgate?.pontos).toBe(60);

    const saldo = await obterSaldoPontos(clienteId);
    expect(saldo.disponivel).toBe(0); // 60 confirmados - 60 resgatados
  });

  test("novos pontos previstos sao calculados sobre o valor JA com desconto (total pago)", async () => {
    const { reserva } = await prepararRecompensaDisponivel();
    const res = await POST(pedidoRequest({ resgateId: reserva.resgateId }));
    expect(res.status).toBe(200);

    // total pago foi 0 (subtotal 50 - desconto 50), entao nenhum ponto previsto novo deve ser gerado
    const clienteId = derivarClienteIdPorTelefone(TELEFONE)!;
    const extrato = await obterExtratoPontos(clienteId);
    const previstoNovoPedido = extrato.find((m) => m.tipo === "previsto");
    expect(previstoNovoPedido).toBeUndefined();
  });

  test("desconto e sempre capado pelo subtotal: pedido menor que o valor-base nunca fica negativo", async () => {
    const { reserva } = await prepararRecompensaDisponivel();
    const res = await POST(
      pedidoRequest({ resgateId: reserva.resgateId, itens: [{ kind: "simple", name: "Agua sem Gas", price: 3, qty: 1 }] })
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(0);

    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].descontoFidelidade).toBe(3);
  });

  test("resgateId inexistente e rejeitado com 400 e nao cria o pedido", async () => {
    const res = await POST(pedidoRequest({ resgateId: "rsg_inexistente" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/resgate inv/i);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("resgateId expirado e rejeitado com 400 e nao cria o pedido", async () => {
    const { reserva } = await prepararRecompensaDisponivel();
    const clienteId = derivarClienteIdPorTelefone(TELEFONE)!;
    const estadoAtual = redisStore.get(estadoKey(clienteId)) as { reservas: Array<Record<string, unknown>> };
    estadoAtual.reservas = estadoAtual.reservas.map((r) =>
      r.resgateId === reserva.resgateId ? { ...r, expiraEm: new Date(Date.now() - 1000).toISOString() } : r
    );
    redisStore.set(estadoKey(clienteId), estadoAtual);

    const res = await POST(pedidoRequest({ resgateId: reserva.resgateId }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/expirad/i);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("resgateId de outro telefone (outro cliente) nunca e aplicado", async () => {
    const { reserva } = await prepararRecompensaDisponivel();

    const body = {
      cliente: "Outra Pessoa",
      telefone: "11911112222", // telefone diferente do dono da reserva
      itens: [itemPizza],
      tipoEntrega: "retirada",
      pagamento: "Dinheiro",
      troco: "Sem troco",
      resgateId: reserva.resgateId,
    };
    const req = new NextRequest("http://localhost/api/pedido-app", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/resgate inv/i);
  });

  test("reserva ja confirmada (reutilizada) e rejeitada com 400 na segunda tentativa", async () => {
    const { reserva } = await prepararRecompensaDisponivel();

    const primeira = await POST(pedidoRequest({ resgateId: reserva.resgateId }));
    expect(primeira.status).toBe(200);

    const segunda = await POST(pedidoRequest({ resgateId: reserva.resgateId }));
    const data = await segunda.json();
    expect(segunda.status).toBe(400);
    expect(data.error).toMatch(/resgate inv/i);
  });

  test("falha ao confirmar o resgate rejeita a resposta e remove o pedido com desconto", async () => {
    const { reserva } = await prepararRecompensaDisponivel();

    const redisLib = await import("@/lib/redis");
    const originalEval = defaultEvalImpl;
    let jaFalhou = false;
    vi.mocked(redisLib.redis.eval).mockImplementation((script: string, keys: string[], args: string[]) => {
      if (!jaFalhou && keys.length === 2) {
        jaFalhou = true;
        return Promise.reject(new Error("falha simulada ao confirmar resgate"));
      }
      return originalEval(script, keys, args);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(pedidoRequest({ resgateId: reserva.resgateId }));
    const data = await res.json();
    consoleSpy.mockRestore();

    expect(res.status).toBe(409);
    expect(data.ok).toBe(false);
    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos).toHaveLength(0);

    const clienteId = derivarClienteIdPorTelefone(TELEFONE)!;
    const reservas = await obterReservasResgatePontos(clienteId);
    expect(reservas.find((r) => r.resgateId === reserva.resgateId)!.status).toBe("reservado");
  });

  // [Modo Sobrevivência — ponto 4 da revisão de segurança] Antes desta
  // correção, `pedidoCriado` virava `true` na persistência e nunca voltava
  // a `false` mesmo quando o pedido era removido pelo rollback do resgate
  // logo em seguida — o claim/resultado de idempotência ficavam presos
  // como se o pedido ainda existisse, bloqueando qualquer retry legítimo
  // por até 24h. Este teste prova que, depois do rollback, o claim E o
  // resultado são liberados de verdade, e um retry com o MESMO
  // clientRequestId consegue criar um pedido novo (não recebe 409 "ainda
  // processando" nem devolve o pedido já removido).
  test("[Modo Sobrevivência] falha ao confirmar resgate libera claim e resultado de idempotência — retry legítimo cria um pedido novo", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const { reserva } = await prepararRecompensaDisponivel();
    const clientRequestId = "rollback-resgate-libera-real-1";
    const chaveClaim = `survival:idempotencia:pedido:${clientRequestId}:claim`;
    const chaveResultado = `survival:idempotencia:pedido:${clientRequestId}:result`;

    const redisLib = await import("@/lib/redis");
    const originalEval = defaultEvalImpl;
    let jaFalhou = false;
    vi.mocked(redisLib.redis.eval).mockImplementation((script: string, keys: string[], args: unknown[]) => {
      if (!jaFalhou && keys.length === 2) {
        jaFalhou = true;
        return Promise.reject(new Error("falha simulada ao confirmar resgate"));
      }
      return originalEval(script, keys, args as string[]);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    consoleSpy.mockRestore();

    expect(res.status).toBe(409);
    const pedidosAposFalha = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosAposFalha).toHaveLength(0);
    // O rollback removeu o pedido de verdade — claim e resultado de
    // idempotência precisam ter sido liberados junto, nunca presos.
    expect(redisStore.has(chaveClaim)).toBe(false);
    expect(redisStore.has(chaveResultado)).toBe(false);

    // Retry com o MESMO clientRequestId (a mesma reserva continua
    // "reservada", reutilizável) — precisa criar um pedido NOVO, nunca
    // ficar preso a "ainda processando" nem devolver o pedido já removido.
    const retry = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    expect(retry.status).toBe(200);
    const pedidosAposRetry = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosAposRetry).toHaveLength(1);
  });

  // [Modo Sobrevivência — 4ª revisão, ponto 3] Antes desta correção, se a
  // confirmação do resgate falhasse E o rollback do pedido TAMBÉM falhasse
  // (GET ou SET de "pedidos" durante a tentativa de reverter), a exceção
  // escapava para o catch externo que, vendo `pedidoIdCriado` setado,
  // devolvia `ok:true, degradado:true` — confirmando ao cliente um pedido
  // com desconto cujo débito nunca foi confirmado nem revertido. Os dois
  // testes abaixo provam que essa falha dupla NUNCA mais devolve sucesso.
  test("[Modo Sobrevivência] confirmarResgatePontos falha E o GET do rollback também falha: nunca ok:true, pedido fica recovery_required, retry não duplica", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const { reserva } = await prepararRecompensaDisponivel();
    const clientRequestId = "rollback-get-falha-001";

    const redisLib = await import("@/lib/redis");
    const originalEval = defaultEvalImpl;
    const originalGet = defaultGetImpl;
    let jaFalhouEval = false;
    let jaFalhouGet = false;
    vi.mocked(redisLib.redis.eval).mockImplementation((script: string, keys: string[], args: unknown[]) => {
      if (!jaFalhouEval && keys.length === 2) {
        jaFalhouEval = true;
        return Promise.reject(new Error("falha simulada ao confirmar resgate"));
      }
      return originalEval(script, keys, args as string[]);
    });
    vi.mocked(redisLib.redis.get).mockImplementation((key: string) => {
      if (key === "pedidos" && jaFalhouEval && !jaFalhouGet) {
        jaFalhouGet = true;
        return Promise.reject(new Error("falha simulada no GET do rollback"));
      }
      return originalGet(key);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    const data = await res.json();
    consoleSpy.mockRestore();

    expect(res.status).toBe(503);
    expect(data.ok).toBe(false);
    expect(data.unresolved).toBe(true);

    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].survivalState).toBe("recovery_required");

    vi.mocked(redisLib.redis.get).mockImplementation(originalGet);
    const retry = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    expect(retry.status).toBe(503);
    const retryData = await retry.json();
    expect(retryData.unresolved).toBe(true);
    const pedidosApos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosApos).toHaveLength(1);
  });

  test("[Modo Sobrevivência] confirmarResgatePontos falha E o SET do rollback também falha: nunca ok:true, pedido fica recovery_required, retry não duplica", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const { reserva } = await prepararRecompensaDisponivel();
    const clientRequestId = "rollback-set-falha-001";

    const redisLib = await import("@/lib/redis");
    const originalEval = defaultEvalImpl;
    const originalSet = defaultSetImpl;
    let jaFalhouEval = false;
    let jaFalhouSetRollback = false;
    vi.mocked(redisLib.redis.eval).mockImplementation((script: string, keys: string[], args: unknown[]) => {
      if (!jaFalhouEval && keys.length === 2) {
        jaFalhouEval = true;
        return Promise.reject(new Error("falha simulada ao confirmar resgate"));
      }
      return originalEval(script, keys, args as string[]);
    });
    vi.mocked(redisLib.redis.set).mockImplementation((key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (key === "pedidos" && jaFalhouEval && !jaFalhouSetRollback) {
        jaFalhouSetRollback = true;
        return Promise.reject(new Error("falha simulada no SET do rollback"));
      }
      return originalSet(key, value, opts);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    const data = await res.json();
    consoleSpy.mockRestore();

    expect(res.status).toBe(503);
    expect(data.ok).toBe(false);
    expect(data.unresolved).toBe(true);

    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].survivalState).toBe("recovery_required");

    vi.mocked(redisLib.redis.set).mockImplementation(originalSet);
    const retry = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    expect(retry.status).toBe(503);
    const retryData = await retry.json();
    expect(retryData.unresolved).toBe(true);
    const pedidosApos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosApos).toHaveLength(1);
  });

  // [Modo Sobrevivência — 4ª revisão, ponto 1] Antes desta correção, o
  // boolean retornado por marcarSurvivalStateDoPedido era IGNORADO: se a
  // transição para "completed" falhasse (mesmo com o resgate JÁ confirmado
  // de verdade), a rota seguia adiante e podia gravar :result e devolver
  // sucesso com o pedido ainda em "pending_critical_confirmation". Os dois
  // testes abaixo provam que essa falha NUNCA mais devolve sucesso nem grava
  // :result — e que, ao contrário da falha de CONFIRMAÇÃO do resgate, aqui
  // NUNCA se tenta reverter o pedido (o débito já aconteceu de verdade).
  test("[Modo Sobrevivência] confirmarResgatePontos funciona, mas o GET usado para marcar survivalState=completed falha: nunca ok:true, nunca grava :result, retry não duplica", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const { reserva } = await prepararRecompensaDisponivel();
    const clientRequestId = "transicao-completed-get-falha-001";
    const chaveResultado = `survival:idempotencia:pedido:${clientRequestId}:result`;

    const redisLib = await import("@/lib/redis");
    const originalGet = defaultGetImpl;
    let contadorPedidosGet = 0;
    vi.mocked(redisLib.redis.get).mockImplementation((key: string) => {
      if (key === "pedidos") {
        contadorPedidosGet += 1;
        // 1ª leitura de "pedidos" = validação pura (sempre acontece); 2ª =
        // busca por hash do clientRequestId (idempotência, também sempre
        // acontece e precisa funcionar normalmente aqui); a partir da 3ª
        // (marcarSurvivalStateDoPedido "completed", e a tentativa
        // best-effort seguinte de "recovery_required") falha.
        if (contadorPedidosGet >= 3) {
          return Promise.reject(new Error("falha simulada ao marcar completed"));
        }
      }
      return originalGet(key);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    const data = await res.json();
    consoleSpy.mockRestore();

    expect(res.status).toBe(503);
    expect(data.ok).toBe(false);
    expect(data.unresolved).toBe(true);
    expect(redisStore.has(chaveResultado)).toBe(false);

    vi.mocked(redisLib.redis.get).mockImplementation(originalGet);
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    // O pedido NUNCA é removido aqui — o resgate já foi debitado de verdade;
    // desfazer o pedido duplicaria o problema (dinheiro debitado sem pedido).
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].survivalState).not.toBe("completed");

    // O resgate JÁ foi debitado de verdade na 1ª tentativa (diferente das
    // falhas de CONFIRMAÇÃO, aqui a reserva vira "confirmado" de verdade) —
    // um retry com o MESMO resgateId é corretamente rejeitado pela proteção
    // de negócio contra reaproveitamento (400, validação pura), nunca chega
    // a criar um segundo pedido nem a expor o estado interno de
    // idempotência. O importante, provado abaixo, é que nada duplica.
    const retry = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    expect(retry.status).toBe(400);
    const pedidosApos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosApos).toHaveLength(1); // retry nunca duplica
  });

  test("[Modo Sobrevivência] confirmarResgatePontos funciona, mas o SET usado para marcar survivalState=completed falha: nunca ok:true, nunca grava :result, retry não duplica", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const { reserva } = await prepararRecompensaDisponivel();
    const clientRequestId = "transicao-completed-set-falha-001";
    const chaveResultado = `survival:idempotencia:pedido:${clientRequestId}:result`;

    const redisLib = await import("@/lib/redis");
    const originalSet = defaultSetImpl;
    let contadorPedidosSet = 0;
    vi.mocked(redisLib.redis.set).mockImplementation((key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (key === "pedidos") {
        contadorPedidosSet += 1;
        // 1º SET de "pedidos" = persistência inicial do pedido (sempre
        // acontece); a partir do 2º (marcarSurvivalStateDoPedido
        // "completed", e a tentativa seguinte de "recovery_required") falha.
        if (contadorPedidosSet >= 2) {
          return Promise.reject(new Error("falha simulada ao marcar completed"));
        }
      }
      return originalSet(key, value, opts);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    const data = await res.json();
    consoleSpy.mockRestore();

    expect(res.status).toBe(503);
    expect(data.ok).toBe(false);
    expect(data.unresolved).toBe(true);
    expect(redisStore.has(chaveResultado)).toBe(false);

    vi.mocked(redisLib.redis.set).mockImplementation(originalSet);
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].survivalState).not.toBe("completed");

    // Mesmo raciocínio do teste de GET acima: o resgate já foi debitado de
    // verdade, então o retry com o MESMO resgateId é rejeitado pela
    // proteção de negócio contra reaproveitamento (400) antes mesmo de
    // chegar à camada de idempotência — o que importa é que nada duplica.
    const retry = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    expect(retry.status).toBe(400);
    const pedidosApos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosApos).toHaveLength(1);
  });

  test("pedido sem resgateId continua funcionando normalmente (sem desconto)", async () => {
    const res = await POST(pedidoRequest());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(50);
    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].resgateId).toBeUndefined();
    expect(pedidosSalvos[0].descontoFidelidade).toBeUndefined();
  });
});
