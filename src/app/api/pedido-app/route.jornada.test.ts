import { vi, describe, test, expect, beforeEach, afterAll } from "vitest";
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
  if (keys.length === 2 && args.length === 3) {
    // GRAVAR_RESULTADO_E_TOKEN_SCRIPT (Modo Sobrevivência)
    const [chaveResultado, chaveToken] = keys;
    const [registroJson, token] = args as string[];
    redisStore.set(chaveResultado, JSON.parse(registroJson));
    redisStore.set(chaveToken, token);
    return Promise.resolve(1);
  }
  if (keys.length === 2 && args.length === 1) {
    // INVALIDAR_RESULTADO_SE_TOKEN_SCRIPT (Modo Sobrevivência)
    const [chaveToken, chaveResultado] = keys;
    const [tokenEsperado] = args as string[];
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
  gerarIdPedidoUnico: vi.fn(async () => Date.now().toString()),
}));

// Sessão da Área do Cliente: token no formato "valid:<telefone>" resolve para
// o clienteId/telefone canônico daquele telefone — qualquer outro valor
// (ausente, adulterado, expirado) nunca autentica. "perfil-removido:<telefone>"
// simula um payload de token tecnicamente válido cujo perfil já não existe.
vi.mock("@/lib/clienteAuth", () => ({
  CLIENTE_COOKIE: "cliente-token",
  verificarTokenCliente: vi.fn(async (token: string) => {
    if (token.startsWith("valid:")) return { clienteId: `cli_${token.slice("valid:".length)}`, telefone: token.slice("valid:".length) };
    if (token.startsWith("perfil-removido:")) return { clienteId: "cli_perfil_removido", telefone: token.slice("perfil-removido:".length) };
    return null;
  }),
}));

vi.mock("@/lib/clientes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/clientes")>("@/lib/clientes");
  return {
    ...actual,
    buscarClientePorId: vi.fn(async (clienteId: string) => {
      if (clienteId === "cli_perfil_removido") return null;
      return { clienteId, telefone: clienteId.replace(/^cli_/, ""), nome: "Fulano de Tal" };
    }),
  };
});

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
  adicionarClienteCanario,
  removerClienteCanario,
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

