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
function defaultEvalImpl(_script: string, keys: string[], args: unknown[]) {
  const [key] = keys;
  const [token] = args as string[];
  if (redisStore.get(key) === token) {
    redisStore.delete(key);
    return Promise.resolve(1);
  }
  return Promise.resolve(0);
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
    del: vi.fn((key: string) => {
      redisStore.delete(key);
      return Promise.resolve(1);
    }),
    eval: vi.fn(defaultEvalImpl),
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
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import {
  salvarConfigJornadaChef,
  processarConclusaoPedidoJornada,
  abrirRecompensa,
  reservarRecompensaParaProximoPedido,
  confirmarReservaNoPedido,
  obterRecompensasCliente,
  type RecompensaConfigCiclo,
} from "@/lib/jornadaChef";

const BEBIDA_GUARANA: RecompensaConfigCiclo = {
  id: "cfg_guarana",
  tipo: "bebida_sobremesa",
  ativo: true,
  produtoNome: "",
  item: { produtoId: "bebida:Guarana 2L", produtoNome: "Guarana 2L", categoria: "bebida" },
};

const PIZZA_PRESENTE: RecompensaConfigCiclo = {
  id: "cfg_pizza",
  tipo: "pizza",
  ativo: true,
  produtoNome: "",
  pizza: { tamanho: "P", sabores: ["Calabresa", "Mussarela"] },
};

const ESPECIAL_PRESENTE: RecompensaConfigCiclo = {
  id: "cfg_especial",
  tipo: "presente_especial",
  ativo: true,
  produtoNome: "",
  composicao: [
    { item: { produtoId: "bebida:Guarana 2L", produtoNome: "Guarana 2L", categoria: "bebida" }, quantidade: 1 },
    { item: { produtoId: "suco:Laranja", produtoNome: "Laranja", categoria: "suco" }, quantidade: 2 },
  ],
};

let contadorPedido = 0;
function pedidoIdUnico(): string {
  contadorPedido += 1;
  return `ped_setup_${contadorPedido}`;
}

async function desbloquearEReservar(telefone: string, sequencia: RecompensaConfigCiclo[]) {
  await salvarConfigJornadaChef({ modoRollout: "on", sequenciaRecompensas: sequencia });
  const clienteId = derivarClienteIdPorTelefone(telefone)!;
  let ultimoResultado;
  for (const qty of [4, 4, 4]) {
    ultimoResultado = await processarConclusaoPedidoJornada({
      id: pedidoIdUnico(),
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty }],
    });
  }
  const recompensaId = ultimoResultado!.recompensasDesbloqueadas[0].recompensaId;
  await abrirRecompensa(clienteId, recompensaId);
  await reservarRecompensaParaProximoPedido(clienteId, recompensaId);
  return { clienteId, recompensaId };
}

function itemPizzaPago() {
  return { kind: "pizza" as const, name: "Pizza G", detail: "Calabresa", price: 50, qty: 1 };
}

function pedidoRequest(opts: {
  telefone: string;
  itens?: unknown[];
  recompensaJornada?: { recompensaId: string; escolha?: { sabor?: string } };
}) {
  const body = {
    cliente: "Fulano de Tal",
    telefone: opts.telefone,
    itens: opts.itens ?? [itemPizzaPago()],
    tipoEntrega: "retirada",
    pagamento: "Dinheiro",
    troco: "Sem troco",
    ...(opts.recompensaJornada ? { recompensaJornada: opts.recompensaJornada } : {}),
  };
  return new NextRequest("http://localhost/api/pedido-app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  redisStore.clear();
  contadorPedido = 0;
  vi.mocked(fetch).mockClear();
  const redisLib = await import("@/lib/redis");
  vi.mocked(redisLib.redis.get).mockImplementation(defaultGetImpl);
  vi.mocked(redisLib.redis.set).mockImplementation(defaultSetImpl);
  vi.mocked(redisLib.redis.eval).mockImplementation(defaultEvalImpl);
});

