// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const CARDAPIO_TESTE = {
  sizes: [], saltyFlavors: [], sweetFlavors: [], borders: [],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }, { name: "Água com gás", price: 6 }],
  sucos: [], neighborhoods: [],
};

const CARDAPIO_PIZZA_OPCIONAIS = {
  ...CARDAPIO_TESTE,
  pizzaCatalog: {
    sizes: [{ id: "pizza-p", code: "P", label: "Pequena", fatias: 4 }],
    flavors: [{ id: "mussarela", name: "Mussarela", category: "tradicional", ingredients: "", available: true, pricesBySizeCode: { P: 3300 } }],
    borders: [{ id: "borda-catupiry", label: "Catupiry", available: true, pricesBySizeCode: { P: 500, M: 500, G: 500, F: 500 } }],
    addOns: [{ id: "add-bacon", label: "Bacon", available: true, pricesBySizeCode: { P: 700, M: 700, G: 700, F: 700 } }],
  },
};

const CARDAPIO_PRODUTO_ADICIONAL = {
  ...CARDAPIO_TESTE,
  catalog: {
    lanches: [], hamburgueres: [], calzone: [], pastelForno: [],
    macarronadas: [{
      id: "mac-teste", name: "Macarronada Teste", priceCents: 3000, available: true, strategy: "size",
      sizes: [{ id: "mac-p", code: "P", priceCents: 3000 }],
      addOnGroup: { max: 1, options: [{ id: "add-ovo", label: "Ovo", priceCents: 500, available: true }] },
    }],
    sucos: [], vitaminas: [], bebidas: [],
  },
};

type ItemMock = { kind: "simple" | "pizza"; name: string; detail?: string; price: number; qty: number };
type RodadaMock = {
  id: string; numero: number; status: "rascunho" | "enviando" | "enviada" | "falha_envio";
  itens: ItemMock[]; subtotal: number; criadaEm: string; atualizadaEm: string;
  enviadaEm?: string; pedidoId?: string; pedidoNumero?: number;
  pedidoStatus?: "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado";
  pedidoStatusAtualizadoEm?: string; erroUltimaTentativa?: string;
};
type ComandaMock = {
  id: string; numero: number; cliente?: string; mesa?: string; complemento?: string;
  itens: ItemMock[]; status: "aberta" | "enviada" | "fechada"; abertaEm: string;
  pedidoId?: string; pedidoNumero?: number; rodadas: RodadaMock[];
};

function subtotalDe(itens: ItemMock[]) { return itens.reduce((s, i) => s + i.price * i.qty, 0); }
function totalParcialDe(c: ComandaMock) { return c.rodadas.reduce((s, r) => s + r.subtotal, 0); }
function precoOficial(name: string): number | null {
  const b = CARDAPIO_TESTE.bebidas.find((x) => x.name === name);
  return b ? b.price : null;
}

let seq = 0;
let comandas: ComandaMock[] = [];
let falharProximoEnvio = false;
let falharProximaListagem = false;
let falharProximoSalvamentoItens = false;
let enviosCriados = 0;
let cardapioAtual: unknown = CARDAPIO_TESTE;

function resetMock() {
  seq = 0;
  comandas = [];
  falharProximoEnvio = false;
  falharProximaListagem = false;
  falharProximoSalvamentoItens = false;
  enviosCriados = 0;
  cardapioAtual = CARDAPIO_TESTE;
}

