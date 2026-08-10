import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Garante que as categorias da home do cardápio (Pizzas, Lanches,
// Macarronada, Bebidas, Sucos) usam ícones lucide-react, não emoji — sem
// depender de montar o componente inteiro (que exige mockar useLiveMenu,
// router, tema etc.). Falha se qualquer um dos 5 botões voltar a usar um
// emoji funcional como ícone de categoria.
const fonte = readFileSync(join(__dirname, "page.tsx"), "utf8");

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe("categorias da home do cardápio não usam emoji como ícone de navegação", () => {
  test("botão Pizzas usa ícone lucide (CATEGORIA_ICON.pizza), não ICONS.pizza (emoji)", () => {
    const trecho = fonte.match(/<button className="home-cat" onClick=\{\(\) => goPizza\("tradicional"\)\}>[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(trecho).toContain("CATEGORIA_ICON.pizza");
    expect(trecho).not.toMatch(EMOJI_RE);
  });

  test("botão Lanches usa ícone lucide, não emoji", () => {
    const trecho = fonte.match(/<button className="home-cat" onClick=\{\(\) => goCat\("lanche"\)\}>[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(trecho).toContain("CATEGORIA_ICON.lanche");
    expect(trecho).not.toMatch(EMOJI_RE);
  });

  test("botão Macarronada usa ícone lucide, não emoji", () => {
    const trecho = fonte.match(/<button className="home-cat" onClick=\{\(\) => goCat\("macarronada"\)\}>[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(trecho).toContain("CATEGORIA_ICON.macarronada");
    expect(trecho).not.toMatch(EMOJI_RE);
  });

  test("botão Bebidas usa ícone lucide, não emoji", () => {
    const trecho = fonte.match(/<button className="home-cat" onClick=\{\(\) => goCat\("bebida"\)\}>[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(trecho).toContain("CATEGORIA_ICON.bebidas");
    expect(trecho).not.toMatch(EMOJI_RE);
  });

  test("botão Sucos usa ícone lucide, não emoji", () => {
    const trecho = fonte.match(/<button className="home-cat" onClick=\{\(\) => goCat\("suco"\)\}>[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(trecho).toContain("CATEGORIA_ICON.sucos");
    expect(trecho).not.toMatch(EMOJI_RE);
  });

  test("CATEGORIA_ICON mapeia as 5 categorias para componentes lucide-react importados", () => {
    expect(fonte).toMatch(/import \{[^}]*Pizza,[^}]*Sandwich,[^}]*Soup,[^}]*CupSoda,[^}]*GlassWater[^}]*\} from "lucide-react"/);
    expect(fonte).toMatch(/const CATEGORIA_ICON = \{\s*pizza: Pizza,\s*lanche: Sandwich,\s*macarronada: Soup,\s*bebidas: CupSoda,\s*sucos: GlassWater,/);
  });
});
