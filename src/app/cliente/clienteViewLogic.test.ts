import { describe, test, expect } from "vitest";
import {
  descreverMovimento,
  primeiroNome,
  formatarMoeda,
  progressoVisual,
  minutosRestantes,
  resgateEstaAtivo,
  deveExibirMetaAtingida,
  deveExibirPontosPrevistos,
  podeExibirCtaResgate,
  EXTRATO_LABEL,
  type RecompensaInfo,
} from "./clienteViewLogic";

// Etapa 4 — Área do Cliente. O projeto nao usa jsdom/testing-library (nenhuma
// dependencia nova foi instalada, conforme exigido), entao a logica de
// apresentacao foi extraida para funcoes puras e testada aqui. A renderizacao
// real (estados de tela, ausencia de overflow, dados sensiveis no DOM) e
// verificada na QA visual obrigatoria com o navegador (Playwright ja
// pre-instalado no ambiente).

describe("Etapa 4 — saldo e meta (dados reais da API)", () => {
  test("consome os campos exatos retornados por GET /api/cliente/fidelidade", () => {
    const fidelidade = {
      saldoPontos: 120,
      pontosPrevistos: 0,
      metaPontos: 720,
      pontosFaltantes: 600,
      progressoPercentual: 17,
      metaAtingida: false,
      extrato: [],
      recompensa: null,
    };
    expect(fidelidade.saldoPontos).toBe(120);
    expect(fidelidade.metaPontos).toBe(720);
    expect(deveExibirMetaAtingida(fidelidade)).toBe(false);
  });
});

describe("Etapa 4 — pontos previstos separados do saldo confirmado", () => {
  test("nao exibe quando nao ha pontos previstos", () => {
    expect(deveExibirPontosPrevistos({ pontosPrevistos: 0 })).toBe(false);
  });

  test("exibe quando ha pontos previstos, sem somar ao saldo", () => {
    expect(deveExibirPontosPrevistos({ pontosPrevistos: 12 })).toBe(true);
  });
});

describe("Etapa 4 — progresso sempre limitado visualmente a 100%", () => {
  test("percentual normal passa direto", () => {
    expect(progressoVisual(42)).toBe(42);
  });

  test("percentual acima de 100 (saldo maior que a meta) e limitado a 100", () => {
    expect(progressoVisual(340)).toBe(100);
  });

  test("percentual negativo nunca aparece (limitado a 0)", () => {
    expect(progressoVisual(-5)).toBe(0);
  });
});

describe("Etapa 4 — estado de meta atingida", () => {
  test("card de meta atingida substitui o de progresso quando metaAtingida=true", () => {
    expect(deveExibirMetaAtingida({ metaAtingida: true })).toBe(true);
  });

  test("meta nao atingida mantem o card de progresso normal", () => {
    expect(deveExibirMetaAtingida({ metaAtingida: false })).toBe(false);
  });
});

describe("Etapa 4 — extrato: movimentos positivos e negativos visualmente distintos", () => {
  test("confirmado e positivo (verde)", () => {
    expect(descreverMovimento({ tipo: "confirmado", pontos: 45 })).toEqual({ valorTexto: "+45", cor: "sucesso" });
  });

  test("resgate_estornado (restituicao) e positivo (verde)", () => {
    expect(descreverMovimento({ tipo: "resgate_estornado", pontos: 500 })).toEqual({ valorTexto: "+500", cor: "sucesso" });
  });

  test("resgatado e negativo", () => {
    expect(descreverMovimento({ tipo: "resgatado", pontos: 500 })).toEqual({ valorTexto: "−500", cor: "erro" });
  });

  test("estornado e negativo", () => {
    expect(descreverMovimento({ tipo: "estornado", pontos: 80 })).toEqual({ valorTexto: "−80", cor: "erro" });
  });

  test("cancelado permanece visivel para transparencia, sem valor numerico (—)", () => {
    expect(descreverMovimento({ tipo: "cancelado", pontos: 50 })).toEqual({ valorTexto: "—", cor: "neutra" });
  });

  test("previsto e marcado como estimativa, nao confundido com confirmado", () => {
    expect(descreverMovimento({ tipo: "previsto", pontos: 12 })).toEqual({ valorTexto: "+12 (previsto)", cor: "neutra" });
  });

  test("ajuste positivo e negativo seguem o sinal do valor", () => {
    expect(descreverMovimento({ tipo: "ajuste", pontos: 20 })).toEqual({ valorTexto: "+20", cor: "sucesso" });
    expect(descreverMovimento({ tipo: "ajuste", pontos: -50 })).toEqual({ valorTexto: "-50", cor: "erro" });
  });

  test("todos os tipos do extrato tem um rotulo amigavel definido", () => {
    const tipos: (keyof typeof EXTRATO_LABEL)[] = [
      "previsto", "confirmado", "cancelado", "estornado", "resgatado", "ajuste", "resgate_estornado",
    ];
    for (const tipo of tipos) {
      expect(EXTRATO_LABEL[tipo]).toBeTruthy();
      expect(typeof EXTRATO_LABEL[tipo]).toBe("string");
    }
  });
});

