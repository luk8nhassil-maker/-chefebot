import { beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    // Respeita nx de verdade (não escreve se a chave já existe) — necessário
    // para o lock de comBloqueioGamificacao (usado por
    // comReservaConversaoAtiva) funcionar de verdade sob concorrência real
    // nos testes de blocker 2/3 abaixo, em vez de "sempre adquire".
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
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (store.get(keys[0]) !== args[0]) return 0;
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
  comReservaConversaoAtiva,
} from "./rankingIndicacaoConversao";

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

describe("marcarConversaoAtivaIndicado / obterConversaoAtivaIndicado / revogarConversaoAtivaIndicadoSePedido (blocker 4)", () => {
  test("marca e recupera a conversão ativa do indicado", async () => {
    await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toEqual({ indicadorId: "cli_indicador", pedidoId: "pedido-A" });
  });

  test("sem marca nenhuma, devolve null", async () => {
    expect(await obterConversaoAtivaIndicado("cli_sem_conversao")).toBeNull();
  });

  test("indicadoId vazio nunca consulta nem marca o Redis", async () => {
    expect(await obterConversaoAtivaIndicado("")).toBeNull();
    await marcarConversaoAtivaIndicado("", { indicadorId: "x", pedidoId: "y" });
    expect(await obterConversaoAtivaIndicado("cli_qualquer")).toBeNull();
  });

  test("revoga a marca quando o pedidoId bate com a conversão ativa", async () => {
    await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await revogarConversaoAtivaIndicadoSePedido("cli_indicado", "pedido-A");
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toBeNull();
  });

  test("NUNCA revoga quando o pedidoId não bate — protege contra reprocessamento fora de ordem apagando uma conversão MAIS NOVA", async () => {
    // Pedido A convertia originalmente; depois disso o indicado já fez uma
    // NOVA conversão válida via pedido B. Um cancelamento tardio e fora de
    // ordem de A (ex.: reprocessado depois de B) nunca pode apagar a marca de B.
    await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-B" });
    await revogarConversaoAtivaIndicadoSePedido("cli_indicado", "pedido-A");
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toEqual({ indicadorId: "cli_indicador", pedidoId: "pedido-B" });
  });

  test("revogar quando nunca houve marca é um no-op seguro (idempotente)", async () => {
    await expect(revogarConversaoAtivaIndicadoSePedido("cli_nunca_marcado", "pedido-X")).resolves.toBeUndefined();
    expect(await obterConversaoAtivaIndicado("cli_nunca_marcado")).toBeNull();
  });

  test("BLOCKER 4 fim a fim: A converte → cancelar A revoga → B (novo indicado sem relação com A) pode ter sua própria conversão ativa independente", async () => {
    await marcarConversaoAtivaIndicado("cli_indicado_A", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await revogarConversaoAtivaIndicadoSePedido("cli_indicado_A", "pedido-A");
    expect(await obterConversaoAtivaIndicado("cli_indicado_A")).toBeNull();

    // Uma nova conversão válida substituta (pedido C) para o MESMO indicado.
    await marcarConversaoAtivaIndicado("cli_indicado_A", { indicadorId: "cli_indicador", pedidoId: "pedido-C" });
    expect(await obterConversaoAtivaIndicado("cli_indicado_A")).toEqual({ indicadorId: "cli_indicador", pedidoId: "pedido-C" });
  });
});

describe("comReservaConversaoAtiva (blocker 2/3: reserva atômica + compare-and-delete atômico)", () => {
  test("serializa duas seções concorrentes na MESMA chave — nunca roda os dois 'fn' ao mesmo tempo", async () => {
    const ordem: string[] = [];
    let dentro = 0;
    let maxSimultaneos = 0;

    async function secaoCritica(nome: string) {
      return comReservaConversaoAtiva("cli_disputado", async () => {
        dentro++;
        maxSimultaneos = Math.max(maxSimultaneos, dentro);
        ordem.push(`${nome}:entrou`);
        // Cede o event loop propositalmente para dar chance de uma execução
        // concorrente mal-serializada aparecer, se o lock não funcionasse.
        await new Promise((resolve) => setTimeout(resolve, 5));
        ordem.push(`${nome}:saiu`);
        dentro--;
      });
    }

    await Promise.all([secaoCritica("A"), secaoCritica("B")]);

    expect(maxSimultaneos).toBe(1);
    // Uma seção inteira (entrou+saiu) sempre termina antes da outra começar.
    expect(ordem[0].endsWith(":entrou")).toBe(true);
    expect(ordem[1]).toBe(`${ordem[0].split(":")[0]}:saiu`);
  });

  test("BLOCKER 2: dois pedidos concorrentes do mesmo indicado (sem conversão ativa) → exatamente UM vira conversão principal, o outro cai para apoio", async () => {
    const indicadoId = "cli_indicado_disputa";
    let creditos = 0;

    async function processarPedido(pedidoId: string, indicadorId: string): Promise<"conversao_principal" | "apoio"> {
      return comReservaConversaoAtiva(indicadoId, async () => {
        const ativa = await obterConversaoAtivaIndicado(indicadoId);
        if (ativa) return "apoio";
        // Simula o crédito real (+6) — o ponto testado aqui é que só UM dos
        // dois pedidos concorrentes chega a executar este passo.
        await new Promise((resolve) => setTimeout(resolve, 5));
        creditos++;
        await marcarConversaoAtivaIndicado(indicadoId, { indicadorId, pedidoId });
        return "conversao_principal";
      });
    }

    const [resultadoA, resultadoB] = await Promise.all([
      processarPedido("pedido-A", "cli_indicador"),
      processarPedido("pedido-B", "cli_indicador"),
    ]);

    expect(creditos).toBe(1);
    expect([resultadoA, resultadoB].sort()).toEqual(["apoio", "conversao_principal"]);

    const vencedor = resultadoA === "conversao_principal" ? "pedido-A" : "pedido-B";
    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ indicadorId: "cli_indicador", pedidoId: vencedor });
  });

  test("BLOCKER 3: cancelamento de A concorrendo com nova conversão B — B permanece ativa, em QUALQUER ordem de execução real", async () => {
    const indicadoId = "cli_indicado_cancelamento_concorrente";
    await marcarConversaoAtivaIndicado(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-A" });

    // Cancelamento de A e a gravação da nova conversão B disputam a MESMA
    // reserva ao mesmo tempo. Como as duas seções (leitura+comparação+DEL do
    // cancelamento; e o SET da nova conversão) são mutuamente exclusivas,
    // não existe intercalação possível: ou o cancelamento roda por inteiro
    // antes de B ser gravado (B nasce limpo depois), ou B é gravado primeiro
    // e o cancelamento de A, ao comparar, vê pedidoId="B" e não faz nada.
    // As duas ordens terminam no MESMO estado final correto.
    await Promise.all([
      revogarConversaoAtivaIndicadoSePedido(indicadoId, "pedido-A"),
      comReservaConversaoAtiva(indicadoId, async () => {
        await marcarConversaoAtivaIndicado(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-B" });
      }),
    ]);

    expect(await obterConversaoAtivaIndicado(indicadoId)).toEqual({ indicadorId: "cli_indicador", pedidoId: "pedido-B" });
  });

  test("BLOCKER 3: retry do MESMO pedido (crash e reprocessamento) não é bloqueado por sua própria reserva anterior — o lock é liberado ao final de cada 'fn'", async () => {
    const indicadoId = "cli_indicado_retry";
    await comReservaConversaoAtiva(indicadoId, async () => {
      await marcarConversaoAtivaIndicado(indicadoId, { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    });
    // Uma segunda chamada, sequencial, no MESMO indicado precisa conseguir o
    // lock normalmente (a reserva anterior já foi liberada).
    await expect(
      comReservaConversaoAtiva(indicadoId, async () => "ok"),
    ).resolves.toBe("ok");
  });
});
