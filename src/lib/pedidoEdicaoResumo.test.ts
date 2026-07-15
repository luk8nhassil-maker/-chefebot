import { describe, expect, it } from "vitest";
import { montarResumoAlteracoes } from "./pedidoEdicaoResumo";

const base = {
  itens: ["1x Pizza G Calabresa"],
  total: 42,
  pagamento: "Pix",
  tipoEntrega: "delivery",
  endereco: "Rua A, 1 - Centro",
  troco: undefined,
  observacao: undefined,
};

describe("montarResumoAlteracoes", () => {
  it("sem alteracoes retorna lista vazia", () => {
    expect(montarResumoAlteracoes(base, { ...base })).toEqual([]);
  });

  it("detecta mudanca de pagamento", () => {
    const resumo = montarResumoAlteracoes(base, { ...base, pagamento: "Dinheiro" });
    expect(resumo).toContain("Pagamento: Pix → Dinheiro");
  });

  it("detecta mudanca de total", () => {
    const resumo = montarResumoAlteracoes(base, { ...base, total: 49 });
    expect(resumo.some((l) => l.includes("Total: R$ 42,00 → R$ 49,00"))).toBe(true);
  });

  it("detecta item adicionado e removido", () => {
    const resumo = montarResumoAlteracoes(base, { ...base, itens: ["1x Refrigerante 2L"] });
    expect(resumo).toContain("Adicionado: 1x Refrigerante 2L");
    expect(resumo).toContain("Removido: 1x Pizza G Calabresa");
  });

  it("detecta mudanca de tipo de entrega", () => {
    const resumo = montarResumoAlteracoes(base, { ...base, tipoEntrega: "retirada" });
    expect(resumo.some((l) => l.startsWith("Entrega: Entrega → Retirada"))).toBe(true);
  });

  it("detecta endereco atualizado mantendo o mesmo tipo de entrega", () => {
    const resumo = montarResumoAlteracoes(base, { ...base, endereco: "Rua B, 2 - Tucum" });
    expect(resumo).toContain("Endereço atualizado");
  });

  it("detecta troco e observacao atualizados", () => {
    const resumo = montarResumoAlteracoes(base, { ...base, troco: "Sem troco", observacao: "Sem cebola" });
    expect(resumo).toContain("Troco atualizado");
    expect(resumo).toContain("Observação atualizada");
  });
});
