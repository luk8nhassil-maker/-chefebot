import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) || 0) + 1;
      store.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

const CARDAPIO_TESTE = {
  sizes: [{ code: "P", label: "Pequena", price: 30 }, { code: "G", label: "Grande", price: 50 }],
  saltyFlavors: ["Quatro Queijos"],
  sweetFlavors: [],
  borders: [],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }],
  sucos: [],
  neighborhoods: [],
};

import {
  abrirComanda,
  atualizarIdentificacaoComanda,
  atualizarItensComanda,
  atualizarItensRodada,
  buscarComanda,
  comRodadasNormalizadas,
  criarRodadaEmRascunho,
  descartarComandaVazia,
  fecharComanda,
  listarComandas,
  marcarComandaEnviada,
  totalParcialComanda,
  validarItensComanda,
  type Comanda,
} from "./comandas";

async function abrirComandaOk(mesa: string, complemento?: string): Promise<Comanda> {
  const r = await abrirComanda({ cliente: "Cliente Teste", mesa, complemento });
  if (typeof r !== "object") throw new Error(`esperava Comanda, recebeu "${r}"`);
  return r;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  store.set("cardapio", CARDAPIO_TESTE);
});

describe("abrirComanda", () => {
  it("cria uma comanda aberta, sem itens, com número sequencial", async () => {
    const c1 = await abrirComanda({ cliente: "Ana", mesa: "5" });
    const c2 = await abrirComanda({ cliente: "Bia", mesa: "6", complemento: "Terraço" });
    if (typeof c1 !== "object" || typeof c2 !== "object") throw new Error("esperava Comanda");
    expect(c1.status).toBe("aberta");
    expect(c1.cliente).toBe("Ana");
    expect(c1.itens).toEqual([]);
    expect(c1.numero).toBe(1);
    expect(c2.numero).toBe(2);
    expect(c2.complemento).toBe("Terraço");
  });

  it("aparece na listagem", async () => {
    await abrirComanda({ cliente: "Ana", mesa: "5" });
    expect(await listarComandas()).toHaveLength(1);
  });

  it("recusa abrir uma segunda comanda para a mesma mesa ainda não fechada", async () => {
    const c1 = await abrirComanda({ cliente: "Ana", mesa: "7" });
    if (typeof c1 !== "object") throw new Error("esperava Comanda");
    const r2 = await abrirComanda({ cliente: "Bia", mesa: "7" });
    expect(r2).toBe("mesa_ocupada");
    expect(await listarComandas()).toHaveLength(1);
  });

  it("permite reabrir a mesma mesa depois que a comanda anterior foi fechada", async () => {
    const c1 = await abrirComanda({ cliente: "Ana", mesa: "7" });
    if (typeof c1 !== "object") throw new Error("esperava Comanda");
    await marcarComandaEnviada(c1.id, "ped_1", 1);
    await fecharComanda(c1.id);
    const r2 = await abrirComanda({ cliente: "Bia", mesa: "7" });
    expect(typeof r2).toBe("object");
    expect(await listarComandas()).toHaveLength(2);
  });

  it("duas aberturas concorrentes da mesma mesa — só uma vira comanda, a outra é recusada", async () => {
    const [a, b] = await Promise.all([
      abrirComanda({ cliente: "Ana", mesa: "9" }),
      abrirComanda({ cliente: "Bia", mesa: "9" }),
    ]);
    const resultados = [a, b];
    expect(resultados.filter((r) => typeof r === "object")).toHaveLength(1);
    expect(resultados.filter((r) => r === "mesa_ocupada")).toHaveLength(1);
    expect(await listarComandas()).toHaveLength(1);
  });

  it("cliente obrigatório, mesa opcional — cria uma comanda 'Sem mesa'", async () => {
    const c = await abrirComanda({ cliente: "Ana" });
    if (typeof c !== "object") throw new Error("esperava Comanda");
    expect(c.cliente).toBe("Ana");
    expect(c.mesa).toBeUndefined();
  });

  it("duas comandas 'Sem mesa' nunca colidem entre si", async () => {
    const c1 = await abrirComanda({ cliente: "Ana" });
    const c2 = await abrirComanda({ cliente: "Bia" });
    expect(typeof c1).toBe("object");
    expect(typeof c2).toBe("object");
    expect(await listarComandas()).toHaveLength(2);
  });
});

