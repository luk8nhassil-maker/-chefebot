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
