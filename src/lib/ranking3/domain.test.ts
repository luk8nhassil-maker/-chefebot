import { describe, expect, it } from "vitest";
import { avisoDevido, concederPremios, copyPremio, corteCivil, fechar, janelaAtual, janelaTemporada, materializarPizza, QUINZE_DIAS, saboresElegiveis, scoreCompetitivo, transicionarPremio, type Classificado, type Cohort } from "./domain";
import { buildPizzaCatalog } from "../catalog/pizzas";
import type { Menu } from "../menu";
import type { MovimentoPontos } from "../fidelidade";
import { REGRA_ESTRELAS_V1 } from "../estrelas";
import { contarPizzasPagasParaFidelidade } from "../pedidoAppItens";
import { computeTaxaApp } from "../pedidoAppLogic";
import { calcularRequestFingerprint } from "../../survival/requestFingerprint";

const vazio: Cohort = { top10: [], nivel3: [], pendentes: [], meta: null };
const janela = janelaTemporada("2026-10-20", 0);
const participantes = (n: number): Classificado[] => Array.from({ length: n }, (_, i) => ({ clienteId: `sintetico-${i}`, score: 20 - i, atingidoEm: i }));
const premio = () => concederPremios(fechar(janela, participantes(10), vazio))[0];
const catalogo = buildPizzaCatalog({} as Menu);

describe("Ranking 3 — calendário civil e mérito", () => {
  it("vira exatamente às 03h de Brasília, sem duplicar a fronteira", () => {
    expect(janela.inicio).toBe("2026-10-20T06:00:00.000Z");
    expect(janela.fim).toBe("2026-11-19T06:00:00.000Z");
    expect(janelaAtual("2026-10-20", Date.parse(janela.fim) - 1)?.indice).toBe(0);
    expect(janelaAtual("2026-10-20", Date.parse(janela.fim))?.indice).toBe(1);
    expect(janelaAtual("2026-10-20", Date.parse(janela.inicio) - 1)).toBeNull();
  });
  it("30 dias civis, inclusive mudança histórica de DST", () => {
    expect(corteCivil("2018-11-04")).toBe("2018-11-04T05:00:00.000Z");
    const dst = janelaTemporada("2018-10-20", 0);
    expect(dst.fim).toBe("2018-11-19T05:00:00.000Z");
    expect(Date.parse(dst.fim) - Date.parse(dst.inicio)).toBe(30 * 86400000 - 3600000);
  });
  it.each(["2026-02-31", "20/10/2026", "invalid"])("rejeita âncora inválida %s", (ancora) => {
    expect(() => janelaTemporada(ancora, 0)).toThrow();
  });
  it("gasto da carteira não reduz score, previsto não conta, estorno conta", () => {
    const movimento = (tipo: MovimentoPontos["tipo"], pontos: number, createdAt = janela.inicio) => ({ tipo, pontos, createdAt, regraVersao: REGRA_ESTRELAS_V1 }) as MovimentoPontos;
    expect(scoreCompetitivo([movimento("confirmado", 12), movimento("resgatado", 10), movimento("previsto", 80), movimento("estornado", 2), movimento("confirmado", 100, janela.fim)], [], janela).score).toBe(10);
  });
  it.each([0, 5, 6, 9, 10])("fecha %i participantes sem inventar campeão/meta", (n) => {
    const resultado = fechar(janela, participantes(n), vazio);
    expect(resultado.campeoes).toHaveLength(n ? 1 : 0);
    expect(resultado.proximo.top10).toHaveLength(n >= 10 ? 10 : 0);
    expect(resultado.proximo.meta).toBe(n >= 10 ? 15 : null);
    expect(resultado.decisaoPendente).toBe(n > 0 && n < 10 ? "menos_de_dez_promovidos" : null);
  });
  it("duas temporadas separadas: campeões distintos, meta congelada, TODOS >=meta sobem", () => {
    const primeiro = fechar(janela, participantes(20), vazio);
    const segundo = fechar(janelaTemporada("2026-10-20", 1), participantes(20), primeiro.proximo);
    expect(segundo.top10.map((e) => e.clienteId)).toEqual(primeiro.proximo.top10);
    expect(segundo.normal).toHaveLength(10);
    expect(segundo.proximo.nivel3).toHaveLength(6);
    expect(segundo.campeoes).toEqual([{ liga: 1, clienteId: "sintetico-10" }, { liga: 2, clienteId: "sintetico-0" }]);
    const terceiro = fechar(janelaTemporada("2026-10-20", 2), participantes(20), segundo.proximo);
    expect(terceiro.normal.some((e) => segundo.proximo.nivel3.includes(e.clienteId))).toBe(false);
  });
  it("meta ausente preserva mérito sem avanço arbitrário ao Nível 3", () => {
    const r = fechar(janela, participantes(5), { ...vazio, top10: ["sintetico-0"], meta: null });
    expect(r.proximo.nivel3).toEqual([]);
    expect(r.proximo.pendentes).toContain("sintetico-0");
    expect(r.campeoes).toContainEqual({ liga: 2, clienteId: "sintetico-0" });
  });
  it("desempate estável respeita quem atingiu primeiro, depois ID", () => {
    const r = fechar(janela, [{ clienteId: "b", score: 5, atingidoEm: 2 }, { clienteId: "c", score: 5, atingidoEm: 1 }, { clienteId: "a", score: 5, atingidoEm: 1 }], vazio);
    expect(r.normal.map((e) => e.clienteId)).toEqual(["a", "c", "b"]);
  });
});

