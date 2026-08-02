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
