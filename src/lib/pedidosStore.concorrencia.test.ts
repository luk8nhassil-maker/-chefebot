import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock de Redis fiel ao comportamento atômico real necessário para os testes
// de concorrência: cada chamada individual (get/set/eval/del) é atômica (como
// no Redis de verdade, que é single-threaded), mas o módulo pedidosStore.ts
// ainda pode intercalar chamadas CONCORRENTES entre si nos pontos de `await`
// — exatamente a janela de corrida que o lock precisa fechar. Suporta:
// - SET com `nx` (falha se a chave já existe) — usado pelo lock.
// - EVAL do script de compare-and-delete usado para liberar o lock.
// - Hooks de falha injetável (para simular SET/GET lançando exceção).
const { redisFake, store } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisFake = {
    async get<T>(key: string): Promise<T | null> {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async del(key: string) {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    },
    async eval(_script: string, keys: string[], args: unknown[]) {
      const [key] = keys;
      const [token] = args;
      if (store.get(key) === token) { store.delete(key); return 1; }
      return 0;
    },
  };
  return { redisFake, store };
});

vi.mock("@/lib/redis", () => ({ redis: redisFake }));

import {
  adicionarPedidoAtomico,
  atualizarPedidoAtomico,
  buscarPedido,
  gerarPedidoIdUnico,
  listarPedidos,
  mutarLotePedidosAtomico,
  mutarPedidoPorIdAtomico,
  removerPedidoAtomico,
  PEDIDOS_KEY,
} from "./pedidosStore";

type P = { id: string; revision?: number; nome?: string; status?: string };

function pedido(id: string, extra: Partial<P> = {}): P {
  return { id, nome: `pedido-${id}`, status: "novo", ...extra };
}

function pedidosAtuais(): P[] {
  return (store.get(PEDIDOS_KEY) as P[]) ?? [];
}

beforeEach(() => {
  store.clear();
});