describe("validarItensComanda", () => {
  it("recusa lista vazia", async () => {
    const r = await validarItensComanda([]);
    expect(r.ok).toBe(false);
  });

  it("recusa item fora do cardápio", async () => {
    const r = await validarItensComanda([{ kind: "simple", name: "Produto Fantasma", qty: 1 }]);
    expect(r.ok).toBe(false);
  });

  it("recusa item promocional", async () => {
    const r = await validarItensComanda([{ kind: "promo", name: "Refrigerante 2L", qty: 1, promoId: "x" }]);
    expect(r.ok).toBe(false);
  });

  it("recusa preço vindo do cliente — sempre recalcula pelo cardápio oficial", async () => {
    const r = await validarItensComanda([{ kind: "simple", name: "Refrigerante 2L", qty: 2, price: 0.01 }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.itens[0].price).toBe(12);
      expect(r.total).toBe(24);
    }
  });

  it("recusa quantidade inválida", async () => {
    const r = await validarItensComanda([{ kind: "simple", name: "Refrigerante 2L", qty: 0 }]);
    expect(r.ok).toBe(false);
  });
});

describe("atualizarItensComanda", () => {
  it("atualiza itens, observação e complemento de uma comanda aberta", async () => {
    const c = await abrirComandaOk("5");
    const validacao = await validarItensComanda([{ kind: "simple", name: "Refrigerante 2L", qty: 1 }]);
    expect(validacao.ok).toBe(true);
    if (!validacao.ok) return;
    const atualizada = await atualizarItensComanda(c.id, validacao.itens, { observacao: "Sem gelo", complemento: "Varanda" });
    expect(atualizada).not.toBe("nao_encontrada");
    expect(atualizada).not.toBe("nao_esta_aberta");
    if (typeof atualizada === "object") {
      expect(atualizada.itens).toHaveLength(1);
      expect(atualizada.observacao).toBe("Sem gelo");
      expect(atualizada.complemento).toBe("Varanda");
    }
  });

  it("devolve nao_encontrada para id inexistente", async () => {
    const r = await atualizarItensComanda("comanda_inexistente", []);
    expect(r).toBe("nao_encontrada");
  });

  it("recusa atualizar uma comanda que não está mais aberta", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 10);
    const r = await atualizarItensComanda(c.id, []);
    expect(r).toBe("nao_esta_aberta");
  });
});

describe("marcarComandaEnviada", () => {
  it("marca como enviada e guarda o vínculo com o pedido", async () => {
    const c = await abrirComandaOk("5");
    const r = await marcarComandaEnviada(c.id, "ped_123", 42);
    expect(r).not.toBe("nao_encontrada");
    if (typeof r === "object") {
      expect(r.status).toBe("enviada");
      expect(r.pedidoId).toBe("ped_123");
      expect(r.pedidoNumero).toBe(42);
      expect(r.enviadaEm).toBeTruthy();
    }
  });

  it("recusa marcar como enviada uma comanda que já foi enviada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_123", 42);
    const r = await marcarComandaEnviada(c.id, "ped_456", 43);
    expect(r).toBe("nao_esta_aberta");
  });
});

describe("fecharComanda", () => {
  it("recusa fechar uma comanda ainda aberta (sem pedido enviado)", async () => {
    const c = await abrirComandaOk("5");
    const r = await fecharComanda(c.id);
    expect(r).toBe("ainda_aberta");
  });

  it("fecha uma comanda já enviada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_123", 42);
    const r = await fecharComanda(c.id);
    expect(r).not.toBe("nao_encontrada");
    if (typeof r === "object") {
      expect(r.status).toBe("fechada");
      expect(r.fechadaEm).toBeTruthy();
    }
  });

  it("recusa fechar uma comanda já fechada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_123", 42);
    await fecharComanda(c.id);
    const r = await fecharComanda(c.id);
    expect(r).toBe("ja_fechada");
  });
});