async function desbloquearEReservar(
  telefone: string,
  sequencia: RecompensaConfigCiclo[],
  configOverrides: Record<string, unknown> = { modoRollout: "on" }
) {
  await salvarConfigJornadaChef({ sequenciaRecompensas: sequencia, ...configOverrides });
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

/** Token de sessão válido da Área do Cliente para o dono deste telefone. */
function tokenDoDono(telefone: string): string {
  return `valid:${telefone}`;
}

function pedidoRequest(opts: {
  telefone: string;
  itens?: unknown[];
  recompensaJornada?: { recompensaId: string; escolha?: { sabor?: string } };
  clienteToken?: string;
  whatsappToken?: string;
  clientRequestId?: string;
}) {
  const body = {
    cliente: "Fulano de Tal",
    telefone: opts.telefone,
    itens: opts.itens ?? [itemPizzaPago()],
    tipoEntrega: "retirada",
    pagamento: "Dinheiro",
    troco: "Sem troco",
    ...(opts.recompensaJornada ? { recompensaJornada: opts.recompensaJornada } : {}),
    ...(opts.whatsappToken ? { whatsappToken: opts.whatsappToken } : {}),
    ...(opts.clientRequestId ? { clientRequestId: opts.clientRequestId } : {}),
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.clienteToken) headers.cookie = `cliente-token=${opts.clienteToken}`;
  return new NextRequest("http://localhost/api/pedido-app", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const AUTH_SECRET_ORIGINAL = process.env.AUTH_SECRET;

beforeEach(async () => {
  redisStore.clear();
  contadorPedido = 0;
  vi.mocked(fetch).mockClear();
  process.env.AUTH_SECRET = "segredo-de-teste-nao-usado-em-producao";
  const redisLib = await import("@/lib/redis");
  vi.mocked(redisLib.redis.get).mockImplementation(defaultGetImpl);
  vi.mocked(redisLib.redis.set).mockImplementation(defaultSetImpl);
  vi.mocked(redisLib.redis.eval).mockImplementation(defaultEvalImpl);
});

afterAll(() => {
  process.env.AUTH_SECRET = AUTH_SECRET_ORIGINAL;
});

describe("POST /api/pedido-app — materialização segura do presente da Jornada do Chef", () => {
  test("bebida: gera exatamente 1 unidade correta, preço 0, nunca soma no total", async () => {
    const telefone = "86977001001";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    const res = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
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
    const res = await POST(
      pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId, escolha: { sabor: "Mussarela" } } })
    );
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
    const res = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(200);

    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    const itensDetalhados = pedidos[0].itensDetalhados as Array<{ name: string; qty: number; price: number; recompensaJornadaId?: string }>;
    const itensGratis = itensDetalhados.filter((i) => i.recompensaJornadaId === recompensaId);
    expect(itensGratis).toHaveLength(2);
    expect(itensGratis.every((i) => i.price === 0)).toBe(true);
    expect(itensGratis.find((i) => i.name === "Guarana 2L")?.qty).toBe(1);
    expect(itensGratis.find((i) => i.name === "Laranja")?.qty).toBe(2);
  });

  test("item gratuito nunca avança a trilha (gratuito=true), nunca soma pontos (preço 0) e nunca conta como pizza paga na fidelidade antiga", async () => {
    const telefone = "86977001004";
    const { clienteId, recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    const res = await POST(
      pedidoRequest({
        telefone,
        clienteToken: tokenDoDono(telefone),
        itens: [itemPizzaPago()], // 1 pizza paga
        recompensaJornada: { recompensaId }, // + 1 bebida grátis
      })
    );
    expect(res.status).toBe(200);

    // A recompensa foi vinculada e não pode ser reutilizada.
    const recompensas = await obterRecompensasCliente(clienteId);
    const usada = recompensas.find((r) => r.recompensaId === recompensaId)!;
    expect(usada.reservaPedidoId).toBeTruthy();

    // pizzasCount (alimenta a fidelidade antiga por contagem de pizzas) conta
    // só a pizza PAGA — a bebida grátis nunca poderia mudar esse número, mas
    // a prova real está no teste de pizzasCount abaixo, com uma pizza-presente.
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].pizzasCount).toBe(1);

    // Pontos por valor (modelo novo) usam só o total pago — a bebida grátis
    // não contribui em nada para o total.
    const data = await res.json();
    expect(data.total).toBe(50);
  });
});

describe("POST /api/pedido-app — pizzasCount nunca inclui a pizza-presente da Jornada (fidelidade antiga)", () => {
  test("1 pizza paga + 1 pizza-presente: pizzasCount = 1 (nunca 2)", async () => {
    const telefone = "86977004001";
    const { recompensaId } = await desbloquearEReservar(telefone, [PIZZA_PRESENTE]);
    const res = await POST(
      pedidoRequest({
        telefone,
        clienteToken: tokenDoDono(telefone),
        itens: [itemPizzaPago()],
        recompensaJornada: { recompensaId, escolha: { sabor: "Calabresa" } },
      })
    );
    expect(res.status).toBe(200);
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].pizzasCount).toBe(1);
  });

  test("só pizza-presente (sem nenhuma pizza paga): pizzasCount = 0", async () => {
    const telefone = "86977004002";
    const { recompensaId } = await desbloquearEReservar(telefone, [PIZZA_PRESENTE]);
    const res = await POST(
      pedidoRequest({
        telefone,
        clienteToken: tokenDoDono(telefone),
        itens: [{ kind: "simple", name: "Refrigerante 1L", price: 11, qty: 1 }],
        recompensaJornada: { recompensaId, escolha: { sabor: "Calabresa" } },
      })
    );
    expect(res.status).toBe(200);
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].pizzasCount).toBeUndefined(); // 0 não é persistido (rule: só grava se > 0)
  });

  test("bebida-presente não altera pizzasCount", async () => {
    const telefone = "86977004003";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    const res = await POST(
      pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), itens: [itemPizzaPago(), itemPizzaPago()], recompensaJornada: { recompensaId } })
    );
    expect(res.status).toBe(200);
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].pizzasCount).toBe(2); // só as 2 pizzas pagas
  });

  test("composição com itens gratuitos não altera pizzasCount", async () => {
    const telefone = "86977004004";
    const { recompensaId } = await desbloquearEReservar(telefone, [ESPECIAL_PRESENTE]);
    const res = await POST(
      pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), itens: [itemPizzaPago()], recompensaJornada: { recompensaId } })
    );
    expect(res.status).toBe(200);
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidos[0].pizzasCount).toBe(1);
  });
});

