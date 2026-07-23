import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

// Teste de arquitetura (Modo Sobrevivência — concorrência da chave "pedidos"):
// nenhum novo writer direto (`redis.set("pedidos", ...)` / `redis.del("pedidos")`)
// pode ser criado fora de src/lib/pedidosStore.ts, o único módulo autorizado
// a fazer GET+mutação+SET dessa chave. Isso garante que TODA escrita futura
// passe pelo lock distribuído central (adicionarPedidoAtomico,
// atualizarPedidoAtomico, mutarPedidoPorIdAtomico, removerPedidoAtomico,
// mutarLotePedidosAtomico) — nunca um read-modify-write "cru" reintroduzindo
// a corrida que este módulo existe para eliminar.
//
// Os arquivos na allowlist abaixo usam o escape hatch `executarComLockPedidos`
// (também exportado por pedidosStore.ts) para rodar uma escrita "pedidos"
// customizada — que não se encaixa em add/update/remove/lote de um único
// pedido (ex.: atribuição de entregador com fila em Lua, merge por id da
// reconciliação Mercado Pago) — SEMPRE dentro do MESMO lock global. Se você
// está adicionando um arquivo aqui, confirme que a escrita realmente roda
// dentro de um `executarComLockPedidos(...)` (ou de uma das operações
// nomeadas do módulo) antes de estendera lista.
const ALLOWLIST_ESCAPE_HATCH = new Set([
  "src/lib/pedidosStore.ts",
  "src/lib/mercadoPagoReconciliacao.ts",
  "src/app/api/orders/route.ts",
  "src/app/api/pedido-app/[id]/editar/iniciar/route.ts",
  "src/app/api/pedido-app/[id]/editar/descartar/route.ts",
  "src/app/api/pedido-app/[id]/editar/status/route.ts",
  "src/app/api/entregador-pedidos/route.ts",
]);

// Referência à chave "pedidos" — literal entre aspas OU o identificador
// `PEDIDOS_KEY` importado de pedidosStore.ts (achado BAIXO da revisão
// externa do PR #252: `PEDIDOS_KEY` é exportado, então `redis.set(PEDIDOS_KEY,
// novosPedidos)` escrevia a chave sem passar pelo detector, que só reconhecia
// o literal `"pedidos"`). Qualquer chamada de escrita usando o identificador
// é tão perigosa quanto usar o literal — mesmo padrão de detecção para os dois.
const REF_CHAVE_PEDIDOS = `(?:['"]pedidos['"]|PEDIDOS_KEY\\b)`;

// Escrita "crua" legada — SET/DEL direto por fora de qualquer fencing.
// Depois do fencing real (ver FENCING em pedidosStore.ts), nenhum arquivo
// (nem os da allowlist) deveria mais bater neste padrão — toda escrita passa
// por `escreverPedidosCercado` (uma chave) ou por um EVAL multichave que
// verifica a posse do lock na MESMA operação (ver PADRAO_EVAL_MULTICHAVE_PEDIDOS).
const PADRAO_ESCRITA_PEDIDOS = new RegExp(`redis\\.(set|del)\\(\\s*${REF_CHAVE_PEDIDOS}`);

// EVAL multichave que grava "pedidos" junto com outra(s) chave(s) (ex.:
// atribuição de entregador com fila, transição "entregue" no app do
// entregador) — só é aceitável cercado (fenced) pelo token do lock DENTRO do
// próprio script Lua (ver `if redis.call("get", KEYS[1]) ~= ARGV[1] then
// return "lock_perdido" end` nos arquivos allowlistados). `[\s\S]*?` cobre o
// script Lua multilinha entre `redis.eval(` e o array de KEYS.
const PADRAO_EVAL_MULTICHAVE_PEDIDOS = new RegExp(
  `redis\\.eval\\([\\s\\S]*?\\[[^\\]]*${REF_CHAVE_PEDIDOS}[^\\]]*\\]`
);

// pipeline()/multi() do cliente Redis (usado hoje só para telemetria própria,
// nunca para "pedidos") — detecta `.set`/`.del`/`.hset` etc. encadeados num
// pipeline/multi que gravem "pedidos" (literal ou via `PEDIDOS_KEY`), e a
// própria criação de um pipeline/multi cujo encadeamento (`[\s\S]*?`, até
// `.exec()`) contenha essa referência em qualquer chamada de método.
const PADRAO_PIPELINE_MULTI_PEDIDOS = new RegExp(
  `\\.(pipeline|multi)\\(\\)[\\s\\S]*?\\.(set|del|hset|hdel|lpush|rpush)\\(\\s*${REF_CHAVE_PEDIDOS}`
);

function escreveForaDoModuloCentral(conteudo: string): boolean {
  return (
    PADRAO_ESCRITA_PEDIDOS.test(conteudo) ||
    PADRAO_EVAL_MULTICHAVE_PEDIDOS.test(conteudo) ||
    PADRAO_PIPELINE_MULTI_PEDIDOS.test(conteudo)
  );
}

function listarArquivosTs(dir: string, arquivos: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === "node_modules" || entrada === ".next") continue;
    const caminho = join(dir, entrada);
    const info = statSync(caminho);
    if (info.isDirectory()) {
      listarArquivosTs(caminho, arquivos);
    } else if (/\.(ts|tsx)$/.test(entrada) && !/\.test\.ts$/.test(entrada)) {
      arquivos.push(caminho);
    }
  }
  return arquivos;
}