describe("atualizarIdentificacaoComanda", () => {
  it("grava cliente/mesa/whatsapp de uma comanda ainda anônima (aberta direto no catálogo)", async () => {
    const anonima = await abrirComanda({});
    if (typeof anonima !== "object") throw new Error("esperava Comanda");
    const r = await atualizarIdentificacaoComanda(anonima.id, { cliente: "João", mesa: "4", whatsapp: "11999998888" });
    if (typeof r !== "object") throw new Error(`esperava Comanda, recebeu "${r}"`);
    expect(r.cliente).toBe("João");
    expect(r.mesa).toBe("4");
    expect(r.whatsapp).toBe("11999998888");
  });

  it("'semMesa' limpa a mesa mesmo que já tivesse sido informada antes", async () => {
    const c = await abrirComandaOk("9");
    const r = await atualizarIdentificacaoComanda(c.id, { cliente: "Bia", semMesa: true });
    if (typeof r !== "object") throw new Error(`esperava Comanda, recebeu "${r}"`);
    expect(r.mesa).toBeUndefined();
  });

  it("recusa mesa já ocupada por outra comanda aberta", async () => {
    await abrirComandaOk("8");
    const outra = await abrirComanda({});
    if (typeof outra !== "object") throw new Error("esperava Comanda");
    const r = await atualizarIdentificacaoComanda(outra.id, { cliente: "Ana", mesa: "8" });
    expect(r).toBe("mesa_ocupada");
  });

  it("nao_encontrada para id inexistente", async () => {
    const r = await atualizarIdentificacaoComanda("comanda_inexistente", { cliente: "Ana" });
    expect(r).toBe("nao_encontrada");
  });

  it("nao_esta_aberta depois que a comanda já foi enviada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const r = await atualizarIdentificacaoComanda(c.id, { cliente: "Outro nome" });
    expect(r).toBe("nao_esta_aberta");
  });
});

describe("descartarComandaVazia", () => {
  it("remove uma comanda aberta que ainda não enviou nada, mesmo com itens no rascunho", async () => {
    const c = await abrirComandaOk("3");
    await atualizarItensComanda(c.id, [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }]);
    const r = await descartarComandaVazia(c.id);
    expect(r).toBe("ok");
    expect(await buscarComanda(c.id)).toBeNull();
  });

  it("recusa descartar depois que já enviou ao menos um pedido", async () => {
    const c = await abrirComandaOk("3");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const r = await descartarComandaVazia(c.id);
    expect(r).toBe("ja_enviada");
    expect(await buscarComanda(c.id)).not.toBeNull();
  });

  it("nao_encontrada para id inexistente", async () => {
    const r = await descartarComandaVazia("comanda_inexistente");
    expect(r).toBe("nao_encontrada");
  });
});

describe("buscarComanda", () => {
  it("devolve null para id inexistente", async () => {
    expect(await buscarComanda("nao_existe")).toBeNull();
  });
});

async function itensRefrigerante(qty: number) {
  const v = await validarItensComanda([{ kind: "simple", name: "Refrigerante 2L", qty }]);
  if (!v.ok) throw new Error("validação falhou no teste");
  return v.itens;
}

describe("comRodadasNormalizadas — comandas antigas viram Rodada 1", () => {
  it("comanda aberta (sem rodadas) vira Rodada 1 em rascunho", async () => {
    const c = await abrirComandaOk("5");
    const itens = await itensRefrigerante(2);
    await atualizarItensComanda(c.id, itens);
    const bruta = await buscarComanda(c.id);
    const normalizada = comRodadasNormalizadas(bruta!);
    expect(normalizada.rodadas).toHaveLength(1);
    expect(normalizada.rodadas![0].numero).toBe(1);
    expect(normalizada.rodadas![0].status).toBe("rascunho");
    expect(normalizada.rodadas![0].itens).toEqual(itens);
    expect(normalizada.rodadas![0].subtotal).toBe(24);
  });

  it("comanda enviada (sem rodadas) vira Rodada 1 enviada, com pedidoId preservado", async () => {
    const c = await abrirComandaOk("5");
    const r = await marcarComandaEnviada(c.id, "ped_123", 42);
    if (typeof r !== "object") throw new Error("esperava Comanda");
    const normalizada = comRodadasNormalizadas(r);
    expect(normalizada.rodadas).toHaveLength(1);
    expect(normalizada.rodadas![0].status).toBe("enviada");
    expect(normalizada.rodadas![0].pedidoId).toBe("ped_123");
    expect(normalizada.rodadas![0].pedidoNumero).toBe(42);
    expect(normalizada.rodadas![0].enviadaEm).toBeTruthy();
  });

  it("nunca apaga os campos antigos (itens, pedidoId) ao normalizar", async () => {
    const c = await abrirComandaOk("5");
    const r = await marcarComandaEnviada(c.id, "ped_123", 42);
    if (typeof r !== "object") throw new Error("esperava Comanda");
    const normalizada = comRodadasNormalizadas(r);
    expect(normalizada.itens).toEqual(r.itens);
    expect(normalizada.pedidoId).toBe("ped_123");
  });

  it("comanda que já tem rodadas volta como está (não normaliza de novo)", async () => {
    const c = await abrirComandaOk("5");
    const criada = await criarRodadaEmRascunho(c.id);
    if (!criada.ok) throw new Error("esperava sucesso");
    const normalizada = comRodadasNormalizadas(criada.comanda);
    expect(normalizada.rodadas).toBe(criada.comanda.rodadas);
  });
});