describe("Ranking 3 — economia, catálogo e pedido", () => {
  it("usa preço oficial F: um sabor N1 e nove N2, sem tabela duplicada", () => {
    expect(saboresElegiveis({ tetoCents: 4700 }, catalogo).map((f) => f.name)).toEqual(["Presunto"]);
    expect(saboresElegiveis({ tetoCents: 5000 }, catalogo)).toHaveLength(9);
  });
  it("materializa exatamente uma F, até duas metades permitidas, sem nova fidelidade", () => {
    const p = { ...premio(), tetoCents: 5000 as const };
    for (const flavorIds of [["flavor-presunto"], ["flavor-presunto", "flavor-calabresa"]]) {
      const item = materializarPizza(p, { sizeId: "size-f", flavorIds }, catalogo);
      expect(item.price).toBe(0); expect(item.qty).toBe(1);
      expect(contarPizzasPagasParaFidelidade([item])).toBe(0);
    }
  });
  it.each([
    { sizeId: "size-g", flavorIds: ["flavor-presunto"] },
    { sizeId: "size-f", flavorIds: [] },
    { sizeId: "size-f", flavorIds: ["flavor-calabresa"] },
    { sizeId: "size-f", flavorIds: ["flavor-presunto", "flavor-presunto"] },
    { sizeId: "size-f", flavorIds: ["flavor-presunto"], borderId: "border-catupiry" },
    { sizeId: "size-f", flavorIds: ["flavor-presunto"], addOnIds: ["addon-bacon"] },
  ])("rejeita adulteração/limite: %j", (selecao) => {
    expect(() => materializarPizza(premio(), selecao, catalogo)).toThrow();
  });
  it("esgotamento não altera direito; retirada grátis e taxa normal preservada", () => {
    const semPresunto = { ...catalogo, flavors: catalogo.flavors.map((f) => ({ ...f, available: false })) };
    expect(saboresElegiveis(premio(), semPresunto)).toEqual([]);
    expect(premio().estado).toBe("disponivel");
    expect(computeTaxaApp("retirada", undefined, [])).toBe(0);
    expect(computeTaxaApp("delivery", "Centro", [{ name: "Centro", fee: 8 }])).toBe(8);
  });
  it("prêmios de temporadas/anos diferentes têm IDs distintos e nunca expiram", () => {
    const antigo = concederPremios(fechar(janelaTemporada("2025-10-20", 0), participantes(10), vazio))[0];
    expect(antigo.id).not.toBe(premio().id);
    expect(avisoDevido(antigo, Date.parse("2030-01-01"))).toBe(true);
  });
});

describe("Ranking 3 — estados e lembretes", () => {
  it.each(["associado", "em_preparo", "saiu_entrega"] as const)("cancelamento em %s restaura o MESMO direito e reinicia 15 dias", (estado) => {
    let p = transicionarPremio(premio(), "pedido-sintetico", "associado", 0);
    if (estado !== "associado") p = transicionarPremio(p, "pedido-sintetico", estado, 0);
    expect(avisoDevido(p, Infinity)).toBe(false);
    const restaurado = transicionarPremio(p, "pedido-sintetico", "cancelado", 1000);
    expect(restaurado.id).toBe(p.id); expect(restaurado.estado).toBe("disponivel");
    expect(avisoDevido(restaurado, 1000 + QUINZE_DIAS - 1)).toBe(false);
    expect(avisoDevido(restaurado, 1000 + QUINZE_DIAS)).toBe(true);
    expect(transicionarPremio(restaurado, "pedido-sintetico", "cancelado", 3000)).toEqual(restaurado);
  });
  it("entrega verdadeira não pode ser restaurada; dois pedidos não usam um direito", () => {
    const associado = transicionarPremio(premio(), "pedido-sintetico", "associado", 0);
    expect(() => transicionarPremio(associado, "outro-pedido", "associado", 0)).toThrow();
    const entregue = transicionarPremio(associado, "pedido-sintetico", "entregue", 0);
    expect(() => transicionarPremio(entregue, "pedido-sintetico", "cancelado", 0)).toThrow();
  });
  it("copy aprovada não contém placeholders nem segredo e exige deep link oficial", () => {
    const texto = copyPremio("Brito\n[atacante]", "https://chefedapizza.com.br/cliente/premios");
    expect(texto).toContain("Oi, Brito!"); expect(texto).not.toMatch(/\[nome\]|\[link\]/i);
    expect(() => copyPremio("Brito", "https://externo.example/cliente/premios")).toThrow();
  });
  it("trocar seleção/prêmio muda fingerprint da tentativa", () => {
    const base = { cliente: "Sintético", telefonePedido: "sintetico", itens: [], tipoEntrega: "retirada", pagamento: "Cartao" };
    expect(calcularRequestFingerprint({ ...base, premioRanking: { id: premio().id, selecao: { flavorIds: ["a"] } } })).not.toBe(calcularRequestFingerprint({ ...base, premioRanking: { id: premio().id, selecao: { flavorIds: ["b"] } } }));
  });
});