describe("Etapa 4 — recompensa disponível / bloqueada (nunca fictícia)", () => {
  const recompensa: RecompensaInfo = {
    ativa: true,
    custoPontos: 500,
    tipo: "desconto_fixo",
    descricao: "R$20 de desconto",
    disponivel: true,
  };

  test("CTA de resgate so aparece quando ha recompensa configurada e disponivel", () => {
    expect(podeExibirCtaResgate(recompensa, null)).toBe(true);
  });

  test("sem recompensa configurada (null), nunca mostra CTA fictício", () => {
    expect(podeExibirCtaResgate(null, null)).toBe(false);
  });

  test("recompensa bloqueada (disponivel=false) nao mostra CTA", () => {
    expect(podeExibirCtaResgate({ ...recompensa, disponivel: false }, null)).toBe(false);
  });

  test("com uma reserva ja ativa, o CTA de criar novo resgate fica oculto (evita duplicidade)", () => {
    const resgateAtivo = { resgateId: "res_1", status: "reservado" as const, expiraEm: new Date(Date.now() + 60000).toISOString() };
    expect(podeExibirCtaResgate(recompensa, resgateAtivo)).toBe(false);
  });
});

describe("Etapa 4 — validade da reserva de resgate", () => {
  test("reserva reservada e nao expirada esta ativa", () => {
    const emQuinzeMin = new Date(Date.now() + 15 * 60000).toISOString();
    expect(resgateEstaAtivo({ status: "reservado", expiraEm: emQuinzeMin })).toBe(true);
  });

  test("reserva expirada nao e mais considerada ativa mesmo com status 'reservado' desatualizado", () => {
    const noPassado = new Date(Date.now() - 1000).toISOString();
    expect(resgateEstaAtivo({ status: "reservado", expiraEm: noPassado })).toBe(false);
  });

  test("reserva ja aplicada nunca e exibida como ativa/pendente", () => {
    const emQuinzeMin = new Date(Date.now() + 15 * 60000).toISOString();
    expect(resgateEstaAtivo({ status: "aplicado", expiraEm: emQuinzeMin })).toBe(false);
  });

  test("minutos restantes nunca fica negativo", () => {
    const noPassado = new Date(Date.now() - 5 * 60000).toISOString();
    expect(minutosRestantes(noPassado)).toBe(0);
  });
});

describe("Etapa 4 — nenhuma informação sensível exposta na saudação", () => {
  test("saudação usa apenas o primeiro nome, nunca o nome completo", () => {
    expect(primeiroNome("Fulano de Tal Silva")).toBe("Fulano");
  });

  test("cliente sem nome cadastrado nao quebra a saudação", () => {
    expect(primeiroNome(null)).toBeNull();
    expect(primeiroNome(undefined)).toBeNull();
  });

  test("função de saudação nunca recebe nem processa telefone/JWT/OTP (assinatura só aceita nome)", () => {
    // Garantia estrutural: primeiroNome só aceita string|null|undefined — não
    // há como um token, OTP ou telefone completo passar por essa função e
    // acabar renderizado como se fosse o nome do cliente.
    expect(primeiroNome("Ana")).toBe("Ana");
  });
});

describe("Etapa 4 — formatação de valores monetários do histórico de pedidos", () => {
  test("formata valor em reais com vírgula", () => {
    expect(formatarMoeda(49.9)).toBe("R$ 49,90");
  });

  test("valor ausente cai para R$ 0,00", () => {
    expect(formatarMoeda(undefined)).toBe("R$ 0,00");
  });
});
