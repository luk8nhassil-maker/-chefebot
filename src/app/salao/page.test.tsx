// @vitest-environment jsdom
//
// Testes de INTERAÇÃO real do redesenho do Salão — render + clique/digitação
// via Testing Library (jsdom), não só leitura de código-fonte. O backend de
// verdade (src/lib/comandas.ts, rotas /api/salao/...) já tem sua própria
// suíte extensa; aqui o "servidor" é um mock leve por fetch que reproduz o
// suficiente do comportamento real (normalização de rodadas, mesa ocupada,
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
  itens: ItemMock[]; subtotal: number; criadaEm: string; atualizadaEm: string;
  enviadaEm?: string; pedidoId?: string; pedidoNumero?: number; pedidoStatus?: "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado"; pedidoStatusAtualizadoEm?: string; erroUltimaTentativa?: string;
};
type ComandaMock = {
  id: string; numero: number; cliente?: string; mesa?: string; complemento?: string;
  itens: ItemMock[]; status: "aberta" | "enviada" | "fechada"; abertaEm: string;
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
let falharProximaListagem = false;
let enviosCriados = 0;

function resetMock() {
  seq = 0;
  comandas = [];
  falharProximoEnvio = false;
  falharProximaListagem = false;
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
    if (falharProximaListagem) {
      falharProximaListagem = false;
      return jsonRes(503, { ok: false, error: "Falha simulada de sincronização" });
    }
    return jsonRes(200, { ok: true, comandas: comandas.map((c) => ({ ...c, totalParcial: totalParcialDe(c) })) });
  }

  if (url === "/api/salao/comandas" && method === "POST") {
    const cliente = String(body.cliente || "").trim();
    if (!cliente) return jsonRes(400, { ok: false, error: "Informe o nome do cliente" });
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

  const patchComanda = url.match(/^\/api\/salao\/comandas\/([^/]+)$/);
  if (patchComanda && method === "PATCH") {
    const c = comandas.find((x) => x.id === patchComanda[1]);
    if (!c) return jsonRes(404, { ok: false, error: "Comanda não encontrada" });
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
    return jsonRes(200, { ok: true, rodada: r, comanda: c, totalParcial: totalParcialDe(c) });
  }

  const enviarRodada = url.match(/^\/api\/salao\/comandas\/([^/]+)\/rodadas\/([^/]+)\/enviar$/);
  if (enviarRodada && method === "POST") {
    const c = comandas.find((x) => x.id === enviarRodada[1]);
    const r = c?.rodadas.find((x) => x.id === enviarRodada[2]);
    if (!c || !r) return jsonRes(404, { ok: false, error: "Rodada não encontrada" });
    if (r.itens.length === 0) return jsonRes(422, { ok: false, error: "Adicione pelo menos um item antes de enviar" });
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

describe("/salao — tela inicial (Fazer pedido)", () => {
  it("mostra o card de novo atendimento quando não há pedido em andamento", async () => {
    render(<SalaoPage />);
    expect(await screen.findByText("Novo atendimento")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Começar novo atendimento" })).toBeInTheDocument();
    expect(screen.queryByText(/Rodada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/clientRequestId/)).not.toBeInTheDocument();
  });
});

describe("/salao — cabeçalho e navegação (paridade visual com a referência)", () => {
  it("cabeçalho mostra a identificação do terminal, a marca e o botão Sair acessível", async () => {
    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    expect(screen.getByText("Terminal do salão")).toBeInTheDocument();
    expect(screen.getByText("Salão · ChefeBot")).toBeInTheDocument();
    const sair = screen.getByRole("button", { name: "Sair" });
    expect(sair).toBeInTheDocument();
    expect(sair).toHaveAccessibleName("Sair");
  });

  it("clicar em Sair encerra a sessão (logout) antes de redirecionar", async () => {
    const user = userEvent.setup();
    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    const chamadasAntes = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Sair" }));
    await waitFor(() => {
      const chamadasLogout = (fetch as ReturnType<typeof vi.fn>).mock.calls
        .slice(chamadasAntes)
        .filter(([url]) => String(url) === "/api/salao/logout");
      expect(chamadasLogout.length).toBeGreaterThan(0);
    });
  });

  it("existe somente UMA navegação principal no DOM — nunca duas (mobile e desktop nunca simultâneos)", async () => {
    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    expect(screen.getAllByRole("navigation", { name: "Navegação principal" })).toHaveLength(1);
  });

  it("item ativo tem aria-current, e trocar de aba move o aria-current e some com o card de novo atendimento", async () => {
    const user = userEvent.setup();
    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");

    const fazerPedido = screen.getByRole("button", { name: "Fazer pedido" });
    expect(fazerPedido).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: /Pedidos abertos/ }));
    expect(screen.getByRole("button", { name: /Pedidos abertos/ })).toHaveAttribute("aria-current", "page");
    expect(fazerPedido).not.toHaveAttribute("aria-current");
    expect(screen.queryByText("Novo atendimento")).not.toBeInTheDocument();
  });

  it("badge de Pedidos abertos mostra a quantidade de comandas abertas, sem duplicar", async () => {
    comandas.push({
      id: "c1", numero: 1, cliente: "Carlos", mesa: "9", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }],
      status: "enviada", abertaEm: new Date().toISOString(), pedidoId: "ped_1", pedidoNumero: 1,
      rodadas: [{ id: "r1", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: "", atualizadaEm: "", enviadaEm: new Date().toISOString(), pedidoId: "ped_1", pedidoNumero: 1, pedidoStatus: "novo" }],
    });
    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    expect(screen.getAllByText("1")).toHaveLength(1);
  });

  it("erro de carregamento mantém o cabeçalho (nunca uma tela branca sem navegação) e permite tentar novamente", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("falhou")));
    render(<SalaoPage />);
    expect(await screen.findByText("Não consegui carregar os dados agora.")).toBeInTheDocument();
    expect(screen.getByText("Terminal do salão")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });
});