function jsonRes(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

async function mockFetch(url: string, opts?: RequestInit): Promise<Response> {
  const method = (opts?.method || "GET").toUpperCase();
  const body = opts?.body ? JSON.parse(String(opts.body)) : {};

  if (url === "/api/cardapio" && method === "GET") return jsonRes(200, cardapioAtual);
  if (url === "/api/salao/logout") return jsonRes(200, { ok: true });

  if (url === "/api/salao/comandas" && method === "GET") {
    if (falharProximaListagem) {
      falharProximaListagem = false;
      return jsonRes(503, { ok: false, error: "Falha simulada de sincronização" });
    }
    return jsonRes(200, { ok: true, comandas: comandas.map((c) => ({ ...c, totalParcial: totalParcialDe(c) })) });
  }

  if (url === "/api/salao/comandas" && method === "POST") {
    const cliente = String(body.cliente || "").trim() || undefined;
    const mesa = body.mesa ? String(body.mesa).trim() || undefined : undefined;
    if (mesa && comandas.some((c) => c.mesa === mesa && c.status !== "fechada")) {
      return jsonRes(409, { ok: false, error: "Esta mesa já tem uma comanda aberta" });
    }
    seq += 1;
    const agora = new Date().toISOString();
    const nova: ComandaMock = {
      id: `comanda_${seq}`, numero: seq, ...(cliente ? { cliente } : {}), mesa, itens: [], status: "aberta", abertaEm: agora,
      rodadas: [{ id: `rodada_${seq}_1`, numero: 1, status: "rascunho", itens: [], subtotal: 0, criadaEm: agora, atualizadaEm: agora }],
    };
    comandas.push(nova);
    return jsonRes(200, { ok: true, comanda: nova });
  }

  const patchCliente = url.match(/^\/api\/salao\/comandas\/([^/]+)\/cliente$/);
  if (patchCliente && method === "PATCH") {
    const c = comandas.find((x) => x.id === patchCliente[1]);
    if (!c) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });
    const cliente = String(body.cliente || "").trim();
    if (!cliente) return jsonRes(400, { ok: false, error: "Informe o nome do cliente" });
    c.cliente = cliente;
    return jsonRes(200, { ok: true, comanda: c });
  }

  const patchComanda = url.match(/^\/api\/salao\/comandas\/([^/]+)$/);
  if (patchComanda && method === "PATCH") {
    const c = comandas.find((x) => x.id === patchComanda[1]);
    if (!c) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });
    if (falharProximoSalvamentoItens) {
      falharProximoSalvamentoItens = false;
      return jsonRes(503, { ok: false, error: "Falha simulada ao salvar itens" });
    }
    const itens: ItemMock[] = (body.itens || []).map((i: ItemMock) => ({ ...i, price: precoOficial(i.name) ?? i.price }));
    c.itens = itens;
    c.rodadas[0].itens = itens;
    c.rodadas[0].subtotal = subtotalDe(itens);
    return jsonRes(200, { ok: true, comanda: c });
  }

  const enviarComanda = url.match(/^\/api\/salao\/comandas\/([^/]+)\/enviar$/);
  if (enviarComanda && method === "POST") {
    const c = comandas.find((x) => x.id === enviarComanda[1]);
    if (!c) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });
    if (c.itens.length === 0) return jsonRes(422, { ok: false, error: "Adicione pelo menos um item antes de enviar" });
    if (!c.cliente?.trim()) return jsonRes(422, { ok: false, error: "Informe o nome do cliente antes de enviar" });
    if (falharProximoEnvio) { falharProximoEnvio = false; return jsonRes(500, { ok: false, error: "Falha simulada ao criar o pedido" }); }
    enviosCriados += 1;
    c.status = "enviada";
    c.pedidoId = `ped_${seq}`;
    c.pedidoNumero = enviosCriados;
    c.rodadas[0].status = "enviada";
    c.rodadas[0].enviadaEm = new Date().toISOString();
    c.rodadas[0].pedidoId = c.pedidoId;
    c.rodadas[0].pedidoNumero = c.pedidoNumero;
    c.rodadas[0].pedidoStatus = "novo";
    return jsonRes(200, { ok: true, pedidoId: c.pedidoId, pedidoNumero: c.pedidoNumero, total: subtotalDe(c.itens), comanda: c });
  }

  const criarRodada = url.match(/^\/api\/salao\/comandas\/([^/]+)\/rodadas$/);
  if (criarRodada && method === "POST") {
    const c = comandas.find((x) => x.id === criarRodada[1]);
    if (!c) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });
    const existente = c.rodadas.find((r) => r.status !== "enviada");
    if (existente) return jsonRes(200, { ok: true, rodada: existente, criada: false, comanda: c });
    const agora = new Date().toISOString();
    const numero = Math.max(...c.rodadas.map((r) => r.numero)) + 1;
    const nova: RodadaMock = { id: `rodada_${c.id}_${numero}`, numero, status: "rascunho", itens: [], subtotal: 0, criadaEm: agora, atualizadaEm: agora };
    c.rodadas.push(nova);
    return jsonRes(200, { ok: true, rodada: nova, criada: true, comanda: c });
  }

  const patchRodada = url.match(/^\/api\/salao\/comandas\/([^/]+)\/rodadas\/([^/]+)$/);
  if (patchRodada && method === "PATCH") {
    const c = comandas.find((x) => x.id === patchRodada[1]);
    const r = c?.rodadas.find((x) => x.id === patchRodada[2]);
    if (!c || !r) return jsonRes(404, { ok: false, error: "Rodada não encontrada" });
    if (falharProximoSalvamentoItens) {
      falharProximoSalvamentoItens = false;
      return jsonRes(503, { ok: false, error: "Falha simulada ao salvar itens" });
    }
    const itens: ItemMock[] = (body.itens || []).map((i: ItemMock) => ({ ...i, price: precoOficial(i.name) ?? i.price }));
    r.itens = itens;
    r.subtotal = subtotalDe(itens);
    return jsonRes(200, { ok: true, rodada: r, comanda: c, totalParcial: totalParcialDe(c) });
  }

  const enviarRodada = url.match(/^\/api\/salao\/comandas\/([^/]+)\/rodadas\/([^/]+)\/enviar$/);
  if (enviarRodada && method === "POST") {
    const c = comandas.find((x) => x.id === enviarRodada[1]);
    const r = c?.rodadas.find((x) => x.id === enviarRodada[2]);
    if (!c || !r) return jsonRes(404, { ok: false, error: "Rodada não encontrada" });
    if (r.itens.length === 0) return jsonRes(422, { ok: false, error: "Adicione pelo menos um item antes de enviar" });
    if (!c.cliente?.trim()) return jsonRes(422, { ok: false, error: "Informe o nome do cliente antes de enviar" });
    if (falharProximoEnvio) {
      falharProximoEnvio = false;
      r.status = "falha_envio";
      r.erroUltimaTentativa = "Falha simulada ao criar o pedido";
      return jsonRes(500, { ok: false, error: "Falha simulada ao criar o pedido" });
    }
    enviosCriados += 1;
    r.status = "enviada";
    r.enviadaEm = new Date().toISOString();
    r.pedidoId = `ped_${enviosCriados}`;
    r.pedidoNumero = enviosCriados;
    r.pedidoStatus = "novo";
    return jsonRes(200, { ok: true, rodada: r, pedidoId: r.pedidoId, pedidoNumero: r.pedidoNumero, comanda: c, totalParcial: totalParcialDe(c) });
  }

  const fechar = url.match(/^\/api\/salao\/comandas\/([^/]+)\/fechar$/);
  if (fechar && method === "POST") {
    const c = comandas.find((x) => x.id === fechar[1]);
    if (!c) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });
    const ativoPendente = c.rodadas.some((r) => r.status === "enviada" && r.pedidoStatus !== "entregue" && r.pedidoStatus !== "cancelado");
    if (ativoPendente) return jsonRes(409, { ok: false, error: "Todos os pedidos ativos precisam estar servidos antes de pedir a conta." });
    c.status = "fechada";
    return jsonRes(200, { ok: true, comanda: c });
  }

  return jsonRes(404, { ok: false, error: `rota não simulada: ${method} ${url}` });
}

