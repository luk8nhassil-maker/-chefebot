import { beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("./redis", () => ({
  redis: {
    // Valores gravados via `eval` (compare-and-set) ficam como STRING crua —
    // exatamente como um Redis de verdade guardaria depois de um
    // `redis.call("SET", ...)` dentro de um script Lua — então o GET precisa
    // tentar o parse de volta, igual o client real faz.
    get: vi.fn(async (key: string) => {
      if (!store.has(key)) return null;
      const valor = store.get(key);
      if (typeof valor === "string") {
        try {
          return JSON.parse(valor);
        } catch {
          return valor;
        }
      }
      return valor;
    }),
    // Respeita nx de verdade (não escreve se a chave já existe) — necessário
    // para o lock de comBloqueioGamificacao (usado por
    // comReservaConversaoAtiva) funcionar de verdade sob concorrência real
    // nos testes de blocker 2/3 abaixo, em vez de "sempre adquire". Nunca
    // aplica TTL de verdade (a reserva durável nunca deve expirar sozinha —
    // ela só é limpa por confirmação ou revogação explícitas).
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (...keys: string[]) => {
      let removidos = 0;
      for (const key of keys) if (store.delete(key)) removidos++;
      return removidos;
    }),
    // Cobre os TRÊS formatos de script Lua usados hoje neste módulo:
    //   - compare-and-delete-lock (1 key, 1 arg): libera um lock só se o
    //     dono ainda bater (liberarLock).
    //   - compare-and-set (2 keys, 2 args): grava keys[1] só se keys[0]
    //     (o lock) ainda bater com args[0] — BLOCKER 8, escreverConversaoSeDono.
    //   - compare-and-delete-estado (2 keys, 1 arg): apaga keys[1] só se
    //     keys[0] (o lock) ainda bater — BLOCKER 8, apagarConversaoSeDono.
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (store.get(keys[0]) !== args[0]) return 0;
      if (keys.length >= 2 && args.length >= 2) {
        store.set(keys[1], args[1]);
        return 1;
      }
      if (keys.length >= 2) {
        return store.delete(keys[1]) ? 1 : 0;
      }
      store.delete(keys[0]);
      return 1;
    }),
  },
}));

import {
  registrarConversaoIndicacao,
  obterConversaoIndicacaoDoPedido,
  marcarConversaoAtivaIndicado,
  obterConversaoAtivaIndicado,
  revogarConversaoAtivaIndicadoSePedido,
  reservarOuIdentificarConversao,
  comReservaConversaoAtiva,
} from "./rankingIndicacaoConversao";
import { redis } from "./redis";

const getMock = vi.mocked(redis.get);

beforeEach(() => store.clear());

describe("registrarConversaoIndicacao / obterConversaoIndicacaoDoPedido", () => {
  test("registra e recupera a migalha pelo pedidoId", async () => {
    await registrarConversaoIndicacao({ indicadorId: "cli_a", indicadoId: "cli_b", pedidoId: "pedido-1" });
    const conversao = await obterConversaoIndicacaoDoPedido("pedido-1");
    expect(conversao).toEqual({ indicadorId: "cli_a", indicadoId: "cli_b", pedidoId: "pedido-1" });
  });

  test("pedido sem migalha retorna null", async () => {
    expect(await obterConversaoIndicacaoDoPedido("pedido-nunca-registrado")).toBeNull();
  });

  test("pedidoId vazio retorna null sem consultar o Redis", async () => {
    expect(await obterConversaoIndicacaoDoPedido("")).toBeNull();
  });
});

