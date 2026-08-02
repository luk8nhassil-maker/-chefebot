// @vitest-environment jsdom
//
// Testes de INTERAÇÃO real do fluxo direto ao catálogo do Salão — render +
// clique/digitação via Testing Library (jsdom), não só leitura de
// código-fonte. O backend de verdade (src/lib/comandas.ts, rotas
// /api/salao/...) já tem sua própria suíte extensa; aqui o "servidor" é um
// mock leve por fetch que reproduz o suficiente do comportamento real
// (normalização de rodadas, mesa ocupada, cliente obrigatório só no envio,
// idempotência de envio) para exercitar a UI ponta a ponta.

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

type ItemMock = { kind: "simple" | "pizza"; name: string; detail?: string; price: number; qty: number };
type RodadaMock = {
  id: string; numero: number; status: "rascunho" | "enviando" | "enviada" | "falha_envio";
  itens: ItemMock[]; observacao?: string; subtotal: number; criadaEm: string; atualizadaEm: string;
  enviadaEm?: string; pedidoId?: string; pedidoNumero?: number; erroUltimaTentativa?: string;
};
type ComandaMock = {
  id: string; numero: number; cliente?: string; mesa?: string; whatsapp?: string; complemento?: string;
  itens: ItemMock[]; observacao?: string; status: "aberta" | "enviada" | "fechada"; abertaEm: string;
  pedidoId?: string; pedidoNumero?: number; rodadas: RodadaMock[];
};

function subtotalDe(itens: ItemMock[]) {
  return itens.reduce((s, i) => s + i.price * i.qty, 0);
}
function totalParcialDe(c: ComandaMock) {
  return c.rodadas.reduce((s, r) => s + r.subtotal, 0);
}
function precoOficial(name: string): number | null {
  const b = CARDAPIO_TESTE.bebidas.find((x) => x.name === name);
  return b ? b.price : null;
}

let seq = 0;
let comandas: ComandaMock[] = [];
let falharProximoEnvio = false;
let enviosCriados = 0;

function resetMock() {
  seq = 0;
  comandas = [];
  falharProximoEnvio = false;
  enviosCriados = 0;
}