describe("/salao — identificação do atendimento", () => {
  it("botão 'Escolher produtos' fica desabilitado até preencher o nome, e a mesa é opcional", async () => {
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));

    const botao = await screen.findByRole("button", { name: "Escolher produtos" });
    expect(botao).toBeDisabled();

    const campoNome = screen.getByLabelText("Nome do cliente");
    await user.type(campoNome, "Ana");
    expect(botao).toBeEnabled();
  });

  it("'Sem mesa' desabilita o campo de mesa e permite avançar", async () => {
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));
    await user.type(screen.getByLabelText("Nome do cliente"), "Ana");
    await user.click(screen.getByRole("button", { name: "Sem mesa" }));
    expect(screen.getByPlaceholderText("Número da mesa")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Escolher produtos" }));
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByText(/Sem mesa/)).toBeInTheDocument();
  });

  it("mesa ocupada mostra as três saídas — nunca só um erro técnico", async () => {
    comandas.push({
      id: "c1", numero: 1, cliente: "Bia", mesa: "5", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }],
      status: "aberta", abertaEm: new Date().toISOString(),
      rodadas: [{ id: "r1", numero: 1, status: "rascunho", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: "", atualizadaEm: "" }],
    });
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));
    await user.type(screen.getByLabelText("Nome do cliente"), "Ana");
    await user.type(screen.getByPlaceholderText("Número da mesa"), "5");
    await user.click(screen.getByRole("button", { name: "Escolher produtos" }));

    expect(await screen.findByText("Esta mesa já possui uma comanda aberta.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir comanda existente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escolher outra mesa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar sem mesa" })).toBeInTheDocument();
  });

  it("'Abrir comanda existente' leva direto para a comanda da mesa ocupada", async () => {
    comandas.push({
      id: "c1", numero: 1, cliente: "Bia", mesa: "5", itens: [],
      status: "aberta", abertaEm: new Date().toISOString(),
      rodadas: [{ id: "r1", numero: 1, status: "rascunho", itens: [], subtotal: 0, criadaEm: "", atualizadaEm: "" }],
    });
    const user = userEvent.setup();
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));
    await user.type(screen.getByLabelText("Nome do cliente"), "Ana");
    await user.type(screen.getByPlaceholderText("Número da mesa"), "5");
    await user.click(screen.getByRole("button", { name: "Escolher produtos" }));
    await user.click(await screen.findByRole("button", { name: "Abrir comanda existente" }));

    expect(await screen.findByRole("button", { name: /Continuar pedido|Adicionar itens/ })).toBeInTheDocument();
    expect(screen.getByText("Bia")).toBeInTheDocument();
  });
});