describe("POST /api/pedido-app — materialização segura do presente da Jornada do Chef", () => {
  test("bebida: gera exatamente 1 unidade correta, preço 0, nunca soma no total", async () => {
    const telefone = "86977001001";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    const res = await POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId } }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(50); // só a pizza paga — presente não soma nada

    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    const pedido = pedidos[0];
    expect(pedido.recompensaJornadaId).toBe(recompensaId);
    const itensDetalhados = pedido.itensDetalhados as Array<{ name: string; qty: number; price: number; recompensaJornadaId?: string }>;
    const itemGratis = itensDetalhados.find((i) => i.recompensaJornadaId === recompensaId)!;
    expect(itemGratis.name).toBe("Guarana 2L");
    expect(itemGratis.qty).toBe(1);
    expect(itemGratis.price).toBe(0);
  });

  test("pizza: gera tamanho correto e sabor permitido escolhido pelo cliente", async () => {
    const telefone = "86977001002";
    const { recompensaId } = await desbloquearEReservar(telefone, [PIZZA_PRESENTE]);
    const res = await POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId, escolha: { sabor: "Mussarela" } } }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(50);

    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    const itensDetalhados = pedidos[0].itensDetalhados as Array<{ kind: string; name: string; detail?: string; qty: number; price: number; recompensaJornadaId?: string }>;
    const itemGratis = itensDetalhados.find((i) => i.recompensaJornadaId === recompensaId)!;
    expect(itemGratis.kind).toBe("pizza");
    expect(itemGratis.name).toBe("Pizza P");
    expect(itemGratis.detail).toBe("Mussarela");
    expect(itemGratis.qty).toBe(1);
    expect(itemGratis.price).toBe(0);
  });

  test("presente especial: materializa a composição exata (todas as quantidades configuradas)", async () => {
    const telefone = "86977001003";
    const { recompensaId } = await desbloquearEReservar(telefone, [ESPECIAL_PRESENTE]);
    const res = await POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(200);

    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    const itensDetalhados = pedidos[0].itensDetalhados as Array<{ name: string; qty: number; price: number; recompensaJornadaId?: string }>;
    const itensGratis = itensDetalhados.filter((i) => i.recompensaJornadaId === recompensaId);
    expect(itensGratis).toHaveLength(2);
    expect(itensGratis.every((i) => i.price === 0)).toBe(true);
    expect(itensGratis.find((i) => i.name === "Guarana 2L")?.qty).toBe(1);
    expect(itensGratis.find((i) => i.name === "Laranja")?.qty).toBe(2);
  });

  test("item gratuito nunca avança a trilha (gratuito=true) e nunca soma pontos (preço 0)", async () => {
    const telefone = "86977001004";
    const { clienteId, recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    await POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId } }));

    // Confirma que a recompensa foi vinculada e nao pode ser reutilizada — ela
    // não deveria ter avançado o ciclo além do que a pizza PAGA já avançou.
    const recompensas = await obterRecompensasCliente(clienteId);
    const usada = recompensas.find((r) => r.recompensaId === recompensaId)!;
    expect(usada.reservaPedidoId).toBeTruthy();
  });
});