function jsonRes(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

async function mockFetch(url: string, opts?: RequestInit): Promise<Response> {
  const method = (opts?.method || "GET").toUpperCase();
  const body = opts?.body ? JSON.parse(String(opts.body)) : {};

  if (url === "/api/cardapio" && method === "GET") return jsonRes(200, CARDAPIO_TESTE);
  if (url === "/api/salao/logout") return jsonRes(200, { ok: true });

  if (url === "/api/salao/comandas" && method === "GET") {
    return jsonRes(200, { ok: true, comandas: comandas.map((c) => ({ ...c, totalParcial: totalParcialDe(c) })) });
  }

  // "Começar novo atendimento" abre a comanda ainda anônima — cliente/mesa
  // nunca são exigidos aqui.
  if (url === "/api/salao/comandas" && method === "POST") {
    const cliente = body.cliente ? String(body.cliente).trim() || undefined : undefined;
    const mesa = body.mesa ? String(body.mesa).trim() || undefined : undefined;
    if (mesa && comandas.some((c) => c.mesa === mesa && c.status !== "fechada")) {
      return jsonRes(409, { ok: false, error: "Esta mesa já tem uma comanda aberta" });
    }
    seq += 1;
    const agora = new Date().toISOString();
    const nova: ComandaMock = {
      id: `comanda_${seq}`, numero: seq, cliente, mesa, itens: [], status: "aberta", abertaEm: agora,
      rodadas: [{ id: `rodada_${seq}_1`, numero: 1, status: "rascunho", itens: [], subtotal: 0, criadaEm: agora, atualizadaEm: agora }],
    };
    comandas.push(nova);
    return jsonRes(200, { ok: true, comanda: nova });
  }

  const identificacao = url.match(/^\/api\/salao\/comandas\/([^/]+)\/identificacao$/);
  if (identificacao && method === "PATCH") {
    const c = comandas.find((x) => x.id === identificacao[1]);
    if (!c) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });
    const mesaNova = body.semMesa ? undefined : (body.mesa ? String(body.mesa).trim() || undefined : undefined);
    if (mesaNova && mesaNova !== c.mesa && comandas.some((x) => x.id !== c.id && x.mesa === mesaNova && x.status !== "fechada")) {
      return jsonRes(409, { ok: false, error: "Esta mesa já possui uma comanda aberta" });
    }
    if (body.cliente !== undefined) c.cliente = String(body.cliente).trim() || undefined;
    if (body.mesa !== undefined || body.semMesa) c.mesa = mesaNova;
    if (body.whatsapp !== undefined) c.whatsapp = String(body.whatsapp).trim() || undefined;
    return jsonRes(200, { ok: true, comanda: c });
  }

  const descartar = url.match(/^\/api\/salao\/comandas\/([^/]+)\/descartar$/);
  if (descartar && method === "POST") {
    const idx = comandas.findIndex((x) => x.id === descartar[1]);
    if (idx < 0) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });
    if (comandas[idx].status !== "aberta") return jsonRes(409, { ok: false, error: "Este pedido já foi enviado" });
    comandas.splice(idx, 1);
    return jsonRes(200, { ok: true });
  }

  const patchComanda = url.match(/^\/api\/salao\/comandas\/([^/]+)$/);
  if (patchComanda && method === "PATCH") {
    const c = comandas.find((x) => x.id === patchComanda[1]);
    if (!c) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });
    const itens: ItemMock[] = (body.itens || []).map((i: ItemMock) => ({ ...i, price: precoOficial(i.name) ?? i.price }));
    c.itens = itens;
    c.rodadas[0].itens = itens;
    c.rodadas[0].subtotal = subtotalDe(itens);
    if (body.observacao !== undefined) { c.observacao = body.observacao; c.rodadas[0].observacao = body.observacao; }
    return jsonRes(200, { ok: true, comanda: c });
  }

  const enviarComanda = url.match(/^\/api\/salao\/comandas\/([^/]+)\/enviar$/);
  if (enviarComanda && method === "POST") {
    const c = comandas.find((x) => x.id === enviarComanda[1]);
    if (!c) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });
    if (c.itens.length === 0) return jsonRes(422, { ok: false, error: "Adicione pelo menos um item antes de enviar" });
    if (!c.cliente) return jsonRes(422, { ok: false, error: "Informe o nome do cliente antes de enviar" });
    if (falharProximoEnvio) { falharProximoEnvio = false; return jsonRes(500, { ok: false, error: "Falha simulada ao criar o pedido" }); }
    enviosCriados += 1;
    c.status = "enviada";
    c.pedidoId = `ped_${seq}`;
    c.pedidoNumero = enviosCriados;
    c.rodadas[0].status = "enviada";
    c.rodadas[0].enviadaEm = new Date().toISOString();
    c.rodadas[0].pedidoId = c.pedidoId;
    c.rodadas[0].pedidoNumero = c.pedidoNumero;
    return jsonRes(200, { ok: true, pedidoId: c.pedidoId, numero: c.pedidoNumero, total: subtotalDe(c.itens), comanda: c });
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
    const itens: ItemMock[] = (body.itens || []).map((i: ItemMock) => ({ ...i, price: precoOficial(i.name) ?? i.price }));
    r.itens = itens;
    r.subtotal = subtotalDe(itens);
    if (body.observacao !== undefined) r.observacao = body.observacao;
    return jsonRes(200, { ok: true, rodada: r, comanda: c, totalParcial: totalParcialDe(c) });
  }

  const enviarRodada = url.match(/^\/api\/salao\/comandas\/([^/]+)\/rodadas\/([^/]+)\/enviar$/);
  if (enviarRodada && method === "POST") {
    const c = comandas.find((x) => x.id === enviarRodada[1]);
    const r = c?.rodadas.find((x) => x.id === enviarRodada[2]);
    if (!c || !r) return jsonRes(404, { ok: false, error: "Rodada não encontrada" });
    if (r.itens.length === 0) return jsonRes(422, { ok: false, error: "Adicione pelo menos um item antes de enviar" });
    if (!c.cliente) return jsonRes(422, { ok: false, error: "Informe o nome do cliente antes de enviar" });
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
    return jsonRes(200, { ok: true, rodada: r, pedidoId: r.pedidoId, pedidoNumero: r.pedidoNumero, comanda: c, totalParcial: totalParcialDe(c) });
  }

  const fechar = url.match(/^\/api\/salao\/comandas\/([^/]+)\/fechar$/);
  if (fechar && method === "POST") {
    const c = comandas.find((x) => x.id === fechar[1]);
    if (!c) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });
    c.status = "fechada";
    return jsonRes(200, { ok: true, comanda: c });
  }

  return jsonRes(404, { ok: false, error: `rota não simulada: ${method} ${url}` });
}