beforeEach(() => {
  resetMock();
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => mockFetch(String(input), init)));
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

import SalaoPage from "./page";

async function iniciarAtendimento(user: ReturnType<typeof userEvent.setup>) {
  render(<SalaoPage />);
  await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));
  expect(screen.queryByLabelText("Nome do cliente")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Sem mesa" }));
  await user.click(screen.getByRole("button", { name: "Escolher produtos" }));
  await screen.findByPlaceholderText("Buscar produto…");
}

async function adicionarRefrigerante(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("Buscar produto…"), "Refrigerante");
  await user.click(await screen.findByRole("button", { name: /Refrigerante 2L/ }));
  expect(await screen.findByText("Refrigerante 2L adicionado")).toBeInTheDocument();
}

describe("/salao — estrutura principal", () => {
  it("mantém cabeçalho, marca, navegação e CTA de novo atendimento", async () => {
    render(<SalaoPage />);
    expect(await screen.findByText("Novo atendimento")).toBeInTheDocument();
    expect(screen.getByText("Terminal do salão")).toBeInTheDocument();
    expect(screen.getByText("Salão · ChefeBot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Começar novo atendimento" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fazer pedido/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pedidos abertos/ })).toBeInTheDocument();
  });

  it("erro de leitura mantém uma saída e opção de tentar novamente", async () => {
    falharProximaListagem = true;
    render(<SalaoPage />);
    expect(await screen.findByText("Não consegui carregar os dados agora.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });
});

describe("/salao — pedido primeiro, nome no final", () => {
  it("não pede nome na abertura e permite ir aos produtos", async () => {
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));
    expect(screen.getByText("Monte o pedido primeiro. O nome do cliente fica para o final.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nome do cliente")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escolher produtos" })).toBeEnabled();
  });

  it("mesa continua opcional e Sem mesa desabilita o campo", async () => {
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));
    await user.click(screen.getByRole("button", { name: "Sem mesa" }));
    expect(screen.getByPlaceholderText("Número da mesa")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Escolher produtos" }));
    expect(await screen.findByText("Nome pendente")).toBeInTheDocument();
  });

  it("nome aparece somente na revisão e bloqueia o envio até ser informado", async () => {
    const user = userEvent.setup();
    await iniciarAtendimento(user);
    await adicionarRefrigerante(user);
    expect(screen.queryByLabelText("Nome do cliente")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));
    const nome = await screen.findByLabelText("Nome do cliente");
    const enviar = screen.getByRole("button", { name: "Enviar para cozinha" });
    expect(enviar).toBeDisabled();
    await user.type(nome, "Ana");
    expect(enviar).toBeEnabled();
  });

  it("salva o nome e envia o pedido normalmente", async () => {
    const user = userEvent.setup();
    await iniciarAtendimento(user);
    await adicionarRefrigerante(user);
    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));
    await user.type(await screen.findByLabelText("Nome do cliente"), "Ana");
    await user.click(screen.getByRole("button", { name: "Enviar para cozinha" }));
    expect(await screen.findByText("Pedido enviado para a cozinha")).toBeInTheDocument();
    expect(screen.getByText(/Ana/)).toBeInTheDocument();
    expect(comandas[0].cliente).toBe("Ana");
    expect(enviosCriados).toBe(1);
  });

  it("mesa ocupada preserva as três saídas", async () => {
    comandas.push({
      id: "c1", numero: 1, cliente: "Bia", mesa: "5", itens: [], status: "aberta", abertaEm: new Date().toISOString(),
      rodadas: [{ id: "r1", numero: 1, status: "rascunho", itens: [], subtotal: 0, criadaEm: "", atualizadaEm: "" }],
    });
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));
    await user.type(screen.getByPlaceholderText("Número da mesa"), "5");
    await user.click(screen.getByRole("button", { name: "Escolher produtos" }));
    expect(await screen.findByText("Esta mesa já possui uma comanda aberta.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir comanda existente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escolher outra mesa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar sem mesa" })).toBeInTheDocument();
  });
});

