import { describe, expect, it } from "vitest";
import { ESCALONAMENTO_TTL_MS, limparEscalonamentoExpiradoSeNecessario } from "./escalonamento";

describe("limparEscalonamentoExpiradoSeNecessario", () => {
  it("não mexe em pedido que nunca foi escalonado", () => {
    const { pedido, mudou } = limparEscalonamentoExpiradoSeNecessario({ escalonado: false });
    expect(mudou).toBe(false);
    expect(pedido).toEqual({ escalonado: false });
  });

  it("não mexe em pedido escalonado sem horarioEscalonado (dado incompleto — nunca força limpeza)", () => {
    const { pedido, mudou } = limparEscalonamentoExpiradoSeNecessario({ escalonado: true });
    expect(mudou).toBe(false);
    expect(pedido).toEqual({ escalonado: true });
  });

  it("mantém escalonado dentro do prazo", () => {
    const agora = 1_000_000;
    const { pedido, mudou } = limparEscalonamentoExpiradoSeNecessario(
      { escalonado: true, horarioEscalonado: agora - (ESCALONAMENTO_TTL_MS - 1) },
      agora
    );
    expect(mudou).toBe(false);
    expect(pedido.escalonado).toBe(true);
  });

  it("limpa escalonado exatamente quando o prazo estoura, sem mudar mais nada no objeto", () => {
    const agora = 1_000_000;
    const { pedido, mudou } = limparEscalonamentoExpiradoSeNecessario(
      { escalonado: true, horarioEscalonado: agora - ESCALONAMENTO_TTL_MS, status: "novo" },
      agora
    );
    expect(mudou).toBe(true);
    expect(pedido.escalonado).toBe(false);
    expect(pedido.horarioEscalonado).toBeUndefined();
    expect(pedido.status).toBe("novo"); // nunca mexe no status do pedido, só no alerta
  });

  it("limpa bem depois do prazo também", () => {
    const agora = 1_000_000;
    const { pedido, mudou } = limparEscalonamentoExpiradoSeNecessario(
      { escalonado: true, horarioEscalonado: agora - ESCALONAMENTO_TTL_MS * 5 },
      agora
    );
    expect(mudou).toBe(true);
    expect(pedido.escalonado).toBe(false);
  });
});

describe("limparEscalonamentoExpiradoSeNecessario — pedido que é só um pedido de atendimento humano (sem carrinho real)", () => {
  function placeholder(overrides: Record<string, unknown> = {}) {
    return {
      status: "novo",
      total: 0,
      itens: ["Cliente precisa de atendimento humano"],
      escalonado: true,
      horarioEscalonado: 1_000_000 - ESCALONAMENTO_TTL_MS,
      isArchived: undefined as boolean | undefined,
      archivedReason: undefined as string | undefined,
      ...overrides,
    };
  }

  it("mantém visível (não arquiva) enquanto ainda dentro do prazo do alerta", () => {
    const { pedido, mudou } = limparEscalonamentoExpiradoSeNecessario(
      placeholder({ horarioEscalonado: 1_000_000 - 1000 }),
      1_000_000
    );
    expect(mudou).toBe(false);
    expect(pedido.isArchived).toBeUndefined();
  });

  it("arquiva (não vira status 'entregue', não fica 'novo' acionável) quando o prazo estoura", () => {
    const { pedido, mudou } = limparEscalonamentoExpiradoSeNecessario(placeholder(), 1_000_000);
    expect(mudou).toBe(true);
    expect(pedido.isArchived).toBe(true);
    expect(pedido.archivedReason).toBe("atendimento_humano_sem_pedido");
    expect(pedido.escalonado).toBe(false);
    expect(pedido.status).toBe("novo"); // arquivado, não "entregue" — nunca aparece em Prontos
  });

  it("arquiva também um placeholder já quebrado (escalonado já tinha virado false antes desta correção existir)", () => {
    const { pedido, mudou } = limparEscalonamentoExpiradoSeNecessario(
      placeholder({ escalonado: false, horarioEscalonado: undefined }),
      1_000_000
    );
    expect(mudou).toBe(true);
    expect(pedido.isArchived).toBe(true);
  });

  it("nunca reprocessa um placeholder já arquivado", () => {
    const { mudou } = limparEscalonamentoExpiradoSeNecessario(
      placeholder({ isArchived: true, archivedReason: "atendimento_humano_sem_pedido" }),
      1_000_000
    );
    expect(mudou).toBe(false);
  });

  it("um pedido real (itens de verdade) nunca é arquivado por este caminho, mesmo com total 0 por acaso", () => {
    const { pedido, mudou } = limparEscalonamentoExpiradoSeNecessario(
      placeholder({ itens: ["1x Pizza G Calabresa"], total: 0 }),
      1_000_000
    );
    expect(mudou).toBe(true);
    expect(pedido.isArchived).toBeUndefined();
    expect(pedido.escalonado).toBe(false);
  });
});