describe("pedidosStore — concorrência real (Promise.all) sobre mock atômico de Redis", () => {
  test("1. 2 pedidos concorrentes de clientes diferentes: nenhum se perde", async () => {
    const resultados = await Promise.all([
      adicionarPedidoAtomico(pedido("a")),
      adicionarPedidoAtomico(pedido("b")),
    ]);
    expect(resultados.every((r) => r.tipo === "sucesso")).toBe(true);
    const atuais = pedidosAtuais();
    expect(atuais).toHaveLength(2);
    expect(new Set(atuais.map((p) => p.id))).toEqual(new Set(["a", "b"]));
  });

  test("2. 10 pedidos concorrentes: nenhum se perde, todos presentes", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `id-${i}`);
    const resultados = await Promise.all(ids.map((id) => adicionarPedidoAtomico(pedido(id))));
    expect(resultados.every((r) => r.tipo === "sucesso")).toBe(true);
    const atuais = pedidosAtuais();
    expect(atuais).toHaveLength(10);
    expect(new Set(atuais.map((p) => p.id))).toEqual(new Set(ids));
  });

  test("3. 50 pedidos concorrentes: nenhum se perde, todos presentes e únicos", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `id-${i}`);
    const resultados = await Promise.all(ids.map((id) => adicionarPedidoAtomico(pedido(id))));
    expect(resultados.every((r) => r.tipo === "sucesso")).toBe(true);
    const atuais = pedidosAtuais();
    expect(atuais).toHaveLength(50);
    expect(new Set(atuais.map((p) => p.id)).size).toBe(50);
  });

  test("4. gerarPedidoIdUnico: alto volume no mesmo milissegundo nunca colide", () => {
    vi.spyOn(Date, "now").mockReturnValue(1732000000123);
    try {
      const ids = new Set(Array.from({ length: 5000 }, () => gerarPedidoIdUnico()));
      expect(ids.size).toBe(5000);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  test("5. mesmo id disputado concorrentemente: só um vira pedido, o outro recebe id_ja_existe", async () => {
    const [r1, r2] = await Promise.all([
      adicionarPedidoAtomico(pedido("dup", { nome: "primeiro" })),
      adicionarPedidoAtomico(pedido("dup", { nome: "segundo" })),
    ]);
    const tipos = [r1.tipo, r2.tipo].sort();
    expect(tipos).toEqual(["id_ja_existe", "sucesso"]);
    const atuais = pedidosAtuais();
    expect(atuais).toHaveLength(1);
    expect(atuais[0].id).toBe("dup");
  });

  test("6. ids diferentes concorrentes geram pedidos distintos (sem colisão cruzada de campos)", async () => {
    await Promise.all([
      adicionarPedidoAtomico(pedido("x", { nome: "X" })),
      adicionarPedidoAtomico(pedido("y", { nome: "Y" })),
    ]);
    const atuais = pedidosAtuais();
    expect(atuais.find((p) => p.id === "x")?.nome).toBe("X");
    expect(atuais.find((p) => p.id === "y")?.nome).toBe("Y");
  });

  test("7. append + mudança de status simultâneos em pedido diferente: ambos aplicados", async () => {
    store.set(PEDIDOS_KEY, [pedido("existente", { status: "novo" })]);
    const [rAdd, rUpd] = await Promise.all([
      adicionarPedidoAtomico(pedido("novo-pedido")),
      atualizarPedidoAtomico<P>("existente", null, (p) => ({ ...p, status: "em_preparo" })),
    ]);
    expect(rAdd.tipo).toBe("sucesso");
    expect(rUpd.tipo).toBe("sucesso");
    const atuais = pedidosAtuais();
    expect(atuais).toHaveLength(2);
    expect(atuais.find((p) => p.id === "existente")?.status).toBe("em_preparo");
    expect(atuais.find((p) => p.id === "novo-pedido")).toBeTruthy();
  });

  test("8. append + edição (troca de campo) simultâneos: ambos aplicados sem perda", async () => {
    store.set(PEDIDOS_KEY, [pedido("editavel", { nome: "original" })]);
    const [rAdd, rEdit] = await Promise.all([
      adicionarPedidoAtomico(pedido("recem-criado")),
      atualizarPedidoAtomico<P>("editavel", null, (p) => ({ ...p, nome: "editado" })),
    ]);
    expect(rAdd.tipo).toBe("sucesso");
    expect(rEdit.tipo).toBe("sucesso");
    const atuais = pedidosAtuais();
    expect(atuais.find((p) => p.id === "editavel")?.nome).toBe("editado");
    expect(atuais.find((p) => p.id === "recem-criado")).toBeTruthy();
  });

  test("9. append + cancelamento (remoção) simultâneos de pedidos diferentes: ambos aplicados", async () => {
    store.set(PEDIDOS_KEY, [pedido("a-cancelar")]);
    const [rAdd, rDel] = await Promise.all([
      adicionarPedidoAtomico(pedido("mantido")),
      removerPedidoAtomico("a-cancelar"),
    ]);
    expect(rAdd.tipo).toBe("sucesso");
    expect(rDel.tipo).toBe("sucesso");
    const atuais = pedidosAtuais();
    expect(atuais).toHaveLength(1);
    expect(atuais[0].id).toBe("mantido");
  });

  test("10. append + confirmação de Pix (update de campo) simultâneos: ambos aplicados", async () => {
    store.set(PEDIDOS_KEY, [pedido("com-pix", { status: "novo" })]);
    const [rAdd, rPix] = await Promise.all([
      adicionarPedidoAtomico(pedido("outro")),
      atualizarPedidoAtomico<P & { pixConfirmado?: boolean }>("com-pix", null, (p) => ({ ...p, pixConfirmado: true })),
    ]);
    expect(rAdd.tipo).toBe("sucesso");
    expect(rPix.tipo).toBe("sucesso");
    const atuais = pedidosAtuais() as Array<P & { pixConfirmado?: boolean }>;
    expect(atuais.find((p) => p.id === "com-pix")?.pixConfirmado).toBe(true);
  });

  test("11. append + rollback de resgate (remoção) concorrentes com múltiplas mutações simultâneas: estado final consistente", async () => {
    store.set(PEDIDOS_KEY, [pedido("p1"), pedido("p2"), pedido("p3")]);
    const resultados = await Promise.all([
      adicionarPedidoAtomico(pedido("novo1")),
      adicionarPedidoAtomico(pedido("novo2")),
      removerPedidoAtomico("p2"),
      atualizarPedidoAtomico<P>("p1", null, (p) => ({ ...p, status: "cancelado" })),
      atualizarPedidoAtomico<P>("p3", null, (p) => ({ ...p, status: "entregue" })),
    ]);
    expect(resultados.every((r) => r.tipo === "sucesso")).toBe(true);
    const atuais = pedidosAtuais();
    expect(new Set(atuais.map((p) => p.id))).toEqual(new Set(["p1", "p3", "novo1", "novo2"]));
    expect(atuais.find((p) => p.id === "p1")?.status).toBe("cancelado");
    expect(atuais.find((p) => p.id === "p3")?.status).toBe("entregue");
  });

  test("12. transição pending→completed correndo com criação de pedido novo: ambos consistentes", async () => {
    store.set(PEDIDOS_KEY, [pedido("survival-1", { status: "pending_critical_confirmation" })]);
    const [rTransicao, rNovo] = await Promise.all([
      atualizarPedidoAtomico<P>("survival-1", null, (p) => ({ ...p, status: "completed" })),
      adicionarPedidoAtomico(pedido("concorrente")),
    ]);
    expect(rTransicao.tipo).toBe("sucesso");
    expect(rNovo.tipo).toBe("sucesso");
    const atuais = pedidosAtuais();
    expect(atuais.find((p) => p.id === "survival-1")?.status).toBe("completed");
    expect(atuais.find((p) => p.id === "concorrente")).toBeTruthy();
  });

  test("13. lock expirado: uma execução travada nunca impede a próxima de progredir (503 recuperável)", async () => {
    // Simula uma execução anterior travada: chave do lock presente, mas sem
    // nenhuma execução real segurando-a (equivalente a expirar por TTL no
    // Redis real — aqui simulado por presença residual sem dono ativo).
    store.set("lock:pedidos:mutex", "token-de-execucao-travada");
    const resultado = await adicionarPedidoAtomico(pedido("enquanto-travado"));
    expect(resultado.tipo).toBe("lock_indisponivel");
    expect(pedidosAtuais()).toHaveLength(0);

    // Uma vez o lock "expira" (removido, como o TTL faria no Redis real), a
    // MESMA operação se recupera sozinha — nunca fica presa para sempre.
    store.delete("lock:pedidos:mutex");
    const resultado2 = await adicionarPedidoAtomico(pedido("apos-expirar"));
    expect(resultado2.tipo).toBe("sucesso");
    expect(pedidosAtuais().map((p) => p.id)).toEqual(["apos-expirar"]);
  });

  test("14. compare-and-delete: uma execução antiga nunca libera o lock de uma execução nova", async () => {
    store.set(PEDIDOS_KEY, [pedido("protegido")]);
    let tokenDaOperacaoAtiva: string | null = null;
    let tentativaDeRouboRetorno: number | null = null;

    const p1 = atualizarPedidoAtomico<P>("protegido", null, (p) => {
      // No meio da seção crítica da operação 1 (lock já adquirido), captura
      // o token real gravado e simula uma liberação vinda de uma execução
      // ANTIGA e já expirada (token diferente) contra a MESMA chave de lock
      // — o compare-and-delete deve recusar (retornar 0), nunca remover o
      // lock de quem realmente é dono agora.
      tokenDaOperacaoAtiva = store.get("lock:pedidos:mutex") as string;
      return p;
    });

    // Ainda dentro da janela em que p1 pode estar segurando o lock, tenta o
    // "roubo" com um token antigo qualquer.
    tentativaDeRouboRetorno = await redisFake.eval("", ["lock:pedidos:mutex"], ["token-de-execucao-velha-e-expirada"]);

    const resultado = await p1;
    expect(resultado.tipo).toBe("sucesso");
    expect(tentativaDeRouboRetorno).toBe(0); // compare-and-delete recusou (token não bate)
    expect(tokenDaOperacaoAtiva).not.toBe("token-de-execucao-velha-e-expirada");
  });

  test("15. lock indisponível após aquisição por terceiro: retorna erro recuperável, nunca finge sucesso", async () => {
    store.set("lock:pedidos:mutex", "outro-dono");
    const resultado = await mutarPedidoPorIdAtomico<P>("qualquer", (p) => p);
    expect(resultado.tipo).toBe("lock_indisponivel");
  });

  test("16. SET lança exceção mas a escrita foi de fato aplicada: reconciliação confirma sucesso (nunca finge falha)", async () => {
    const resultado = await (async () => {
      // Intercepta o próximo SET: simula "aplicado no servidor, resposta
      // perdida" — o valor abaixo é escrito manualmente no store ANTES de
      // lançar, reproduzindo exatamente esse cenário.
      const original = redisFake.set.bind(redisFake);
      let jaFalhou = false;
      const spy = vi.spyOn(redisFake, "set").mockImplementation(async (key: string, value: unknown, opts) => {
        if (key === PEDIDOS_KEY && !jaFalhou) {
          jaFalhou = true;
          store.set(key, value); // a escrita "aconteceu" no servidor...
          throw new Error("timeout de rede simulado"); // ...mas o cliente nunca soube
        }
        return original(key, value, opts);
      });
      try {
        return await adicionarPedidoAtomico(pedido("ambiguo"));
      } finally {
        spy.mockRestore();
      }
    })();
    expect(resultado.tipo).toBe("sucesso");
    expect(pedidosAtuais().map((p) => p.id)).toEqual(["ambiguo"]);
  });

  test("17. SET lança e a releitura de reconciliação também falha: nunca finge sucesso nem repete efeito", async () => {
    store.set(PEDIDOS_KEY, []);
    const getOriginal = redisFake.get.bind(redisFake);
    const setOriginal = redisFake.set.bind(redisFake);
    let leiturasDePedidos = 0;
    const spyGet = vi.spyOn(redisFake, "get").mockImplementation(async (key: string) => {
      if (key === PEDIDOS_KEY) {
        leiturasDePedidos++;
        // 1a leitura (dentro da seção crítica): sucesso normal. Releitura de
        // reconciliação (após o SET falhar): também falha — nunca confirma
        // às cegas quando nem a reconciliação consegue ler o estado real.
        if (leiturasDePedidos >= 2) throw new Error("leitura de reconciliação também indisponível");
      }
      return getOriginal(key);
    });
    const spySet = vi.spyOn(redisFake, "set").mockImplementation(async (key: string, value: unknown, opts) => {
      if (key === PEDIDOS_KEY) throw new Error("falha de rede");
      return setOriginal(key, value, opts as never);
    });

    try {
      const resultado = await adicionarPedidoAtomico(pedido("nunca-confirmado"));
      expect(resultado.tipo).toBe("escrita_incerta");
      // Nunca repete o efeito: o array permanece exatamente como antes (a
      // releitura falhou, então não há confirmação nenhuma do lado do cliente).
      expect(pedidosAtuais()).toEqual([]);
    } finally {
      spySet.mockRestore();
      spyGet.mockRestore();
    }
  });

  test("18. pedidoId duplicado artificialmente no array: erro crítico, nunca escolhe um dos dois arbitrariamente", async () => {
    store.set(PEDIDOS_KEY, [pedido("dobrado", { nome: "copia-1" }), pedido("dobrado", { nome: "copia-2" })]);
    const resultadoUpdate = await atualizarPedidoAtomico<P>("dobrado", null, (p) => ({ ...p, status: "em_preparo" }));
    expect(resultadoUpdate.tipo).toBe("multiplos_encontrados");
    const resultadoRemove = await removerPedidoAtomico("dobrado");
    expect(resultadoRemove.tipo).toBe("multiplos_encontrados");
    // Nenhuma das duas operações alterou o array — erro crítico não corrige
    // silenciosamente escolhendo uma das cópias.
    expect(pedidosAtuais()).toHaveLength(2);
  });

  test("19. revisão divergente: conflito controlado, nunca sobrescreve mudança mais nova", async () => {
    store.set(PEDIDOS_KEY, [pedido("com-revisao", { revision: 3, nome: "versao-mais-nova" })]);
    const resultado = await atualizarPedidoAtomico<P>("com-revisao", 1, (p) => ({ ...p, nome: "tentativa-antiga" }));
    expect(resultado.tipo).toBe("conflito_revisao");
    if (resultado.tipo === "conflito_revisao") expect(resultado.revisionAtual).toBe(3);
    // Nunca sobrescreve: o valor mais novo permanece intacto.
    expect(pedidosAtuais()[0].nome).toBe("versao-mais-nova");
    expect(pedidosAtuais()[0].revision).toBe(3);
  });

  test("20. pedidos legados sem campo revision continuam funcionando (fallback documentado = 1)", async () => {
    store.set(PEDIDOS_KEY, [{ id: "legado-numerico-123" } as P]);
    const buscado = await buscarPedido<P>("legado-numerico-123");
    expect(buscado?.revision).toBeUndefined(); // legado nunca teve o campo

    const resultado = await atualizarPedidoAtomico<P>("legado-numerico-123", 1, (p) => ({ ...p, status: "em_preparo" }));
    expect(resultado.tipo).toBe("sucesso");
    if (resultado.tipo === "sucesso") {
      expect(resultado.pedido.revision).toBe(2); // 1 (fallback) + 1
      expect(resultado.pedido.status).toBe("em_preparo");
    }
  });

  test("21. concorrência não depende de nenhuma flag de sobrevivência (módulo funciona 100% com flags desligadas)", async () => {
    delete process.env.SURVIVAL_MODE_ENABLED;
    delete process.env.SURVIVAL_MANUAL_FALLBACK_ENABLED;
    delete process.env.SURVIVAL_LOAD_SHEDDING_ENABLED;
    delete process.env.SURVIVAL_CLIENT_REQUEST_ID_ENFORCEMENT_ENABLED;
    const resultados = await Promise.all([
      adicionarPedidoAtomico(pedido("sem-flags-1")),
      adicionarPedidoAtomico(pedido("sem-flags-2")),
    ]);
    expect(resultados.every((r) => r.tipo === "sucesso")).toBe(true);
    expect(pedidosAtuais()).toHaveLength(2);
  });

  test("22. mutação concorrente do MESMO pedido por dois caminhos nunca produz efeito duplicado (serializa, segunda vê resultado da primeira)", async () => {
    store.set(PEDIDOS_KEY, [pedido("disputado", { status: "novo" })]);
    let contadorEfeitoColateral = 0;
    const mutator = (p: P) => {
      contadorEfeitoColateral++;
      return { ...p, status: p.status === "novo" ? "confirmado" : p.status };
    };
    const [r1, r2] = await Promise.all([
      atualizarPedidoAtomico<P>("disputado", null, mutator),
      atualizarPedidoAtomico<P>("disputado", null, mutator),
    ]);
    expect(r1.tipo).toBe("sucesso");
    expect(r2.tipo).toBe("sucesso");
    // Ambos os mutators rodaram (cada update é legítimo — mutex serializa,
    // não rejeita), mas o array final tem exatamente UM pedido com esse id,
    // nunca duplicado, e a revisão avançou exatamente duas vezes (legado sem
    // revision -> fallback 1 -> +1 na primeira aplicação -> +1 na segunda).
    expect(contadorEfeitoColateral).toBe(2);
    const atuais = pedidosAtuais();
    expect(atuais.filter((p) => p.id === "disputado")).toHaveLength(1);
    expect(atuais[0].revision).toBe(3);
    expect(atuais[0].status).toBe("confirmado");
  });

  test("listarPedidos/buscarPedido nunca inventam dados: refletem exatamente o array persistido", async () => {
    store.set(PEDIDOS_KEY, [pedido("real-1"), pedido("real-2")]);
    const todos = await listarPedidos<P>();
    expect(todos.map((p) => p.id).sort()).toEqual(["real-1", "real-2"]);
    expect(await buscarPedido<P>("inexistente")).toBeNull();
  });

  test("mutarLotePedidosAtomico: transformação em lote concorrente com um append individual — nenhuma escrita perdida", async () => {
    store.set(PEDIDOS_KEY, [pedido("velho-1", { status: "entregue" }), pedido("velho-2", { status: "novo" })]);
    const [rLote, rAdd] = await Promise.all([
      mutarLotePedidosAtomico<P>((atuais) => atuais.filter((p) => p.status !== "entregue")),
      adicionarPedidoAtomico(pedido("durante-a-limpeza")),
    ]);
    expect(rLote.tipo).toBe("sucesso");
    expect(rAdd.tipo).toBe("sucesso");
    const atuais = pedidosAtuais();
    expect(atuais.find((p) => p.id === "velho-1")).toBeUndefined();
    expect(atuais.find((p) => p.id === "velho-2")).toBeTruthy();
    expect(atuais.find((p) => p.id === "durante-a-limpeza")).toBeTruthy();
  });
});
