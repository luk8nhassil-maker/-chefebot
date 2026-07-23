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

// Escrita "crua" legada — SET/DEL direto por fora de qualquer fencing.
// Depois do fencing real (ver FENCING em pedidosStore.ts), nenhum arquivo
// (nem os da allowlist) deveria mais bater neste padrão — toda escrita passa
// por `escreverPedidosCercado` (uma chave) ou por um EVAL multichave que
// verifica a posse do lock na MESMA operação (ver PADRAO_EVAL_MULTICHAVE_PEDIDOS).
const PADRAO_ESCRITA_PEDIDOS = /redis\.(set|del)\(\s*['"]pedidos['"]/;

// EVAL multichave que grava "pedidos" junto com outra(s) chave(s) (ex.:
// atribuição de entregador com fila, transição "entregue" no app do
// entregador) — só é aceitável cercado (fenced) pelo token do lock DENTRO do
// próprio script Lua (ver `if redis.call("get", KEYS[1]) ~= ARGV[1] then
// return "lock_perdido" end` nos arquivos allowlistados). `[\s\S]*?` cobre o
// script Lua multilinha entre `redis.eval(` e o array de KEYS.
const PADRAO_EVAL_MULTICHAVE_PEDIDOS = /redis\.eval\([\s\S]*?\[[^\]]*['"]pedidos['"][^\]]*\]/;

function escreveForaDoModuloCentral(conteudo: string): boolean {
  return PADRAO_ESCRITA_PEDIDOS.test(conteudo) || PADRAO_EVAL_MULTICHAVE_PEDIDOS.test(conteudo);
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
});