describe("reservarOuIdentificarConversao (reserva DURÁVEL — sobrevive a crash entre o +6 e a confirmação)", () => {
  test("sem estado anterior: reserva como 'processando' e devolve 'reservada_processando'", async () => {
    const resultado = await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    expect(resultado).toBe("reservada_processando");
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toEqual(expect.objectContaining({ estado: "processando", indicadorId: "cli_indicador", pedidoId: "pedido-A" }));
  });

  test("retry do MESMO pedido enquanto ainda 'processando': devolve 'mesmo_pedido', nunca sobrescreve nem duplica a reserva", async () => {
    await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    const retry = await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    expect(retry).toBe("mesmo_pedido");
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toEqual(expect.objectContaining({ estado: "processando", indicadorId: "cli_indicador", pedidoId: "pedido-A" }));
  });

  test("retry do MESMO pedido depois de já 'ativa': também devolve 'mesmo_pedido'", async () => {
    await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    const retry = await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    expect(retry).toBe("mesmo_pedido");
  });

  test("OUTRO pedido tentando reservar enquanto o primeiro está 'processando': devolve 'ocupada_processando_outro' e NUNCA sobrescreve a reserva de A", async () => {
    await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    const resultado = await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-B" });
    expect(resultado).toBe("ocupada_processando_outro");
    // A reserva de A continua intacta — B nunca rouba nem substitui.
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toEqual(expect.objectContaining({ estado: "processando", indicadorId: "cli_indicador", pedidoId: "pedido-A" }));
  });

  test("OUTRO pedido tentando reservar quando já existe conversão ATIVA (sustentada): devolve 'ativa_outro_pedido'", async () => {
    await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    const resultado = await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-B" });
    expect(resultado).toBe("ativa_outro_pedido");
  });

  test("BLOCKER 8 — o TTL do lock efêmero não importa: depois que a reserva é gravada (e o lock já foi liberado), ela continua bloqueando outros pedidos indefinidamente, até ser confirmada ou revogada", async () => {
    await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    // O lock em si (comReservaConversaoAtiva) já foi liberado ao final da
    // chamada acima — não há nenhuma seção crítica em andamento agora. Ainda
    // assim, a reserva DURÁVEL (sem TTL) continua protegendo.
    for (let i = 0; i < 3; i++) {
      const resultado = await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: `pedido-concorrente-${i}` });
      expect(resultado).toBe("ocupada_processando_outro");
    }
  });
});

describe("marcarConversaoAtivaIndicado (confirmação da reserva — só o dono pode concluir)", () => {
  test("BLOCKER 4 — NUNCA cria/confirma 'ativa' quando não havia NENHUMA reserva (null) — devolve 'reserva_perdida' sem escrever nada", async () => {
    // Cenário exato do blocker: um worker atrasado (ex.: de um pedido já
    // cancelado e com a reserva já revogada) chama isto depois — não pode
    // "ressuscitar" uma conversão do nada.
    const resultado = await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    expect(resultado).toBe("reserva_perdida");
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toBeNull();
  });

  test("confirma como 'ativa' quando a reserva 'processando' pertence ao MESMO pedido", async () => {
    await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    const resultado = await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    expect(resultado).toBe("confirmada");
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toEqual({ estado: "ativa", indicadorId: "cli_indicador", pedidoId: "pedido-A" });
  });

  test("retry do MESMO pedido já 'ativa' devolve 'ja_ativa_mesmo' (no-op idempotente)", async () => {
    await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    const retry = await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    expect(retry).toBe("ja_ativa_mesmo");
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toEqual({ estado: "ativa", indicadorId: "cli_indicador", pedidoId: "pedido-A" });
  });

  test("BLOCKER 5 — NUNCA confirma por cima de uma reserva que pertence a OUTRO pedido (só o dono da reserva pode concluir)", async () => {
    await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    // B tenta (indevidamente) se auto-confirmar como a conversão ativa,
    // mesmo sem ter conseguido reservar (deveria ter recebido
    // "ocupada_processando_outro" e nunca chegado a chamar isto — este teste
    // prova que, mesmo que chegasse, a função protege sozinha).
    const resultado = await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-B" });
    expect(resultado).toBe("reserva_perdida");
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toEqual(expect.objectContaining({ estado: "processando", indicadorId: "cli_indicador", pedidoId: "pedido-A" }));
  });

  test("indicadoId vazio nunca consulta nem marca o Redis", async () => {
    expect(await obterConversaoAtivaIndicado("")).toBeNull();
    expect(await marcarConversaoAtivaIndicado("", { indicadorId: "x", pedidoId: "y" })).toBe("reserva_perdida");
    expect(await obterConversaoAtivaIndicado("cli_qualquer")).toBeNull();
  });
});