describe("POST /api/pedido-app — autorização do presente pela sessão da Área do Cliente", () => {
  test("pedido comum sem presente continua funcionando como convidado (sem cookie)", async () => {
    const res = await POST(pedidoRequest({ telefone: "86977005000" }));
    expect(res.status).toBe(200);
  });

  test("recompensaJornada sem cookie de sessão retorna 401 e não cria o pedido", async () => {
    const telefone = "86977005001";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    const res = await POST(pedidoRequest({ telefone, recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(401);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("recompensaJornada com cookie inválido/adulterado retorna 401 e não cria o pedido", async () => {
    const telefone = "86977005002";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    const res = await POST(pedidoRequest({ telefone, clienteToken: "token-adulterado-xyz", recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(401);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("cookie tecnicamente válido mas cujo perfil já não existe retorna 401", async () => {
    const telefone = "86977005003";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    const res = await POST(pedidoRequest({ telefone, clienteToken: `perfil-removido:${telefone}`, recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(401);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("telefone do body diferente do telefone canônico da sessão é rejeitado (nunca transfere a recompensa)", async () => {
    const telefoneDono = "86977005004";
    const outroTelefoneNoBody = "86977005999";
    const { recompensaId } = await desbloquearEReservar(telefoneDono, [BEBIDA_GUARANA]);
    const res = await POST(
      pedidoRequest({ telefone: outroTelefoneNoBody, clienteToken: tokenDoDono(telefoneDono), recompensaJornada: { recompensaId } })
    );
    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.error).toMatch(/telefone/i);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("telefone igual, mas formatado diferente do body, funciona após normalização", async () => {
    const telefone = "86977005005";
    const telefoneFormatado = `(86) 97700-5005`; // mesmos dígitos, formatação diferente
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    const res = await POST(
      pedidoRequest({ telefone: telefoneFormatado, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } })
    );
    expect(res.status).toBe(200);
  });

  test("recompensa de outro perfil é rejeitada mesmo com sessão válida do atacante (para si mesmo)", async () => {
    const telefoneDono = "86977005006";
    const telefoneAtacante = "86977005007";
    const { recompensaId } = await desbloquearEReservar(telefoneDono, [BEBIDA_GUARANA]);

    const res = await POST(
      pedidoRequest({ telefone: telefoneAtacante, clienteToken: tokenDoDono(telefoneAtacante), recompensaJornada: { recompensaId } })
    );
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/inv[aá]lido|utilizado/i);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("cliente removido do canário não consegue concluir o resgate mesmo com sessão válida", async () => {
    const telefone = "86977005008";
    // Precisa estar no canário ANTES de creditar/reservar (senão o crédito
    // nem acontece, já que jornadaAtivaParaCliente bloquearia desde o início).
    const { idPublico } = await adicionarClienteCanario(telefone);
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA], { modoRollout: "canary" });
    await removerClienteCanario(idPublico);

    const res = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(400);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("modo canary com cliente autorizado consegue concluir o resgate", async () => {
    const telefone = "86977005009";
    await adicionarClienteCanario(telefone);
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA], { modoRollout: "canary" });

    const res = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(200);
  });

  test("modo off bloqueia o resgate mesmo com sessão válida do dono", async () => {
    const telefone = "86977005010";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    await salvarConfigJornadaChef({ modoRollout: "off" });

    const res = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(400);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("whatsappToken isolado nunca autoriza a recompensa (só o cookie de sessão do cliente autoriza)", async () => {
    const telefone = "86977005011";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    const res = await POST(pedidoRequest({ telefone, whatsappToken: "qualquer-coisa-nao-mockada", recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(401);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("sessão válida do proprietário consegue usar bebida, pizza e presente especial", async () => {
    const casos: { telefone: string; sequencia: RecompensaConfigCiclo[]; escolha?: { sabor: string } }[] = [
      { telefone: "86977005012", sequencia: [BEBIDA_GUARANA] },
      { telefone: "86977005013", sequencia: [PIZZA_PRESENTE], escolha: { sabor: "Calabresa" } },
      { telefone: "86977005014", sequencia: [ESPECIAL_PRESENTE] },
    ];
    for (const { telefone, sequencia, escolha } of casos) {
      const { recompensaId } = await desbloquearEReservar(telefone, sequencia);
      const res = await POST(
        pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId, ...(escolha ? { escolha } : {}) } })
      );
      expect(res.status).toBe(200);
    }
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

  test("recompensa expirada é rejeitada", async () => {
    const telefone = "86977002004";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    // Força expiração diretamente no fake-redis (simula os 30 dias passados).
    const chave = [...redisStore.keys()].find((k) => k.includes(`jornada:recompensa:default:${recompensaId}`))!;
    const atual = redisStore.get(chave) as Record<string, unknown>;
    redisStore.set(chave, { ...atual, validaAte: new Date(Date.now() - 1000).toISOString() });

    const res = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(400);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("recompensa já vinculada a outro pedido não pode ser usada de novo", async () => {
    const telefone = "86977002005";
    const { clienteId, recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    await confirmarReservaNoPedido(clienteId, recompensaId, "pedido_outro_ja_existente");

    const res = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
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

    const res = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(400);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("pizza-presente: sabor não permitido é rejeitado", async () => {
    const telefone = "86977002007";
    const { recompensaId } = await desbloquearEReservar(telefone, [PIZZA_PRESENTE]);
    const res = await POST(
      pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId, escolha: { sabor: "Portuguesa" } } })
    );
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/sabor/i);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("pizza-presente: sem escolha de sabor é rejeitada", async () => {
    const telefone = "86977002008";
    const { recompensaId } = await desbloquearEReservar(telefone, [PIZZA_PRESENTE]);
    const res = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
    expect(res.status).toBe(400);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("recompensaId inexistente/forjado é rejeitado", async () => {
    const telefone = "86977002009";
    await salvarConfigJornadaChef({ modoRollout: "on", sequenciaRecompensas: [BEBIDA_GUARANA] });
    const res = await POST(
      pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId: "rec_inexistente_xyz" } })
    );
    expect(res.status).toBe(400);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("total do pedido permanece correto mesmo com presente aplicado (nunca fica negativo ou zerado indevidamente)", async () => {
    const telefone = "86977002010";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    const res = await POST(
      pedidoRequest({
        telefone,
        clienteToken: tokenDoDono(telefone),
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
        POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } })),
        POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } })),
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
    const res = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
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
    const retry = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
    expect(retry.status).toBe(200);
  });

  // [7ª revisão de segurança, ponto 5] Sem clientRequestId (o caminho ATIVO
  // hoje, com todas as flags desligadas), uma falha na PRÓPRIA liberação do
  // vínculo da recompensa (não só na persistência do pedido) nunca pode ser
  // engolida com `.catch(() => {})` — precisa virar 503 "unresolved", nunca
  // um 500 que finja ter liberado a recompensa sem prova nenhuma.
  test("[7ª revisão] sem clientRequestId: falha ao persistir + falha AO LIBERAR o vínculo retorna 503 unresolved, nunca finge sucesso na liberação", async () => {
    const telefone = "86977003009";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);

    const redisLib = await import("@/lib/redis");
    let persistenciaJaFalhou = false;
    const chaveRecompensa = `jornada:recompensa:default:${recompensaId}`;
    vi.mocked(redisLib.redis.set).mockImplementation((key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (!persistenciaJaFalhou && key === "pedidos" && Array.isArray(value) && (value as unknown[]).length === 1) {
        persistenciaJaFalhou = true;
        return Promise.reject(new Error("falha simulada ao persistir pedido"));
      }
      // Depois que a persistência falhou, a PRÓPRIA liberação do vínculo
      // (salvarRecompensa, dentro de liberarVinculoRecompensaPedidoNaoCriado)
      // também falha — nunca há como comprovar que a recompensa foi solta.
      if (persistenciaJaFalhou && key === chaveRecompensa) {
        return Promise.reject(new Error("falha simulada ao liberar vinculo da recompensa"));
      }
      return defaultSetImpl(key, value, opts);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
    consoleSpy.mockRestore();

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.unresolved).toBe(true);
    // Nunca vaza cliente/telefone na mensagem de erro.
    expect(JSON.stringify(data)).not.toContain(telefone);

    // O pedido nunca foi criado; a recompensa continua vinculada ao pedido
    // que nunca existiu (estado incerto, nunca silenciosamente "liberada").
    const pedidos = (redisStore.get("pedidos") as Array<Record<string, unknown>>) ?? [];
    expect(pedidos).toHaveLength(0);
  });

  // Caminho normal (compensação bem-sucedida) continua devolvendo 500, como
  // antes desta correção — o 503 só aparece quando a liberação em si falha.
  test("[7ª revisão] sem clientRequestId: falha ao persistir + liberação do vínculo bem-sucedida mantém o 500 de sempre", async () => {
    const telefone = "86977003010";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);

    const redisLib = await import("@/lib/redis");
    let jaFalhou = false;
    vi.mocked(redisLib.redis.set).mockImplementation((key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (!jaFalhou && key === "pedidos" && Array.isArray(value) && (value as unknown[]).length === 1) {
        jaFalhou = true;
        return Promise.reject(new Error("falha simulada ao persistir pedido"));
      }
      return defaultSetImpl(key, value, opts);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
    consoleSpy.mockRestore();

    expect(res.status).toBe(500);
    const chave = `jornada:recompensa:default:${recompensaId}`;
    const recompensa = redisStore.get(chave) as { status: string; reservaPedidoId?: string };
    expect(recompensa.status).toBe("reservada");
    expect(recompensa.reservaPedidoId).toBeUndefined();
  });

  // [4ª revisão — ponto 4] Antes desta correção, só o catch da PERSISTÊNCIA
  // (redis.set("pedidos", ...)) liberava o vínculo da recompensa — uma falha
  // em qualquer passo ANTERIOR a isso (proximoNumeroPedido, preparação do
  // Pix) escapava sem compensação, deixando `reservaPedidoId` preso
  // indefinidamente. Este teste força a falha em `proximoNumeroPedido`
  // (chamado DEPOIS do vínculo da Jornada, ANTES da persistência) e prova
  // que a recompensa é liberada mesmo assim.
  test("falha entre o vínculo da recompensa e a persistência (ex.: proximoNumeroPedido) também libera o vínculo — nunca fica preso", async () => {
    const telefone = "86977003003";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);

    const numeracaoLib = await import("@/lib/numeracao");
    vi.mocked(numeracaoLib.proximoNumeroPedido).mockRejectedValueOnce(new Error("falha simulada em proximoNumeroPedido"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
    consoleSpy.mockRestore();

    expect(res.status).toBe(500);
    const pedidos = (redisStore.get("pedidos") as Array<Record<string, unknown>>) ?? [];
    expect(pedidos).toHaveLength(0);

    // O vínculo foi liberado mesmo com a falha ocorrendo ANTES do try/catch
    // de persistência — a recompensa continua "reservada" sem reservaPedidoId.
    const chave = [...redisStore.keys()].find((k) => k.includes(`jornada:recompensa:default:${recompensaId}`))!;
    const recompensa = redisStore.get(chave) as { status: string; reservaPedidoId?: string };
    expect(recompensa.status).toBe("reservada");
    expect(recompensa.reservaPedidoId).toBeUndefined();

    // Retry funciona normalmente, reaproveitando a mesma recompensa.
    const retry = await POST(pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId } }));
    expect(retry.status).toBe(200);
    expect((redisStore.get("pedidos") as unknown[]).length).toBe(1);
  });

  // [6ª revisão de segurança, ponto 1] Antes desta correção, a rota validava
  // a disponibilidade da recompensa da Jornada (prepararResgateParaPedido)
  // ANTES de consultar :result/pedido-por-hash. Se o presente já tivesse
  // sido vinculado a um pedido com sucesso mas a resposta original se
  // perdesse (timeout), um retry legítimo com o MESMO clientRequestId batia
  // primeiro na validação de negócio — que rejeitaria a recompensa como
  // "já utilizada" (ela realmente está reservaPedidoId != vazio agora) antes
  // de a rota sequer olhar para o pedido já criado. Agora a recuperação de
  // idempotência roda antes: o retry encontra o pedido pelo hash e devolve o
  // MESMO pedido, nunca reavaliando a recompensa.
  test("[6ª revisão] retry com resposta perdida após presente da Jornada confirmado recupera o MESMO pedido via hash, nunca reavalia a recompensa como indisponível", async () => {
    const telefone = "86977003005";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    const clientRequestId = "retry-apos-jornada-confirmada-001";

    process.env.SURVIVAL_MODE_ENABLED = "true";
    try {
      const r1 = await POST(
        pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId }, clientRequestId })
      );
      expect(r1.status).toBe(200);
      const body1 = await r1.json();

      // Simula resposta perdida do lado do cliente + :result/:claim já
      // desaparecidos (TTL ou nunca gravados) — só o pedido real (com o
      // hash) resta em Redis.
      const chaveResultado = `survival:idempotencia:pedido:${clientRequestId}:result`;
      const chaveClaim = `survival:idempotencia:pedido:${clientRequestId}:claim`;
      redisStore.delete(chaveResultado);
      redisStore.delete(chaveClaim);

      const retry = await POST(
        pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId }, clientRequestId })
      );
      expect(retry.status).toBe(200);
      const body2 = await retry.json();
      expect(body2.pedidoId).toBe(body1.pedidoId);

      const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
      expect(pedidos).toHaveLength(1); // nunca duplica
    } finally {
      delete process.env.SURVIVAL_MODE_ENABLED;
    }
  });

  // [7ª revisão de segurança, ponto 1] Caso mais difícil que o da 6ª
  // revisão acima: o PEDIDO NUNCA chegou a ser persistido, só o :attempt
  // sobrevive, E a recompensa aparece VINCULADA ao pedidoId dessa mesma
  // tentativa (`reservaPedidoId` já setado — por exemplo, por uma execução
  // concorrente que chegou a vincular mas não a persistir, ou por qualquer
  // outra causa externa). Antes desta correção, um retry caía direto na
  // FASE 3 e `prepararResgateParaPedido` veria a recompensa como
  // "reservada" (não mais "disponível") e rejeitaria com 400 — mesmo a
  // vinculação já sendo exatamente a mesma tentativa/pedidoId. Agora a
  // FASE 2 encontra o :attempt e pula a FASE 3 inteira: `confirmarReservaNoPedido`
  // (idempotente, FASE 5) simplesmente confirma a MESMA vinculação de novo.
  test("[7ª revisão] recompensa da Jornada aparece vinculada ao MESMO pedidoId do attempt: retry reutiliza o checkout oficial, nunca reavalia a recompensa como indisponível", async () => {
    const telefone = "86977003006";
    const { recompensaId } = await desbloquearEReservar(telefone, [BEBIDA_GUARANA]);
    const clientRequestId = "attempt-jornada-vinculada-sem-persistir-001";

    process.env.SURVIVAL_MODE_ENABLED = "true";
    try {
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
      const r1 = await POST(
        pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId }, clientRequestId })
      );
      consoleSpy.mockRestore();
      expect(r1.status).toBe(500);
      expect(redisStore.get("pedidos")).toBeUndefined();

      vi.mocked(redisLib.redis.set).mockImplementation(defaultSetImpl);

      // A falha de persistência já foi COMPROVADA ausente, então a
      // compensação (round 5/6) liberou o vínculo de volta a "disponível" —
      // simula aqui a recompensa reaparecendo VINCULADA ao MESMO pedidoId
      // do attempt (por qualquer causa externa à tentativa em si): o ponto
      // do teste é que a FASE 3, se rodasse de novo, rejeitaria isso como
      // "já utilizada" mesmo sendo exatamente esta tentativa.
      const chaveAttempt = `survival:idempotencia:pedido:${clientRequestId}:attempt`;
      const attemptGravado = redisStore.get(chaveAttempt) as { pedidoId: string };
      const chaveRecompensa = [...redisStore.keys()].find((k) => k.includes(`jornada:recompensa:default:${recompensaId}`))!;
      const recompensaAtual = redisStore.get(chaveRecompensa) as Record<string, unknown>;
      redisStore.set(chaveRecompensa, { ...recompensaAtual, status: "reservada", reservaPedidoId: attemptGravado.pedidoId });

      const retry = await POST(
        pedidoRequest({ telefone, clienteToken: tokenDoDono(telefone), recompensaJornada: { recompensaId }, clientRequestId })
      );
      expect(retry.status).toBe(200);
      const body = await retry.json();

      const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
      expect(pedidos).toHaveLength(1); // nunca duplica
      expect(pedidos[0].id).toBe(body.pedidoId);
      expect(pedidos[0].recompensaJornadaId).toBe(recompensaId);
    } finally {
      delete process.env.SURVIVAL_MODE_ENABLED;
    }
  });
});