describe("/salao — montagem e revisão", () => {
  it("adiciona produto simples, mostra confirmação e total", async () => {
    const user = userEvent.setup();
    await iniciarAtendimento(user);
    await adicionarRefrigerante(user);
    expect(screen.getByText("1 item(ns)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revisar pedido" })).toBeEnabled();
  });

  it("falha ao salvar não confirma nem mantém item fantasma", async () => {
    const user = userEvent.setup();
    await iniciarAtendimento(user);
    falharProximoSalvamentoItens = true;
    await user.type(screen.getByPlaceholderText("Buscar produto…"), "Refrigerante");
    await user.click(await screen.findByRole("button", { name: /Refrigerante 2L/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha simulada ao salvar itens");
    expect(screen.queryByText("Refrigerante 2L adicionado")).not.toBeInTheDocument();
    expect(screen.getByText("0 item(ns)")).toBeInTheDocument();
  });

  it("pizza mantém sabor obrigatório e decisões Sim/Não para opcionais", async () => {
    const user = userEvent.setup();
    cardapioAtual = CARDAPIO_PIZZA_OPCIONAIS;
    await iniciarAtendimento(user);
    await user.click(await screen.findByRole("button", { name: /Pizza Pequena/ }));
    const continuar = screen.getByRole("button", { name: "Continuar para borda" });
    expect(continuar).toBeDisabled();
    await user.click(await screen.findByRole("button", { name: /Mussarela/ }));
    expect(continuar).toBeEnabled();
    await user.click(continuar);
    expect(await screen.findByText("Vai querer borda?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Não" }));
    expect(await screen.findByText("Vai querer adicionais?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Não" }));
    expect(await screen.findByText("1 item(ns)")).toBeInTheDocument();
  });

  it("produto com adicional opcional usa Sim/Não e soma adicional", async () => {
    const user = userEvent.setup();
    cardapioAtual = CARDAPIO_PRODUTO_ADICIONAL;
    await iniciarAtendimento(user);
    await user.type(screen.getByPlaceholderText("Buscar produto…"), "Macarronada Teste");
    await user.click(await screen.findByRole("button", { name: /Macarronada Teste/ }));
    await user.click(await screen.findByRole("button", { name: /Tamanho P/ }));
    await user.click(screen.getByRole("button", { name: "Continuar para adicional" }));
    expect(await screen.findByText("Vai querer adicional?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sim" }));
    await user.click(await screen.findByRole("button", { name: /Ovo/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("1 item(ns)")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 35,00").length).toBeGreaterThan(0);
  });

  it("revisão altera quantidade e remove item", async () => {
    const user = userEvent.setup();
    await iniciarAtendimento(user);
    await adicionarRefrigerante(user);
    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));
    await user.click(screen.getByRole("button", { name: "Aumentar Refrigerante 2L" }));
    await waitFor(() => expect(screen.getAllByText("R$ 24,00").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("button", { name: "Remover Refrigerante 2L" }));
    expect(screen.getByRole("button", { name: "Enviar para cozinha" })).toBeDisabled();
  });

  it("erro ao enviar preserva pedido e permite tentar novamente", async () => {
    const user = userEvent.setup();
    await iniciarAtendimento(user);
    await adicionarRefrigerante(user);
    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));
    await user.type(await screen.findByLabelText("Nome do cliente"), "Ana");
    falharProximoEnvio = true;
    await user.click(screen.getByRole("button", { name: "Enviar para cozinha" }));
    expect(await screen.findByText("Falha simulada ao criar o pedido")).toBeInTheDocument();
    expect(screen.getByText("Refrigerante 2L")).toBeInTheDocument();
    expect(enviosCriados).toBe(0);
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Pedido enviado para a cozinha")).toBeInTheDocument();
    expect(enviosCriados).toBe(1);
  });
});