describe("criarRodadaEmRascunho", () => {
  it("recusa comanda inexistente", async () => {
    const r = await criarRodadaEmRascunho("comanda_inexistente");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("nao_encontrada");
  });

  it("recusa comanda fechada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    await fecharComanda(c.id);
    const r = await criarRodadaEmRascunho(c.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("comanda_fechada");
  });

  it("cria a Rodada 2 em rascunho depois da Rodada 1 enviada, com número sequencial correto", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const r = await criarRodadaEmRascunho(c.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.criada).toBe(true);
      expect(r.rodada.numero).toBe(2);
      expect(r.rodada.status).toBe("rascunho");
      expect(r.rodada.itens).toEqual([]);
      expect(r.comanda.rodadas).toHaveLength(2);
      expect(r.comanda.rodadas![0].numero).toBe(1);
      expect(r.comanda.rodadas![0].status).toBe("enviada");
    }
  });

  it("comanda 'aberta' (Rodada 1 ainda em rascunho) não ganha uma segunda rodada — devolve a própria Rodada 1", async () => {
    const c = await abrirComandaOk("5");
    const r = await criarRodadaEmRascunho(c.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.criada).toBe(false);
      expect(r.rodada.numero).toBe(1);
    }
  });

  it("nunca existem duas rodadas em rascunho — segunda chamada sem clientRequestId devolve a mesma rodada existente", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const primeira = await criarRodadaEmRascunho(c.id);
    const segunda = await criarRodadaEmRascunho(c.id);
    expect(primeira.ok && segunda.ok).toBe(true);
    if (primeira.ok && segunda.ok) {
      expect(segunda.criada).toBe(false);
      expect(segunda.rodada.id).toBe(primeira.rodada.id);
    }
    const lista = await listarComandas();
    expect(comRodadasNormalizadas(lista[0]).rodadas).toHaveLength(2);
  });

  it("idempotência por clientRequestId: mesma chamada duas vezes devolve a mesma rodada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const primeira = await criarRodadaEmRascunho(c.id, "req-abc");
    const segunda = await criarRodadaEmRascunho(c.id, "req-abc");
    expect(primeira.ok && segunda.ok).toBe(true);
    if (primeira.ok && segunda.ok) {
      expect(primeira.criada).toBe(true);
      expect(segunda.criada).toBe(false);
      expect(segunda.rodada.id).toBe(primeira.rodada.id);
    }
  });

  it("duplo clique / duas abas concorrentes — só uma Rodada 2 é criada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const [a, b] = await Promise.all([criarRodadaEmRascunho(c.id), criarRodadaEmRascunho(c.id)]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      const criadas = [a.criada, b.criada].filter(Boolean);
      expect(criadas).toHaveLength(1);
      expect(a.rodada.id).toBe(b.rodada.id);
    }
    const lista = await listarComandas();
    expect(comRodadasNormalizadas(lista[0]).rodadas).toHaveLength(2);
  });

  it("Redis indisponível: a operação rejeita (o chamador decide o erro seguro)", async () => {
    const c = await abrirComandaOk("5");
    redisMock.set.mockImplementationOnce(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(criarRodadaEmRascunho(c.id)).rejects.toThrow();
  });

  it("nunca cria pedido oficial nem toca em impressão — só devolve a estrutura da rodada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const r = await criarRodadaEmRascunho(c.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rodada.pedidoId).toBeUndefined();
      expect(r.rodada.enviadaEm).toBeUndefined();
    }
  });
});