describe("/salao — escolher produtos e revisar", () => {
  async function iniciarAtendimento(user: ReturnType<typeof userEvent.setup>) {
    render(<SalaoPage />);
    await user.click(await screen.findByRole("button", { name: "Começar novo atendimento" }));
    await user.type(screen.getByLabelText("Nome do cliente"), "Ana");
    await user.click(screen.getByRole("button", { name: "Sem mesa" }));
    await user.click(screen.getByRole("button", { name: "Escolher produtos" }));
    await screen.findByPlaceholderText("Buscar produto…");
  }

  it("busca filtra produtos e adicionar um produto simples mostra confirmação e atualiza o total", async () => {
    const user = userEvent.setup();
    await iniciarAtendimento(user);

    await user.type(screen.getByPlaceholderText("Buscar produto…"), "Refrigerante");
    const produto = await screen.findByRole("button", { name: /Refrigerante 2L/ });
    await user.click(produto);

    expect(await screen.findByText("Refrigerante 2L adicionado")).toBeInTheDocument();
    expect(await screen.findByText("1 item(ns)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revisar pedido" })).toBeEnabled();
  });

  it("revisão permite aumentar/diminuir/remover item e recalcula o total", async () => {
    const user = userEvent.setup();
    await iniciarAtendimento(user);
    await user.type(screen.getByPlaceholderText("Buscar produto…"), "Refrigerante");
    await user.click(await screen.findByRole("button", { name: /Refrigerante 2L/ }));
    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));

    expect(await screen.findByText("Revisar pedido")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aumentar Refrigerante 2L" }));
    await waitFor(() => expect(screen.getAllByText("R$ 24,00").length).toBeGreaterThanOrEqual(2));

    await user.click(screen.getByRole("button", { name: "Remover Refrigerante 2L" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar para cozinha" })).toBeDisabled());
  });

  it("enviar para cozinha mostra 'Enviando…' e depois a tela de sucesso com cliente/mesa/total", async () => {
    const user = userEvent.setup();
    await iniciarAtendimento(user);
    await user.type(screen.getByPlaceholderText("Buscar produto…"), "Refrigerante");
    await user.click(await screen.findByRole("button", { name: /Refrigerante 2L/ }));
    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));
    await user.click(await screen.findByRole("button", { name: "Enviar para cozinha" }));

    expect(await screen.findByText("Pedido enviado para a cozinha")).toBeInTheDocument();
    expect(screen.getByText(/Ana/)).toBeInTheDocument();
    expect(screen.getByText(/Sem mesa/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver pedidos abertos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar mais itens" })).toBeInTheDocument();
  });

  it("erro ao enviar preserva os itens e oferece 'Tentar novamente' sem duplicar o pedido", async () => {
    const user = userEvent.setup();
    await iniciarAtendimento(user);
    await user.type(screen.getByPlaceholderText("Buscar produto…"), "Refrigerante");
    await user.click(await screen.findByRole("button", { name: /Refrigerante 2L/ }));
    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));

    falharProximoEnvio = true;
    await user.click(await screen.findByRole("button", { name: "Enviar para cozinha" }));

    expect(await screen.findByText("Falha simulada ao criar o pedido")).toBeInTheDocument();
    // Itens preservados — a revisão continua mostrando o item, não volta ao catálogo vazio.
    expect(screen.getByText("Refrigerante 2L")).toBeInTheDocument();
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

  it("abrir a comanda mostra o Pedido inicial no histórico e 'Adicionar itens' cria um Complemento 2 no catálogo", async () => {
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

    await screen.findByPlaceholderText("Buscar produto…");
    await user.type(screen.getByPlaceholderText("Buscar produto…"), "Água");
    await user.click(await screen.findByRole("button", { name: /Água com gás/ }));
    await user.click(screen.getByRole("button", { name: "Revisar pedido" }));
    expect(await screen.findByText(/Complemento 2/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enviar para cozinha" }));
    expect(await screen.findByText("Pedido enviado para a cozinha")).toBeInTheDocument();

    // A Rodada 1 (Pedido inicial) permanece intacta — ainda com seu item e subtotal originais.
    await user.click(screen.getByRole("button", { name: "Ver pedidos abertos" }));
    await user.click(await screen.findByText("Carlos"));
    await user.click(await screen.findByText(/Pedido inicial/));
    expect(within(screen.getByText(/Pedido inicial/).closest("div")!.parentElement!).getByText("1× Refrigerante 2L")).toBeInTheDocument();
  });
});


describe("/salao — acompanhamento operacional da cozinha", () => {
  it("mostra o estado real e uma orientação objetiva quando o pedido fica pronto", async () => {
    const user = userEvent.setup();
    comandas.push({
      id: "c-pronto", numero: 21, cliente: "Joana", mesa: "3", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }],
      status: "enviada", abertaEm: new Date().toISOString(), pedidoId: "ped-pronto", pedidoNumero: 21,
      rodadas: [{
        id: "r-pronto", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12,
        criadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(), enviadaEm: new Date().toISOString(), pedidoId: "ped-pronto", pedidoNumero: 21,
        pedidoStatus: "saiu_entrega",
      }],
    });

    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    await user.click(screen.getByRole("button", { name: /Pedidos abertos/ }));

    expect(await screen.findByText("Pronto para servir")).toBeInTheDocument();
    expect(screen.getByText(/Retire o pedido na cozinha e leve até a mesa/)).toBeInTheDocument();
  });

  it("atualiza o estágio quando o aparelho volta ao foco, sem exigir recarregar a página", async () => {
    const user = userEvent.setup();
    comandas.push({
      id: "c-foco", numero: 22, cliente: "Rita", mesa: "4", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }],
      status: "enviada", abertaEm: new Date().toISOString(), pedidoId: "ped-foco", pedidoNumero: 22,
      rodadas: [{
        id: "r-foco", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12,
        criadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(), enviadaEm: new Date().toISOString(), pedidoId: "ped-foco", pedidoNumero: 22,
        pedidoStatus: "em_preparo",
      }],
    });

    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    await user.click(screen.getByRole("button", { name: /Pedidos abertos/ }));
    expect(await screen.findByText("Em preparo")).toBeInTheDocument();

    comandas[0].rodadas[0].pedidoStatus = "saiu_entrega";
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.getByText("Pronto para servir")).toBeInTheDocument());
  });

  it("se uma atualização falha, invalida o status antigo em vez de continuar mostrando informação velha como atual", async () => {
    const user = userEvent.setup();
    comandas.push({
      id: "c-stale", numero: 24, cliente: "Marta", mesa: "6", itens: [{ kind: "simple", name: "Água com gás", price: 6, qty: 1 }],
      status: "enviada", abertaEm: new Date().toISOString(), pedidoId: "ped-stale", pedidoNumero: 24,
      rodadas: [{
        id: "r-stale", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Água com gás", price: 6, qty: 1 }], subtotal: 6,
        criadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(), enviadaEm: new Date().toISOString(), pedidoId: "ped-stale", pedidoNumero: 24,
        pedidoStatus: "saiu_entrega",
      }],
    });

    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    await user.click(screen.getByRole("button", { name: /Pedidos abertos/ }));
    expect(await screen.findByText("Pronto para servir")).toBeInTheDocument();

    falharProximaListagem = true;
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.getByText("Atualização pendente")).toBeInTheDocument());
    expect(screen.queryByText("Pronto para servir")).not.toBeInTheDocument();
  });

  it("em uma comanda com vários envios, o pedido pronto sobe como ação mais urgente", async () => {
    const user = userEvent.setup();
    const agora = new Date().toISOString();
    comandas.push({
      id: "c-multi", numero: 25, cliente: "Nina", mesa: "7", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }],
      status: "enviada", abertaEm: agora, pedidoId: "ped-multi-1", pedidoNumero: 25,
      rodadas: [
        { id: "r-multi-1", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }], subtotal: 12, criadaEm: agora, atualizadaEm: agora, enviadaEm: agora, pedidoId: "ped-multi-1", pedidoNumero: 25, pedidoStatus: "em_preparo" },
        { id: "r-multi-2", numero: 2, status: "enviada", itens: [{ kind: "simple", name: "Água com gás", price: 6, qty: 1 }], subtotal: 6, criadaEm: agora, atualizadaEm: agora, enviadaEm: agora, pedidoId: "ped-multi-2", pedidoNumero: 26, pedidoStatus: "saiu_entrega" },
      ],
    });

    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    await user.click(screen.getByRole("button", { name: /Pedidos abertos/ }));

    expect(await screen.findByText("Pronto para servir")).toBeInTheDocument();
    expect(screen.getByText(/Retire o pedido na cozinha e leve até a mesa/)).toBeInTheDocument();
  });

  it("não mente quando a rodada enviada ainda não conseguiu sincronizar com o pedido oficial", async () => {
    const user = userEvent.setup();
    comandas.push({
      id: "c-sync", numero: 23, cliente: "Lia", mesa: "5", itens: [{ kind: "simple", name: "Água com gás", price: 6, qty: 1 }],
      status: "enviada", abertaEm: new Date().toISOString(), pedidoId: "ped-sync", pedidoNumero: 23,
      rodadas: [{
        id: "r-sync", numero: 1, status: "enviada", itens: [{ kind: "simple", name: "Água com gás", price: 6, qty: 1 }], subtotal: 6,
        criadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(), enviadaEm: new Date().toISOString(), pedidoId: "ped-sync", pedidoNumero: 23,
      }],
    });

    render(<SalaoPage />);
    await screen.findByText("Novo atendimento");
    await user.click(screen.getByRole("button", { name: /Pedidos abertos/ }));

    expect(await screen.findByText("Atualização pendente")).toBeInTheDocument();
    expect(screen.getByText(/Atualize antes de tomar uma decisão sobre a mesa/)).toBeInTheDocument();
  });
});