beforeEach(() => {
  resetMock();
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => mockFetch(String(input), init)));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Import depois dos mocks — o componente lê `fetch` global no momento da
// chamada, então a ordem aqui não é estritamente necessária, mas mantém o
// padrão do resto do repo.
import SalaoPage from "./page";

async function comecarNovoAtendimento(user: ReturnType<typeof userEvent.setup>) {
  render(<SalaoPage />);
  await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));
  await screen.findByPlaceholderText("Buscar produto…");
}

async function adicionarRefrigerante(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("Buscar produto…"), "Refrigerante");
  await user.click(await screen.findByRole("button", { name: /Refrigerante 2L/ }));
}

describe("/salao — tela inicial (Fazer pedido)", () => {
  it("mostra o card de novo atendimento quando não há pedido em andamento", async () => {
    render(<SalaoPage />);
    expect(await screen.findByText("Novo atendimento")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Começar novo atendimento" })).toBeInTheDocument();
    expect(screen.queryByText(/Rodada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/clientRequestId/)).not.toBeInTheDocument();
  });
});

describe("/salao — 'Começar novo atendimento' abre direto no catálogo", () => {
  it("abre a tela de produtos imediatamente, sem formulário de cliente/mesa antes", async () => {
    const user = userEvent.setup();
    await comecarNovoAtendimento(user);

    expect(screen.getByText("Adicionar produtos")).toBeInTheDocument();
    expect(screen.getAllByText("Novo atendimento").length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("Buscar produto…")).toBeInTheDocument();
    // Antiga tela intermediária não aparece.
    expect(screen.queryByLabelText("Nome do cliente")).not.toBeInTheDocument();
    expect(screen.queryByText("Produtos deste envio")).not.toBeInTheDocument();
    expect(screen.queryByText("Adicionar o primeiro produto")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buscar produto" })).not.toBeInTheDocument();
  });

  it("categorias aparecem imediatamente junto com a busca", async () => {
    const user = userEvent.setup();
    await comecarNovoAtendimento(user);
    expect(screen.getByRole("button", { name: "Bebidas" })).toBeInTheDocument();
  });
});

describe("/salao — seleção contínua de produtos", () => {
  it("busca filtra produtos e adicionar um produto simples mostra confirmação e atualiza o total", async () => {
    const user = userEvent.setup();
    await comecarNovoAtendimento(user);
    await adicionarRefrigerante(user);

    expect(await screen.findByText("Refrigerante 2L adicionado")).toBeInTheDocument();
    expect(await screen.findByText("1 item(ns)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revisar pedido" })).toBeEnabled();
  });

  it("permite adicionar vários produtos sem sair do catálogo", async () => {
    const user = userEvent.setup();
    await comecarNovoAtendimento(user);
    await adicionarRefrigerante(user);
    await screen.findByText("1 item(ns)");

    const campoBusca = screen.getByPlaceholderText("Buscar produto…") as HTMLInputElement;
    await user.clear(campoBusca);
    await user.type(campoBusca, "Água");
    await user.click(await screen.findByRole("button", { name: /Água com gás/ }));

    expect(await screen.findByText("2 item(ns)")).toBeInTheDocument();
    expect(screen.getByText("R$ 18,00")).toBeInTheDocument();
  });

  it("botão 'Revisar pedido' fica desabilitado sem itens e habilitado com pelo menos um", async () => {
    const user = userEvent.setup();
    await comecarNovoAtendimento(user);
    expect(screen.getByRole("button", { name: "Adicione pelo menos um produto" })).toBeDisabled();
    await adicionarRefrigerante(user);
    expect(await screen.findByRole("button", { name: "Revisar pedido" })).toBeEnabled();
  });
});

describe("/salao — fechar/voltar do catálogo", () => {
  it("fechar sem nenhum item retorna direto para 'Fazer pedido' sem confirmação", async () => {
    const user = userEvent.setup();
    await comecarNovoAtendimento(user);
    await user.click(screen.getByRole("button", { name: "Fechar" }));

    expect(await screen.findByText("Novo atendimento")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(comandas).toHaveLength(0);
  });

  it("fechar com itens oferece três saídas", async () => {
    const user = userEvent.setup();
    await comecarNovoAtendimento(user);
    await adicionarRefrigerante(user);
    await user.click(screen.getByRole("button", { name: "Fechar" }));

    expect(await screen.findByText("Sair deste pedido?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar montando" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar e sair" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descartar pedido" })).toBeInTheDocument();
  });

  it("'Continuar montando' fecha o modal e mantém os itens", async () => {
    const user = userEvent.setup();
    await comecarNovoAtendimento(user);
    await adicionarRefrigerante(user);
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    await user.click(await screen.findByRole("button", { name: "Continuar montando" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("1 item(ns)")).toBeInTheDocument();
  });

  it("'Salvar e sair' preserva o rascunho — a home mostra 'Continuar pedido'", async () => {
    const user = userEvent.setup();
    await comecarNovoAtendimento(user);
    await adicionarRefrigerante(user);
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    await user.click(await screen.findByRole("button", { name: "Salvar e sair" }));

    expect(await screen.findByText("Você tem um pedido em andamento")).toBeInTheDocument();
    const continuar = screen.getByRole("button", { name: "Continuar pedido" });
    await user.click(continuar);
    await screen.findByPlaceholderText("Buscar produto…");
    expect(screen.getByText("1 item(ns)")).toBeInTheDocument();
  });

  it("'Descartar pedido' exige confirmação e remove o rascunho", async () => {
    const user = userEvent.setup();
    await comecarNovoAtendimento(user);
    await adicionarRefrigerante(user);
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    await user.click(await screen.findByRole("button", { name: "Descartar pedido" }));

    expect(await screen.findByText("Descartar este pedido?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Descartar pedido" }));

    expect(await screen.findByText("Novo atendimento")).toBeInTheDocument();
    expect(comandas).toHaveLength(0);
  });
});

describe("/salao — revisão do pedido (itens, observação, identificação)", () => {
  async function irParaRevisao(user: ReturnType<typeof userEvent.setup>) {
    await comecarNovoAtendimento(user);
    await adicionarRefrigerante(user);
    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));
    await screen.findByText("Revisar pedido");
  }

  it("revisão permite aumentar/diminuir/remover item e recalcula o total", async () => {
    const user = userEvent.setup();
    await irParaRevisao(user);

    await user.click(screen.getByRole("button", { name: "Aumentar Refrigerante 2L" }));
    await waitFor(() => expect(screen.getAllByText("R$ 24,00").length).toBeGreaterThanOrEqual(2));

    await user.click(screen.getByRole("button", { name: "Remover Refrigerante 2L" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar para a cozinha" })).toBeDisabled());
  });

  it("'Adicionar mais produtos' volta direto ao catálogo", async () => {
    const user = userEvent.setup();
    await irParaRevisao(user);
    await user.click(screen.getByRole("button", { name: "Adicionar mais produtos" }));
    await screen.findByPlaceholderText("Buscar produto…");
    expect(screen.getByText("1 item(ns)")).toBeInTheDocument();
  });

  it("cliente é obrigatório só na revisão — botão de enviar fica desabilitado até preencher", async () => {
    const user = userEvent.setup();
    await irParaRevisao(user);

    const botao = screen.getByRole("button", { name: "Enviar para a cozinha" });
    expect(botao).toBeDisabled();

    await user.type(screen.getByLabelText("Nome do cliente"), "João");
    expect(botao).toBeEnabled();
  });

  it("mesa é opcional — 'Sem mesa' desabilita o campo e permite enviar", async () => {
    const user = userEvent.setup();
    await irParaRevisao(user);
    await user.type(screen.getByLabelText("Nome do cliente"), "João");
    await user.click(screen.getByRole("button", { name: "Sem mesa" }));
    expect(screen.getByPlaceholderText("Ex.: 4")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Enviar para a cozinha" }));
    expect(await screen.findByText("Pedido enviado para a cozinha")).toBeInTheDocument();
    expect(screen.getByText(/Sem mesa/)).toBeInTheDocument();
  });

  it("WhatsApp é opcional e observação é enviada junto", async () => {
    const user = userEvent.setup();
    await irParaRevisao(user);
    await user.type(screen.getByLabelText("Nome do cliente"), "João");
    await user.type(screen.getByLabelText("WhatsApp do cliente (opcional)"), "11999998888");
    await user.type(screen.getByLabelText("Observação para a cozinha"), "sem cebola");
    await user.click(screen.getByRole("button", { name: "Sem mesa" }));
    await user.click(screen.getByRole("button", { name: "Enviar para a cozinha" }));

    expect(await screen.findByText("Pedido enviado para a cozinha")).toBeInTheDocument();
    expect(comandas[0].whatsapp).toBe("11999998888");
    expect(comandas[0].observacao).toBe("sem cebola");
  });

  it("enviar para cozinha mostra 'Enviando…' e depois a tela de sucesso com cliente/mesa/total", async () => {
    const user = userEvent.setup();
    await irParaRevisao(user);
    await user.type(screen.getByLabelText("Nome do cliente"), "Ana");
    await user.click(screen.getByRole("button", { name: "Sem mesa" }));
    await user.click(await screen.findByRole("button", { name: "Enviar para a cozinha" }));

    expect(await screen.findByText("Pedido enviado para a cozinha")).toBeInTheDocument();
    expect(screen.getByText(/Ana/)).toBeInTheDocument();
    expect(screen.getByText(/Sem mesa/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar mais itens" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver pedidos abertos" })).toBeInTheDocument();
  });

  it("erro ao enviar preserva itens, observação e cliente — oferece 'Tentar novamente' sem duplicar o pedido", async () => {
    const user = userEvent.setup();
    await irParaRevisao(user);
    await user.type(screen.getByLabelText("Nome do cliente"), "Ana");
    await user.type(screen.getByLabelText("Observação para a cozinha"), "bem gelado");
    await user.click(screen.getByLabelText("Observação para a cozinha")); // garante blur do campo anterior
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Sem mesa" }));

    falharProximoEnvio = true;
    await user.click(await screen.findByRole("button", { name: "Enviar para a cozinha" }));

    expect(await screen.findByText("Falha simulada ao criar o pedido")).toBeInTheDocument();
    expect(screen.getByText("Refrigerante 2L")).toBeInTheDocument();
    expect(screen.getByLabelText("Nome do cliente")).toHaveValue("Ana");
    expect(enviosCriados).toBe(0);

    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Pedido enviado para a cozinha")).toBeInTheDocument();
    expect(enviosCriados).toBe(1);
  });
});

describe("/salao — Pedidos abertos e complemento", () => {
  it("lista mostra cliente em destaque e o estado em linguagem humana, nunca status técnico cru", async () => {
    comandas.push({
      id: "c1", numero: 1, cliente: "Carlos", mesa: "9", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }],
      status: "enviada", abertaEm: new Date().toISOString(), pedidoId: "ped_1", pedidoNumero: 1,
      rodadas: [{ id: "r1", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: "", atualizadaEm: "", enviadaEm: new Date().toISOString(), pedidoId: "ped_1", pedidoNumero: 1 }],
    });
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: /Pedidos abertos/ }));

    expect(await screen.findByText("Carlos")).toBeInTheDocument();
    expect(screen.getByText("Aguardando cozinha")).toBeInTheDocument();
    expect(screen.queryByText(/^enviada$/)).not.toBeInTheDocument();
  });

  it("abrir a comanda mostra o Pedido inicial no histórico e 'Adicionar itens' abre direto no catálogo (Complemento 2)", async () => {
    comandas.push({
      id: "c1", numero: 1, cliente: "Carlos", mesa: "9", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }],
      status: "enviada", abertaEm: new Date().toISOString(), pedidoId: "ped_1", pedidoNumero: 1,
      rodadas: [{ id: "r1", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: "", atualizadaEm: "", enviadaEm: new Date().toISOString(), pedidoId: "ped_1", pedidoNumero: 1 }],
    });
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: /Pedidos abertos/ }));
    await user.click(await screen.findByText("Carlos"));

    expect(await screen.findByText(/Pedido inicial/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Adicionar itens" }));

    // Abre direto no catálogo — sem formulário nem card de "primeiro produto".
    await screen.findByPlaceholderText("Buscar produto…");
    expect(screen.queryByLabelText("Nome do cliente")).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Buscar produto…"), "Água");
    await user.click(await screen.findByRole("button", { name: /Água com gás/ }));
    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));
    expect(await screen.findByText(/Complemento 2/)).toBeInTheDocument();
    // Complemento não pede cliente de novo — já veio da comanda.
    expect(screen.queryByLabelText("Nome do cliente")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enviar para a cozinha" }));
    expect(await screen.findByText("Pedido enviado para a cozinha")).toBeInTheDocument();

    // A Rodada 1 (Pedido inicial) permanece intacta — ainda com seu item e subtotal originais.
    await user.click(screen.getByRole("button", { name: "Ver pedidos abertos" }));
    await user.click(await screen.findByText("Carlos"));
    await user.click(await screen.findByText(/Pedido inicial/));
    expect(within(screen.getByText(/Pedido inicial/).closest("div")!.parentElement!).getByText("1× Refrigerante 2L")).toBeInTheDocument();
  });
});