describe("atualizarItensRodada", () => {
  async function comandaComRodada2() {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const r = await criarRodadaEmRascunho(c.id);
    if (!r.ok) throw new Error("esperava sucesso");
    return { comandaId: c.id, rodadaId: r.rodada.id };
  }

  it("adiciona itens à Rodada 2", async () => {
    const { comandaId, rodadaId } = await comandaComRodada2();
    const itens = await itensRefrigerante(1);
    const r = await atualizarItensRodada(comandaId, rodadaId, itens);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rodada.itens).toEqual(itens);
      expect(r.rodada.subtotal).toBe(12);
    }
  });

  it("altera quantidade (nova chamada substitui a lista completa)", async () => {
    const { comandaId, rodadaId } = await comandaComRodada2();
    await atualizarItensRodada(comandaId, rodadaId, await itensRefrigerante(1));
    const r = await atualizarItensRodada(comandaId, rodadaId, await itensRefrigerante(3));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rodada.subtotal).toBe(36);
  });

  it("remove item (lista vazia é permitida numa rodada em rascunho)", async () => {
    const { comandaId, rodadaId } = await comandaComRodada2();
    await atualizarItensRodada(comandaId, rodadaId, await itensRefrigerante(1));
    const r = await atualizarItensRodada(comandaId, rodadaId, []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rodada.itens).toEqual([]);
      expect(r.rodada.subtotal).toBe(0);
    }
  });

  it("salva observação da rodada", async () => {
    const { comandaId, rodadaId } = await comandaComRodada2();
    const r = await atualizarItensRodada(comandaId, rodadaId, [], { observacao: "Sem canudo" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rodada.observacao).toBe("Sem canudo");
  });

  it("a Rodada 1 permanece intacta ao editar a Rodada 2 — itens não vazam entre rodadas", async () => {
    const c = await abrirComandaOk("5");
    const r1 = await marcarComandaEnviada(c.id, "ped_1", 1);
    if (typeof r1 !== "object") throw new Error("esperava Comanda");
    const rodada1ItensAntes = comRodadasNormalizadas(r1).rodadas![0].itens;

    const criada = await criarRodadaEmRascunho(c.id);
    if (!criada.ok) throw new Error("esperava sucesso");
    await atualizarItensRodada(c.id, criada.rodada.id, await itensRefrigerante(5));

    const final = await buscarComanda(c.id);
    const rodadas = comRodadasNormalizadas(final!).rodadas!;
    expect(rodadas[0].itens).toEqual(rodada1ItensAntes);
    expect(rodadas[1].itens).toHaveLength(1);
  });

  it("recusa editar uma rodada já enviada (imutável)", async () => {
    const c = await abrirComandaOk("5");
    const r1 = await marcarComandaEnviada(c.id, "ped_1", 1);
    if (typeof r1 !== "object") throw new Error("esperava Comanda");
    const rodada1Id = comRodadasNormalizadas(r1).rodadas![0].id;
    const r = await atualizarItensRodada(c.id, rodada1Id, await itensRefrigerante(9));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("rodada_nao_e_rascunho");
  });

  it("recusa rodada inexistente", async () => {
    const c = await abrirComandaOk("5");
    const r = await atualizarItensRodada(c.id, "rodada_inexistente", []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("rodada_nao_encontrada");
  });

  it("recusa comanda fechada", async () => {
    const { comandaId, rodadaId } = await comandaComRodada2();
    await fecharComanda(comandaId);
    const r = await atualizarItensRodada(comandaId, rodadaId, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("comanda_fechada");
  });

  it("recusa comanda inexistente", async () => {
    const r = await atualizarItensRodada("comanda_inexistente", "rodada_x", []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("nao_encontrada");
  });
});

describe("totalParcialComanda", () => {
  it("soma o subtotal de todas as rodadas (enviada + rascunho)", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1); // Rodada 1: sem itens reais neste teste (itens vazios = subtotal 0)
    const criada = await criarRodadaEmRascunho(c.id);
    if (!criada.ok) throw new Error("esperava sucesso");
    await atualizarItensRodada(c.id, criada.rodada.id, await itensRefrigerante(2));

    const final = await buscarComanda(c.id);
    expect(totalParcialComanda(final!)).toBe(24);
  });

  it("Rodada 1 com itens reais soma junto com a Rodada 2", async () => {
    const c = await abrirComandaOk("5");
    await atualizarItensComanda(c.id, await itensRefrigerante(1)); // Rodada 1 = R$ 12
    const r1 = await marcarComandaEnviada(c.id, "ped_1", 1);
    if (typeof r1 !== "object") throw new Error("esperava Comanda");

    const criada = await criarRodadaEmRascunho(c.id);
    if (!criada.ok) throw new Error("esperava sucesso");
    await atualizarItensRodada(c.id, criada.rodada.id, await itensRefrigerante(2)); // Rodada 2 = R$ 24

    const final = await buscarComanda(c.id);
    expect(totalParcialComanda(final!)).toBe(36);
  });
});

describe("rodadas — isolamento de outros fluxos", () => {
  it("criar/atualizar rodada nunca chama redis.set na chave de impressão automática", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 1);
    const criada = await criarRodadaEmRascunho(c.id);
    if (!criada.ok) throw new Error("esperava sucesso");
    await atualizarItensRodada(c.id, criada.rodada.id, await itensRefrigerante(1));

    const chamadasImpressao = redisMock.set.mock.calls.filter(([chave]: [string, ...unknown[]]) =>
      typeof chave === "string" && chave.startsWith("pedido:auto-print-claim:")
    );
    expect(chamadasImpressao).toHaveLength(0);
  });
});