describe("revogarConversaoAtivaIndicadoSePedido (compare-and-delete atômico)", () => {
  test("revoga uma reserva 'processando' pertencente ao pedido (cancelamento antes do +6 — blocker 7)", async () => {
    await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await revogarConversaoAtivaIndicadoSePedido("cli_indicado", "pedido-A");
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toBeNull();
  });

  test("revoga uma conversão 'ativa' pertencente ao pedido", async () => {
    await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await revogarConversaoAtivaIndicadoSePedido("cli_indicado", "pedido-A");
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toBeNull();
  });

  test("NUNCA revoga quando o pedidoId não bate — protege contra reprocessamento fora de ordem apagando uma conversão MAIS NOVA", async () => {
    await reservarOuIdentificarConversao("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-B" });
    await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-B" });
    await revogarConversaoAtivaIndicadoSePedido("cli_indicado", "pedido-A");
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toEqual({ estado: "ativa", indicadorId: "cli_indicador", pedidoId: "pedido-B" });
  });

  test("revogar quando nunca houve marca é um no-op seguro (idempotente)", async () => {
    await expect(revogarConversaoAtivaIndicadoSePedido("cli_nunca_marcado", "pedido-X")).resolves.toBeUndefined();
    expect(await obterConversaoAtivaIndicado("cli_nunca_marcado")).toBeNull();
  });

  test("BLOCKER 7 fim a fim: A reserva (processando) → cancelamento de A antes do +6 revoga → B pode reservar a conversão principal do zero", async () => {
    await reservarOuIdentificarConversao("cli_indicado_A", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await revogarConversaoAtivaIndicadoSePedido("cli_indicado_A", "pedido-A");
    expect(await obterConversaoAtivaIndicado("cli_indicado_A")).toBeNull();

    const resultado = await reservarOuIdentificarConversao("cli_indicado_A", { indicadorId: "cli_indicador", pedidoId: "pedido-C" });
    expect(resultado).toBe("reservada_processando");
  });

  test("BLOCKER 4 fim a fim: A converte (ativa) → cancelar A revoga → uma nova conversão substituta pode ser reservada e confirmada", async () => {
    await reservarOuIdentificarConversao("cli_indicado_A", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await marcarConversaoAtivaIndicado("cli_indicado_A", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await revogarConversaoAtivaIndicadoSePedido("cli_indicado_A", "pedido-A");
    expect(await obterConversaoAtivaIndicado("cli_indicado_A")).toBeNull();

    await reservarOuIdentificarConversao("cli_indicado_A", { indicadorId: "cli_indicador", pedidoId: "pedido-C" });
    await marcarConversaoAtivaIndicado("cli_indicado_A", { indicadorId: "cli_indicador", pedidoId: "pedido-C" });
    expect(await obterConversaoAtivaIndicado("cli_indicado_A")).toEqual({ estado: "ativa", indicadorId: "cli_indicador", pedidoId: "pedido-C" });
  });
});

describe("comReservaConversaoAtiva (lock efêmero — só a seção crítica curta)", () => {
  test("serializa duas seções concorrentes na MESMA chave — nunca roda os dois 'fn' ao mesmo tempo", async () => {
    const ordem: string[] = [];
    let dentro = 0;
    let maxSimultaneos = 0;

    async function secaoCritica(nome: string) {
      return comReservaConversaoAtiva("cli_disputado", async () => {
        dentro++;
        maxSimultaneos = Math.max(maxSimultaneos, dentro);
        ordem.push(`${nome}:entrou`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        ordem.push(`${nome}:saiu`);
        dentro--;
      });
    }

    await Promise.all([secaoCritica("A"), secaoCritica("B")]);

    expect(maxSimultaneos).toBe(1);
    expect(ordem[0].endsWith(":entrou")).toBe(true);
    expect(ordem[1]).toBe(`${ordem[0].split(":")[0]}:saiu`);
  });
});

describe("BLOCKER 2/3 — concorrência real fim a fim usando as funções REAIS exportadas (não uma decisão simulada)", () => {
  test("dois pedidos concorrentes do mesmo indicado disputando reservarOuIdentificarConversao → exatamente UM reserva, o outro fica 'ocupado' (NUNCA vira apoio nem credita)", async () => {
    const indicadoId = "cli_indicado_disputa";

    const [resultadoA, resultadoB] = await Promise.all([
      reservarOuIdentificarConversao(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-A" }),
      reservarOuIdentificarConversao(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-B" }),
    ]);

    const resultados = [resultadoA, resultadoB].sort();
    expect(resultados).toEqual(["ocupada_processando_outro", "reservada_processando"]);

    // O vencedor é quem a reserva durável realmente registrou.
    const vencedor = resultadoA === "reservada_processando" ? "pedido-A" : "pedido-B";
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual(expect.objectContaining({ estado: "processando", indicadorId: "cli_indicador", pedidoId: vencedor }));

    // O perdedor nunca é promovido a nada — nem apoio, nem conversão — só
    // fica sabendo que precisa reprocessar depois (retryable).
  });

  test("BLOCKER 3: cancelamento (revogar) de A concorrendo com a confirmação de uma nova reserva B — B permanece, em QUALQUER ordem de execução real", async () => {
    const indicadoId = "cli_indicado_cancelamento_concorrente";
    await reservarOuIdentificarConversao(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await marcarConversaoAtivaIndicado(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-A" });

    await Promise.all([
      revogarConversaoAtivaIndicadoSePedido(indicadoId, "pedido-A"),
      (async () => {
        await reservarOuIdentificarConversao(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-B" });
        await marcarConversaoAtivaIndicado(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-B" });
      })(),
    ]);

    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ estado: "ativa", indicadorId: "cli_indicador", pedidoId: "pedido-B" });
  });

  test("retry do MESMO pedido (crash e reprocessamento) não é bloqueado por sua própria reserva anterior — cada chamada libera o lock ao final", async () => {
    const indicadoId = "cli_indicado_retry";
    await reservarOuIdentificarConversao(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    const retry = await reservarOuIdentificarConversao(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    expect(retry).toBe("mesmo_pedido");
    await marcarConversaoAtivaIndicado(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ estado: "ativa", indicadorId: "cli_indicador", pedidoId: "pedido-A" });
  });
});

describe("BLOCKER 8 — atomicidade real das transições: um lock expirado NUNCA permite uma escrita obsoleta", () => {
  // Simula o TTL do lock (10s) expirando e OUTRO worker assumindo a MESMA
  // chave exatamente entre o GET (leitura do estado, dentro da seção
  // crítica) e a escrita CAS — a única janela real onde isto pode acontecer.
  // Nunca simula a decisão: intercepta o mock do `redis.get` para, como
  // efeito colateral, reescrever a chave de lock com um token de "outro
  // worker" — a chamada real de reservar/confirmar/revogar precisa então
  // detectar que já não é mais dona do lock na hora exata de escrever.

  test("reservar: lock roubado entre o GET e o SET — nunca reporta 'reservada_processando' sem ter escrito", async () => {
    const indicadoId = "cli_indicado_cas_reservar";
    const getPadrao = getMock.getMockImplementation()!;
    getMock.mockImplementationOnce(async (...args: Parameters<typeof getPadrao>) => {
      store.set(`estrelasIndicacao:conversaoAtiva:lock:${indicadoId}`, "token-de-outro-worker");
      return getPadrao(...args);
    });

    await expect(
      reservarOuIdentificarConversao(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-A" }),
    ).rejects.toThrow("ranking_indicacao_lock_perdido_durante_reserva");

    // Nunca escreveu por cima do "roubo" — nem processando, nem nada.
    expect(await obterConversaoAtivaIndicado(indicadoId)).toBeNull();
  });

  test("confirmar: lock roubado entre o GET e o SET — nunca reporta 'confirmada' sem ter escrito, e NUNCA sobrescreve o que o outro worker já gravou", async () => {
    const indicadoId = "cli_indicado_cas_confirmar";
    await reservarOuIdentificarConversao(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-A" });

    const getPadrao = getMock.getMockImplementation()!;
    getMock.mockImplementationOnce(async (...args: Parameters<typeof getPadrao>) => {
      // O código de negócio lê o estado ORIGINAL (ainda "processando" de A)
      // — só DEPOIS de ler é que o "outro worker" rouba o lock e já grava o
      // SEU PRÓPRIO estado (ex.: uma reconciliação legítima). A prova real é
      // que a confirmação atrasada de A NUNCA apaga esse estado por cima.
      const original = await getPadrao(...args);
      store.set(`estrelasIndicacao:conversaoAtiva:lock:${indicadoId}`, "token-de-outro-worker");
      store.set(`estrelasIndicacao:conversaoAtiva:${indicadoId}`, JSON.stringify({ estado: "ativa", indicadorId: "cli_indicador", pedidoId: "pedido-B-outro-worker" }));
      return original;
    });

    await expect(
      marcarConversaoAtivaIndicado(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-A" }),
    ).rejects.toThrow("ranking_indicacao_lock_perdido_durante_confirmacao");

    // O estado do "outro worker" continua intacto — a confirmação atrasada
    // de A nunca escreveu por cima.
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ estado: "ativa", indicadorId: "cli_indicador", pedidoId: "pedido-B-outro-worker" });
  });

  test("revogar: lock roubado entre o GET e o DEL — nunca reporta sucesso sem ter apagado, e NUNCA apaga o que o outro worker já gravou", async () => {
    const indicadoId = "cli_indicado_cas_revogar";
    await reservarOuIdentificarConversao(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-A" });

    const getPadrao = getMock.getMockImplementation()!;
    getMock.mockImplementationOnce(async (...args: Parameters<typeof getPadrao>) => {
      const original = await getPadrao(...args);
      store.set(`estrelasIndicacao:conversaoAtiva:lock:${indicadoId}`, "token-de-outro-worker");
      store.set(`estrelasIndicacao:conversaoAtiva:${indicadoId}`, JSON.stringify({ estado: "ativa", indicadorId: "cli_indicador", pedidoId: "pedido-B-outro-worker" }));
      return original;
    });

    await expect(revogarConversaoAtivaIndicadoSePedido(indicadoId, "pedido-A")).rejects.toThrow(
      "ranking_indicacao_lock_perdido_durante_revogacao",
    );

    // O estado do "outro worker" continua intacto — a revogação atrasada de
    // A nunca apagou por cima.
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ estado: "ativa", indicadorId: "cli_indicador", pedidoId: "pedido-B-outro-worker" });
  });
});
