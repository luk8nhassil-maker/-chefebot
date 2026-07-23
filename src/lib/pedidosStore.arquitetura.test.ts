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
]);

const PADRAO_ESCRITA_PEDIDOS = /redis\.(set|del)\(\s*['"]pedidos['"]/;

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
  test("nenhum arquivo fora da allowlist contém redis.set/del direto em 'pedidos'", () => {
    const raizSrc = join(__dirname, "..");
    const violacoes: string[] = [];

    for (const caminhoAbsoluto of listarArquivosTs(raizSrc)) {
      const caminhoRelativo = "src/" + relative(raizSrc, caminhoAbsoluto).replace(/\\/g, "/");
      const conteudo = readFileSync(caminhoAbsoluto, "utf-8");
      if (PADRAO_ESCRITA_PEDIDOS.test(conteudo) && !ALLOWLIST_ESCAPE_HATCH.has(caminhoRelativo)) {
        violacoes.push(caminhoRelativo);
      }
    }

    expect(violacoes).toEqual([]);
  });

  test("allowlist do escape hatch não tem entradas obsoletas (arquivo removido ou não usa mais redis.set/del em 'pedidos')", () => {
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
      expect(
        PADRAO_ESCRITA_PEDIDOS.test(conteudo),
        `Allowlist desatualizada: ${caminhoRelativo} não contém mais redis.set/del direto em "pedidos". Remova da lista.`
      ).toBe(true);
      expect(
        conteudo.includes("executarComLockPedidos"),
        `${caminhoRelativo} está na allowlist do escape hatch mas não importa/usa executarComLockPedidos — a escrita direta em "pedidos" precisa rodar dentro do lock central.`
      ).toBe(true);
    }
  });
});
