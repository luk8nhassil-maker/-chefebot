import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mesmo padrao dos demais page.test.ts do repo (ver src/app/admin/page.test.ts):
// sem jsdom/testing-library, requisitos garantidos estruturalmente na fonte.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/configuracoes — trava de clique duplo em adicionarBebida", () => {
  // Mesma causa raiz investigada nos produtos "Teste" R$1,00: dois cliques
  // rapidos no "+ Add" usam o mesmo closure de novoItem/novoPreco, entao sem
  // uma trava sincrona os dois passam pelo `if` e cada um chama setCardapio,
  // duplicando o item a partir de um unico clique.
  test("existe um ref de trava dedicado", () => {
    expect(fonte).toContain("const adicionandoBebidaRef = useRef(false)");
  });

  test("adicionarBebida verifica a trava antes do if e a libera apos o sucesso", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const adicionarBebida = (tipo:"),
      fonte.indexOf("const removerBairro")
    );
    expect(corpo).toContain("if (adicionandoBebidaRef.current) return");
    expect(corpo).toContain("adicionandoBebidaRef.current = true");
    expect(corpo).toContain("adicionandoBebidaRef.current = false");
  });
});

describe("/configuracoes — REGRESSÃO (BLOQUEIO 2, auditoria independente pós-6ª rodada): 'Salvar Cardápio' não apaga flavorsMode do Calzone", () => {
  // POST /api/cardapio substitui o objeto INTEIRO persistido no Redis — o
  // corpo enviado por salvarCardapio precisa incluir `lanches` (com o
  // flavorsMode do Calzone), senão a troca de modo feita via
  // alternarCalzoneModo é apagada no primeiro "Salvar Cardápio" seguinte.
  test("salvarCardapio inclui `lanches` no corpo do POST /api/cardapio", () => {
    const corpo = fonte.slice(fonte.indexOf("const salvarCardapio = async"), fonte.indexOf("const removerSabor"));
    expect(corpo).toContain("body: JSON.stringify({ ...cardapio, lanches })");
  });

  test("o cardápio carregado de GET /api/cardapio popula o estado `lanches` (fonte do POST de salvarCardapio)", () => {
    const corpo = fonte.slice(fonte.indexOf("fetch('/api/cardapio')"), fonte.indexOf("function showMsg"));
    expect(corpo).toContain("setLanches(lanchesData)");
  });

  test("alternarCalzoneModo atualiza o MESMO estado `lanches` após salvar — nunca uma segunda fonte de configuração do modo do Calzone", () => {
    const corpo = fonte.slice(fonte.indexOf("const alternarCalzoneModo = async"), fonte.indexOf("const salvarCardapio = async"));
    expect(corpo).toContain("setLanches(prev => prev.map(l => (l.flavorsKey === 'calzoneFlavors' ? { ...l, flavorsMode: novoModo } : l)))");
  });

  test("existe um único estado `lanches` (useState) — não há um segundo array de lanches guardando o modo do Calzone em paralelo", () => {
    const ocorrencias = fonte.match(/useState<Array<Record<string, unknown>>>\(\[\]\)/g) ?? [];
    expect(ocorrencias.length).toBe(1);
  });
});