describe("/salao — pedidos abertos e continuidade", () => {
  it("mostra comanda, cliente e estado humano da cozinha", async () => {
    const agora = new Date().toISOString();
    comandas.push({
      id: "c1", numero: 31, cliente: "Carlos", mesa: "9", itens: [], status: "enviada", abertaEm: agora,
      rodadas: [{ id: "r1", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: agora, atualizadaEm: agora, enviadaEm: agora, pedidoStatus: "em_preparo" }],
    });
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: /Pedidos abertos/ }));
    expect(await screen.findByText("Comanda #31")).toBeInTheDocument();
    expect(screen.getByText("Carlos")).toBeInTheDocument();
    expect(screen.getByText("Em preparo")).toBeInTheDocument();
    expect(screen.queryByText(/^enviada$/)).not.toBeInTheDocument();
  });

  it("não junta comandas de clientes iguais", async () => {
    const agora = new Date().toISOString();
    comandas.push(
      { id: "a", numero: 41, cliente: "Teste B", itens: [], status: "enviada", abertaEm: agora, rodadas: [{ id: "ra", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "A", price: 10, qty: 1 }], subtotal: 10, criadaEm: agora, atualizadaEm: agora, pedidoStatus: "novo" }] },
      { id: "b", numero: 42, cliente: "Teste B", itens: [], status: "enviada", abertaEm: agora, rodadas: [{ id: "rb", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "B", price: 12, qty: 1 }], subtotal: 12, criadaEm: agora, atualizadaEm: agora, pedidoStatus: "novo" }] },
    );
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: /Pedidos abertos/ }));
    expect(await screen.findByText("Comanda #41")).toBeInTheDocument();
    expect(screen.getByText("Comanda #42")).toBeInTheDocument();
    expect(screen.getAllByText("Teste B")).toHaveLength(2);
  });

  it("complemento preserva nome já existente e volta à cozinha", async () => {
    const agora = new Date().toISOString();
    comandas.push({
      id: "c1", numero: 1, cliente: "Carlos", mesa: "9", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], status: "enviada", abertaEm: agora,
      rodadas: [{ id: "r1", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: agora, atualizadaEm: agora, enviadaEm: agora, pedidoStatus: "entregue" }],
    });
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: /Pedidos abertos/ }));
    await user.click(await screen.findByText("Carlos"));
    await user.click(screen.getByRole("button", { name: "Adicionar itens" }));
    await user.type(await screen.findByPlaceholderText("Buscar produto…"), "Água");
    await user.click(await screen.findByRole("button", { name: /Água com gás/ }));
    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));
    expect(screen.getByLabelText("Nome do cliente")).toHaveValue("Carlos");
    await user.click(screen.getByRole("button", { name: "Enviar para cozinha" }));
    expect(await screen.findByText("Pedido enviado para a cozinha")).toBeInTheDocument();
  });

  it("Pedir conta mostra motivo quando ainda há pedido ativo", async () => {
    const agora = new Date().toISOString();
    comandas.push({
      id: "conta", numero: 32, cliente: "Teste Conta", itens: [], status: "enviada", abertaEm: agora,
      rodadas: [{ id: "r", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: agora, atualizadaEm: agora, pedidoStatus: "em_preparo" }],
    });
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: /Pedidos abertos/ }));
    await user.click(await screen.findByText("Teste Conta"));
    await user.click(screen.getByRole("button", { name: "Pedir conta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Todos os pedidos ativos precisam estar servidos antes de pedir a conta.");
  });

  it("atualiza estado quando a janela volta ao foco", async () => {
    const agora = new Date().toISOString();
    comandas.push({
      id: "foco", numero: 22, cliente: "Rita", mesa: "4", itens: [], status: "enviada", abertaEm: agora,
      rodadas: [{ id: "r", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: agora, atualizadaEm: agora, pedidoStatus: "em_preparo" }],
    });
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: /Pedidos abertos/ }));
    expect(await screen.findByText("Em preparo")).toBeInTheDocument();
    comandas[0].rodadas[0].pedidoStatus = "saiu_entrega";
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(screen.getByText("Pronto para servir")).toBeInTheDocument());
  });

  it("falha de sincronização invalida status antigo em vez de mostrá-lo como atual", async () => {
    const agora = new Date().toISOString();
    comandas.push({
      id: "stale", numero: 24, cliente: "Marta", itens: [], status: "enviada", abertaEm: agora,
      rodadas: [{ id: "r", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Água com gás", price: 6, qty: 1 }], subtotal: 6, criadaEm: agora, atualizadaEm: agora, pedidoStatus: "em_preparo" }],
    });
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: /Pedidos abertos/ }));
    expect(await screen.findByText("Em preparo")).toBeInTheDocument();
    falharProximaListagem = true;
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(screen.queryByText("Em preparo")).not.toBeInTheDocument());
  });
});
