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

// Replica os scripts Lua reais usados neste teste, sem interpretar Lua:
// - 1 chave: liberarLockPontosSeDono (GET==token -> DEL) OU
//   LIBERAR_CLAIM_SE_DONO_SCRIPT (mesmo formato) — indistinguíveis por
//   design, mesma semântica de compare-and-delete simples.
// - 2 chaves + 2 args: persistirEstadoPontosSeDono (fidelidade) —
//   GET(lock)==token -> SET(estado).
// - 2 chaves + 3 args: GRAVAR_RESULTADO_E_TOKEN_SCRIPT (Modo Sobrevivência)
//   — grava registro+token juntos, incondicional.
// - 2 chaves + 1 arg: INVALIDAR_RESULTADO_SE_TOKEN_SCRIPT (Modo
//   Sobrevivência) — compare-and-delete atômico do par registro/token.
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
  if (keys.length === 2 && args.length === 3) {
    const [chaveResultado, chaveToken] = keys;
    const [registroJson, token] = args;
    redisStore.set(chaveResultado, JSON.parse(registroJson));
    redisStore.set(chaveToken, token);
    return Promise.resolve(1);
  }
  if (keys.length === 2 && args.length === 1) {
    const [chaveToken, chaveResultado] = keys;
    const [tokenEsperado] = args;
    const tokenAtual = redisStore.has(chaveToken) ? redisStore.get(chaveToken) : undefined;
    const resultadoAtual = redisStore.has(chaveResultado) ? redisStore.get(chaveResultado) : undefined;
    if (tokenAtual === undefined && resultadoAtual === undefined) return Promise.resolve("ja_ausente");
    if (resultadoAtual === undefined) {
      redisStore.delete(chaveToken);
      return Promise.resolve("ja_ausente");
    }
    if (tokenAtual === undefined) return Promise.resolve("incerto");
    if (tokenAtual === tokenEsperado) {
      redisStore.delete(chaveToken);
      redisStore.delete(chaveResultado);
      return Promise.resolve("removido");
    }
    return Promise.resolve("substituido_por_outro");
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
  confirmarResgatePontos,
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

    // Revisão de segurança, 6ª rodada, ponto 1: a recuperação de
    // idempotência (busca por hash/attempt) roda ANTES de qualquer
    // validação de negócio mutável — o retry com o MESMO clientRequestId
    // encontra o pedido pelo hash, vê o survivalState ainda bloqueando
    // sucesso, e devolve 503 unresolved diretamente, sem sequer chegar a
    // reavaliar o resgateId (que já foi debitado de verdade e seria
    // rejeitado como "já utilizado" se a validação de negócio rodasse
    // primeiro). Nada duplica em nenhum dos dois casos.
    const retry = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    expect(retry.status).toBe(503);
    const retryData = await retry.json();
    expect(retryData.unresolved).toBe(true);
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

    // Mesmo raciocínio do teste de GET acima: a recuperação de idempotência
    // roda ANTES da validação de negócio do resgate — o retry encontra o
    // pedido pelo hash e devolve 503 unresolved diretamente.
    const retry = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    expect(retry.status).toBe(503);
    const retryData = await retry.json();
    expect(retryData.unresolved).toBe(true);
    const pedidosApos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosApos).toHaveLength(1);
  });

  // [6ª revisão de segurança, ponto 1] Antes desta correção, a rota validava
  // o resgateId (obterReservasResgatePontos, rejeita "já utilizado") ANTES
  // de consultar :result/pedido-por-hash. Se o resgate já tivesse sido
  // confirmado com sucesso mas a resposta original se perdesse (timeout),
  // um retry legítimo com o MESMO clientRequestId batia primeiro na
  // validação de negócio — que rejeitaria com 400 "resgate inválido ou já
  // utilizado" antes de a rota sequer olhar para o pedido já criado. Agora a
  // recuperação de idempotência roda antes: o retry encontra o pedido pelo
  // hash e devolve o MESMO pedido, nunca reavaliando o resgateId.
  test("[6ª revisão] retry com resposta perdida após resgate confirmado com sucesso recupera o MESMO pedido via hash, nunca reavalia o resgateId como já utilizado", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const { reserva } = await prepararRecompensaDisponivel();
    const clientRequestId = "retry-apos-resgate-confirmado-001";

    const r1 = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    expect(r1.status).toBe(200);
    const body1 = await r1.json();

    // Simula resposta perdida do lado do cliente + :result/:claim já
    // desaparecidos — só o pedido real (com o hash) resta em Redis.
    const chaveResultado = `survival:idempotencia:pedido:${clientRequestId}:result`;
    const chaveClaim = `survival:idempotencia:pedido:${clientRequestId}:claim`;
    redisStore.delete(chaveResultado);
    redisStore.delete(chaveClaim);

    const retry = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    expect(retry.status).toBe(200);
    const body2 = await retry.json();
    expect(body2.pedidoId).toBe(body1.pedidoId);

    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos).toHaveLength(1); // nunca duplica
  });

  // [7ª revisão de segurança, ponto 1] Caso mais difícil: o pedido NUNCA
  // chegou a ser persistido (a resposta se perdeu ANTES da escrita, não
  // depois) — só o :attempt sobrevive. Antes desta correção, um retry caía
  // direto na FASE 3 e revalidava `obterReservasResgatePontos` — se o
  // status da reserva mudasse de "reservado" para qualquer outra coisa
  // ANTES do retry (por qualquer motivo externo à tentativa em si), o
  // retry legítimo era rejeitado com 400 "resgate inválido ou já utilizado"
  // mesmo a identidade/cobrança já tendo sido reivindicada. Agora a FASE 2
  // encontra o :attempt e pula a FASE 3 inteira: o retry reconstrói o
  // MESMO pedido a partir do checkout oficial já validado, sem consultar
  // `obterReservasResgatePontos` de novo.
  test("[7ª revisão] status do resgate muda de 'reservado' para 'confirmado' antes do retry: retry reutiliza o checkout oficial, nunca reavalia o resgate", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const { clienteId, reserva } = await prepararRecompensaDisponivel();
    const clientRequestId = "attempt-resgate-muda-status-001";

    const redisLib = await import("@/lib/redis");
    let jaFalhouPersistencia = false;
    vi.mocked(redisLib.redis.set).mockImplementation((key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (key === "pedidos" && !jaFalhouPersistencia && Array.isArray(value)) {
        jaFalhouPersistencia = true;
        return Promise.reject(new Error("falha simulada ao persistir pedido (resposta perdida antes da escrita)"));
      }
      return defaultSetImpl(key, value, opts);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r1 = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    consoleSpy.mockRestore();
    expect(r1.status).toBe(500);
    expect(redisStore.get("pedidos")).toBeUndefined();

    vi.mocked(redisLib.redis.set).mockImplementation(defaultSetImpl);

    // O status da reserva muda para "utilizado" ANTES do retry — usando o
    // MESMO pedidoId já reivindicado pelo attempt (para que a confirmação
    // que a rota fará no retry seja idempotente, `eventoId` batendo, em vez
    // de tentar confirmar de novo uma reserva já "utilizada" por outro
    // pedidoId, o que geraria um 409 genuíno e não testaria o que importa
    // aqui: que a FASE 3 nunca revalida o STATUS do resgate).
    const chaveAttempt = `survival:idempotencia:pedido:${clientRequestId}:attempt`;
    const attemptGravado = redisStore.get(chaveAttempt) as { pedidoId: string };
    await confirmarResgatePontos(clienteId, reserva.resgateId, attemptGravado.pedidoId);
    const reservasAtuais = await obterReservasResgatePontos(clienteId);
    expect(reservasAtuais.find((r) => r.resgateId === reserva.resgateId)?.status).toBe("confirmado");

    const retry = await POST(pedidoRequest({ resgateId: reserva.resgateId, clientRequestId }));
    expect(retry.status).toBe(200);
    const body = await retry.json();
    expect(body.total).toBe(0); // desconto integral, igual à tentativa original
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos).toHaveLength(1); // nunca duplica
    expect(pedidos[0].id).toBe(body.pedidoId);
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
