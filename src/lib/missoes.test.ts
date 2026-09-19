import { describe, expect, test } from "vitest";
import { calcularMissaoAtual, type EstadoClienteMissao } from "./missoes";

const base: EstadoClienteMissao = {
  presentesDisponiveis: 0,
  estrelasAtivas: true,
  saldoEstrelas: 0,
  metaEstrelas: 50,
};

describe("calcularMissaoAtual — prioridade 1: presente disponível", () => {
  test("retorna presente_disponivel quando há presente", () => {
    const m = calcularMissaoAtual({ ...base, presentesDisponiveis: 1 });
    expect(m?.tipo).toBe("presente_disponivel");
    expect(m?.mensagem).toContain("presente disponível");
  });

  test("plural quando há mais de um", () => {
    const m = calcularMissaoAtual({ ...base, presentesDisponiveis: 3 });
    expect(m?.mensagem).toContain("3 presentes");
  });

  test("presente tem prioridade sobre estrelas quase atingidas", () => {
    const m = calcularMissaoAtual({ ...base, presentesDisponiveis: 1, saldoEstrelas: 49, metaEstrelas: 50 });
    expect(m?.tipo).toBe("presente_disponivel");
  });
});

describe("calcularMissaoAtual — prioridade 2: presente quase conquistado", () => {
  test("retorna presente_quase_conquistado quando >= 80% da meta", () => {
    const m = calcularMissaoAtual({ ...base, saldoEstrelas: 40, metaEstrelas: 50 });
    expect(m?.tipo).toBe("presente_quase_conquistado");
    expect(m?.mensagem).toContain("10 Estrelas");
  });

  test("1 estrela faltando usa singular", () => {
    const m = calcularMissaoAtual({ ...base, saldoEstrelas: 49, metaEstrelas: 50 });
    expect(m?.tipo).toBe("presente_quase_conquistado");
    expect(m?.mensagem).toContain("1 Estrela");
  });

  test("não retorna quase conquistado abaixo de 80%", () => {
    const m = calcularMissaoAtual({ ...base, saldoEstrelas: 30, metaEstrelas: 50 });
    expect(m?.tipo).not.toBe("presente_quase_conquistado");
  });

  test("não retorna quando estrelas desativadas", () => {
    const m = calcularMissaoAtual({ ...base, estrelasAtivas: false, saldoEstrelas: 48, metaEstrelas: 50 });
    expect(m?.tipo).not.toBe("presente_quase_conquistado");
  });

  test("não retorna quando meta já atingida", () => {
    const m = calcularMissaoAtual({ ...base, saldoEstrelas: 50, metaEstrelas: 50 });
    expect(m?.tipo).not.toBe("presente_quase_conquistado");
  });
});

describe("calcularMissaoAtual — prioridade 4: indicar amigo", () => {
  test("sugere indicação quando há pendentes", () => {
    const m = calcularMissaoAtual({ ...base, temIndicacoesPendentes: true });
    expect(m?.tipo).toBe("indicar_amigo");
    expect(m?.mensagem).toContain("amigo");
  });

  test("não sugere indicação quando false", () => {
    const m = calcularMissaoAtual({ ...base, saldoEstrelas: 10, temIndicacoesPendentes: false });
    expect(m?.tipo).not.toBe("indicar_amigo");
  });
});

describe("calcularMissaoAtual — prioridade 5: risco de inatividade", () => {
  test("avisa sobre inatividade após 30+ dias", () => {
    const m = calcularMissaoAtual({ ...base, diasDesdeUltimaCompra: 35 });
    expect(m?.tipo).toBe("risco_inatividade");
    expect(m?.mensagem).toContain("ativo");
  });

  test("não avisa com menos de 30 dias", () => {
    const m = calcularMissaoAtual({ ...base, diasDesdeUltimaCompra: 20 });
    expect(m?.tipo).not.toBe("risco_inatividade");
  });
});

describe("calcularMissaoAtual — prioridade 7: subir no ranking", () => {
  test("sugere subir quando está entre posição 6–10", () => {
    const m = calcularMissaoAtual({ ...base, posicaoRanking: 8, totalNoRanking: 20 });
    expect(m?.tipo).toBe("subir_ranking");
    expect(m?.mensagem).toContain("Top 5");
  });

  test("não sugere quando já está no Top 5", () => {
    const m = calcularMissaoAtual({ ...base, posicaoRanking: 3, totalNoRanking: 20 });
    expect(m?.tipo).not.toBe("subir_ranking");
  });
});

describe("calcularMissaoAtual — sem missão identificada", () => {
  test("retorna null quando não há dados suficientes", () => {
    const m = calcularMissaoAtual({ ...base });
    expect(m).toBeNull();
  });
});