describe("Arquitetura: mutação da chave Redis 'pedidos' só pode passar por src/lib/pedidosStore.ts", () => {
  test("nenhum arquivo fora da allowlist contém redis.set/del/eval direto em 'pedidos'", () => {
    const raizSrc = join(__dirname, "..");
    const violacoes: string[] = [];

    for (const caminhoAbsoluto of listarArquivosTs(raizSrc)) {
      const caminhoRelativo = "src/" + relative(raizSrc, caminhoAbsoluto).replace(/\\/g, "/");
      const conteudo = readFileSync(caminhoAbsoluto, "utf-8");
      if (escreveForaDoModuloCentral(conteudo) && !ALLOWLIST_ESCAPE_HATCH.has(caminhoRelativo)) {
        violacoes.push(caminhoRelativo);
      }
    }

    expect(violacoes).toEqual([]);
  });

  test("allowlist do escape hatch não tem entradas obsoletas (arquivo removido ou não usa mais o escape hatch cercado)", () => {
    const raizSrc = join(__dirname, "..");

    for (const caminhoRelativo of ALLOWLIST_ESCAPE_HATCH) {
      if (caminhoRelativo === "src/lib/pedidosStore.ts") continue; // módulo central, sempre legítimo
      const caminhoAbsoluto = join(raizSrc, "..", caminhoRelativo);
      let conteudo: string;
      try {
        conteudo = readFileSync(caminhoAbsoluto, "utf-8");
      } catch {
        throw new Error(`Allowlist desatualizada: ${caminhoRelativo} não existe mais. Remova da lista.`);
      }
      // Cada arquivo listado precisa OU ainda escrever "pedidos" diretamente
      // (SET/DEL crus ou EVAL multichave — sempre cercado pelo token do
      // lock), OU delegar a escrita cercada (fenced) ao helper central
      // `escreverPedidosCercado` — nunca nenhuma das duas (allowlist
      // obsoleta) nem escrita sem NENHUM fencing.
      const aindaEscreveDiretoOuCercado = escreveForaDoModuloCentral(conteudo) || conteudo.includes("escreverPedidosCercado");
      expect(
        aindaEscreveDiretoOuCercado,
        `Allowlist desatualizada: ${caminhoRelativo} não escreve mais "pedidos" (nem direto nem via escreverPedidosCercado). Remova da lista.`
      ).toBe(true);
      expect(
        conteudo.includes("executarComLockPedidos"),
        `${caminhoRelativo} está na allowlist do escape hatch mas não importa/usa executarComLockPedidos — a escrita de "pedidos" precisa rodar dentro do lock central.`
      ).toBe(true);
    }
  });

  test("negativo: o detector de escrita direta/EVAL multichave realmente pega uma violação simulada", () => {
    const violacaoSetDireto = `await redis.set("pedidos", novosPedidos)`;
    const violacaoDelDireto = `await redis.del('pedidos')`;
    const violacaoEvalMultichave = `await redis.eval(\n  SCRIPT,\n  [algumaChave, "pedidos", outraChave],\n  [arg1]\n)`;
    const semViolacao = `await redis.get("pedidos")`; // leitura nunca é violação

    expect(escreveForaDoModuloCentral(violacaoSetDireto)).toBe(true);
    expect(escreveForaDoModuloCentral(violacaoDelDireto)).toBe(true);
    expect(escreveForaDoModuloCentral(violacaoEvalMultichave)).toBe(true);
    expect(escreveForaDoModuloCentral(semViolacao)).toBe(false);
  });

  test("negativo: o detector pega escrita via pipeline()/multi() encadeado", () => {
    const violacaoPipeline = `const p = redis.pipeline()\np.set("pedidos", novosPedidos)\nawait p.exec()`;
    const violacaoMulti = `const tx = redisClient.multi()\ntx.del('pedidos')\nawait tx.exec()`;
    const pipelineLegitimo = `const p = redisClient.pipeline()\np.hincrby(diaKey, 'total', 1)\nawait p.exec()`;

    expect(escreveForaDoModuloCentral(violacaoPipeline)).toBe(true);
    expect(escreveForaDoModuloCentral(violacaoMulti)).toBe(true);
    expect(escreveForaDoModuloCentral(pipelineLegitimo)).toBe(false);
  });

  test("negativo: o detector pega escrita usando o identificador PEDIDOS_KEY (não só o literal \"pedidos\")", () => {
    // Achado BAIXO da revisão externa do PR #252: PEDIDOS_KEY é exportado por
    // pedidosStore.ts — um writer futuro poderia importar a constante e
    // escrever `redis.set(PEDIDOS_KEY, ...)` sem nunca escrever o literal
    // "pedidos", escapando do detector anterior (que só reconhecia o literal
    // entre aspas).
    const violacaoSetComConstante = `await redis.set(PEDIDOS_KEY, novosPedidos)`;
    const violacaoDelComConstante = `await redis.del(PEDIDOS_KEY)`;
    const violacaoEvalMultichaveComConstante = `await redis.eval(\n  SCRIPT,\n  [LOCK_KEY, PEDIDOS_KEY],\n  [token, valor]\n)`;
    const violacaoPipelineComConstante = `const p = redis.pipeline()\np.set(PEDIDOS_KEY, novosPedidos)\nawait p.exec()`;
    const leituraComConstanteNuncaEViolacao = `await redis.get(PEDIDOS_KEY)`;

    expect(escreveForaDoModuloCentral(violacaoSetComConstante)).toBe(true);
    expect(escreveForaDoModuloCentral(violacaoDelComConstante)).toBe(true);
    expect(escreveForaDoModuloCentral(violacaoEvalMultichaveComConstante)).toBe(true);
    expect(escreveForaDoModuloCentral(violacaoPipelineComConstante)).toBe(true);
    expect(escreveForaDoModuloCentral(leituraComConstanteNuncaEViolacao)).toBe(false);
  });
});