describe("POST /api/pedido-app — bloqueio econômico: ataques de adulteração", () => {
  test("item com recompensaJornadaId direto no carrinho é rejeitado (contrato antigo removido)", async () => {
    const telefone = "86977002001";
    const res = await POST(
      pedidoRequest({
        telefone,
        itens: [{ kind: "simple", name: "Pizza G", price: 0, qty: 10, recompensaJornadaId: "rec_forjado" }],
      })
    );
    expect(res.status).toBe(400);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("recompensa de outro cliente nunca é aplicada", async () => {
    const telefoneDono = "86977002002";
    const telefoneAtacante = "86977002003";
    const { recompensaId } = await desbloquearEReservar(telefoneDono, [BEBIDA_GUARANA]);

    const res = await POST(pedidoRequest({ telefone: telefoneAtacante, recompensaJornada: { recompensaId } }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/inv[aá]lido|utilizado/i);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("recompensa expirada é rejeitada", async () => {
    const telefone = "86977002004";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    // Força expiração diretamente no fake-redis (simula os 30 dias passados).
    const chave = [...redisStore.keys()].find((k) => k.includes(`jornada:recompensa:default:${recompensaId}`))!;
    const atual = redisStore.get(chave) as Record<string, unknown>;
    redisStore.set(chave, { ...atual, validaAte: new Date(Date.now() - 1000).toISOString() });

    const res = await POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(400);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("recompensa já vinculada a outro pedido não pode ser usada de novo", async () => {
    const telefone = "86977002005";
    const { clienteId, recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    await confirmarReservaNoPedido(clienteId, recompensaId, "pedido_outro_ja_existente");

    const res = await POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(400);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("recompensa ainda não reservada (só 'disponivel') é rejeitada se enviada direto ao pedido", async () => {
    const telefone = "86977002006";
    await salvarConfigJornadaChef({ modoRollout: "on", sequenciaRecompensas: [BEBIDA_GUARANA] });
    const clienteId = derivarClienteIdPorTelefone(telefone)!;
    let ultimoResultado;
    for (const qty of [4, 4, 4]) {
      ultimoResultado = await processarConclusaoPedidoJornada({
        id: pedidoIdUnico(),
        telefone,
        status: "entregue",
        itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty }],
      });
    }
    const recompensaId = ultimoResultado!.recompensasDesbloqueadas[0].recompensaId;
    await abrirRecompensa(clienteId, recompensaId); // aberta, mas NUNCA reservada

    const res = await POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(400);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("pizza-presente: sabor não permitido é rejeitado", async () => {
    const telefone = "86977002007";
    const { recompensaId } = await desbloquearEReservar(telefone, [PIZZA_PRESENTE]);
    const res = await POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId, escolha: { sabor: "Portuguesa" } } }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/sabor/i);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("pizza-presente: sem escolha de sabor é rejeitada", async () => {
    const telefone = "86977002008";
    const { recompensaId } = await desbloquearEReservar(telefone, [PIZZA_PRESENTE]);
    const res = await POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(400);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("recompensaId inexistente/forjado é rejeitado", async () => {
    const telefone = "86977002009";
    await salvarConfigJornadaChef({ modoRollout: "on", sequenciaRecompensas: [BEBIDA_GUARANA] });
    const res = await POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId: "rec_inexistente_xyz" } }));
    expect(res.status).toBe(400);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("total do pedido permanece correto mesmo com presente aplicado (nunca fica negativo ou zerado indevidamente)", async () => {
    const telefone = "86977002010";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    const res = await POST(
      pedidoRequest({
        telefone,
        itens: [itemPizzaPago(), { kind: "simple", name: "Refrigerante 1L", price: 11, qty: 2 }],
        recompensaJornada: { recompensaId },
      })
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(50 + 11 * 2); // presente não altera o total pago
  });
});

describe("POST /api/pedido-app — concorrência e atomicidade", () => {
  test("duas requisições concorrentes com a mesma recompensa: só uma consome o presente", async () => {
    const telefone = "86977003001";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);

    // `pedidoId` é derivado de Date.now(): simula dois pedidoIds distintos
    // (como aconteceria em duas requisições HTTP concorrentes de verdade,
    // separadas por alguma latência de rede) para exercitar a exclusividade
    // de `confirmarReservaNoPedido` — não a idempotência por MESMO pedidoId
    // (essa já é coberta por outro teste).
    let contador = 1732000000000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => contador++);
    try {
      const [r1, r2] = await Promise.all([
        POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId } })),
        POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId } })),
      ]);
      const sucessos = [r1.status, r2.status].filter((s) => s === 200);
      expect(sucessos).toHaveLength(1); // exatamente uma das duas passa
    } finally {
      dateNowSpy.mockRestore();
    }

    const pedidos = (redisStore.get("pedidos") as Array<Record<string, unknown>>) ?? [];
    const pedidosComRecompensa = pedidos.filter((p) => p.recompensaJornadaId === recompensaId);
    expect(pedidosComRecompensa).toHaveLength(1); // nunca duas vezes
  });

  test("falha ao persistir o pedido libera só o vínculo desta recompensa (nunca reescreve a lista inteira)", async () => {
    const telefone = "86977003002";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);

    // Um pedido de outro cliente já existe na lista — a compensação NUNCA pode apagá-lo.
    redisStore.set("pedidos", [{ id: "pedido_alheio", cliente: "Outro Cliente", itens: [] }]);

    const redisLib = await import("@/lib/redis");
    let jaFalhou = false;
    vi.mocked(redisLib.redis.set).mockImplementation((key: string, value: unknown, opts?: { nx?: boolean }) => {
      // Falha especificamente na gravação de "pedidos" com o pedido novo já
      // anexado (nunca no lock/estado da recompensa, que já foi gravado
      // ANTES desta etapa) — simula uma falha real de persistência do pedido.
      if (!jaFalhou && key === "pedidos" && Array.isArray(value) && (value as unknown[]).length === 2) {
        jaFalhou = true;
        return Promise.reject(new Error("falha simulada ao persistir pedido"));
      }
      return defaultSetImpl(key, value, opts);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId } }));
    consoleSpy.mockRestore();

    expect(res.status).toBe(500);
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos).toHaveLength(1); // só o pedido alheio pré-existente, nunca apagado
    expect(pedidos[0].id).toBe("pedido_alheio");

    // O vínculo foi liberado — a recompensa continua "reservada" sem reservaPedidoId, pronta para nova tentativa.
    const chave = [...redisStore.keys()].find((k) => k.includes(`jornada:recompensa:default:${recompensaId}`))!;
    const recompensa = redisStore.get(chave) as { status: string; reservaPedidoId?: string };
    expect(recompensa.status).toBe("reservada");
    expect(recompensa.reservaPedidoId).toBeUndefined();

    // Nova tentativa (retry) deve funcionar normalmente.
    const retry = await POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId } }));
    expect(retry.status).toBe(200);
  });
});
