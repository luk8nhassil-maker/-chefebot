import { describe, expect, test } from "vitest";
import {
  POLITICA_CONTATO_PESQUISA,
  avaliarElegibilidadeContatoPesquisa,
  resumoSegurancaContatoDryRun,
  type ContatoPesquisaRegistrado,
} from "./pesquisaPreferenciaContato";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 8, 24, 12, 0, 0);

function contato(diasAtras: number, questionId = "research-m1-main"): ContatoPesquisaRegistrado {
  return {
    momentId: "M1",
    questionId,
    sentAtMs: AGORA - diasAtras * DIA,
  };
}

describe("avaliarElegibilidadeContatoPesquisa", () => {
  test("falha fechada quando as fontes operacionais ainda não estão completas", () => {
    const resultado = avaliarElegibilidadeContatoPesquisa({
      agoraMs: AGORA,
      contexto: { fontesOperacionaisCompletas: false },
      historicoContatos: [],
    });

    expect(resultado.status).toBe("suprimido");
    expect(resultado.motivos).toContain("fontes_operacionais_incompletas");
  });

  test("bloqueia checkout, pagamento, pedido em produção, problema e opt-out", () => {
    const resultado = avaliarElegibilidadeContatoPesquisa({
      agoraMs: AGORA,
      contexto: {
        fontesOperacionaisCompletas: true,
        checkoutEmAndamento: true,
        pagamentoPendente: true,
        pedidoEmProducaoOuEntrega: true,
        problemaAberto: true,
        optOut: true,
      },
      historicoContatos: [],
    });

    expect(resultado.status).toBe("suprimido");
    expect(resultado.motivos).toEqual(
      expect.arrayContaining([
        "checkout_em_andamento",
        "pagamento_pendente",
        "pedido_em_producao_ou_entrega",
        "problema_aberto",
        "opt_out",
      ])
    );
  });

  test("aplica cooldown de 14 dias sem inventar outro corte", () => {
    const resultado = avaliarElegibilidadeContatoPesquisa({
      agoraMs: AGORA,
      contexto: { fontesOperacionaisCompletas: true },
      historicoContatos: [contato(13)],
    });

    expect(resultado.status).toBe("suprimido");
    expect(resultado.contatosUltimos14Dias).toBe(1);
    expect(resultado.motivos).toContain("cooldown_14_dias");
  });

  test("libera exatamente quando 14 dias completos já passaram", () => {
    const resultado = avaliarElegibilidadeContatoPesquisa({
      agoraMs: AGORA,
      contexto: { fontesOperacionaisCompletas: true },
      historicoContatos: [contato(14)],
    });

    expect(resultado.status).toBe("elegivel");
    expect(resultado.contatosUltimos14Dias).toBe(0);
  });

  test("aplica orçamento máximo de 3 contatos em 90 dias", () => {
    const resultado = avaliarElegibilidadeContatoPesquisa({
      agoraMs: AGORA,
      contexto: { fontesOperacionaisCompletas: true },
      historicoContatos: [contato(20), contato(40), contato(80)],
    });

    expect(resultado.status).toBe("suprimido");
    expect(resultado.contatosUltimos14Dias).toBe(0);
    expect(resultado.contatosUltimos90Dias).toBe(3);
    expect(resultado.motivos).toContain("limite_3_contatos_90_dias");
  });

  test("permite somente quando todos os gates conhecidos estão verdes", () => {
    const resultado = avaliarElegibilidadeContatoPesquisa({
      agoraMs: AGORA,
      contexto: { fontesOperacionaisCompletas: true },
      historicoContatos: [contato(100)],
    });

    expect(resultado).toEqual({
      status: "elegivel",
      motivos: [],
      contatosUltimos14Dias: 0,
      contatosUltimos90Dias: 0,
    });
  });

  test("mantém a política aprovada de 14 dias e 3 contatos em 90 dias", () => {
    expect(POLITICA_CONTATO_PESQUISA).toEqual({
      cooldownDias: 14,
      maxContatosEm90Dias: 3,
      janelaOrcamentoDias: 90,
    });
  });
});

describe("resumoSegurancaContatoDryRun", () => {
  test("declara explicitamente que o dry-run não pode virar envio", () => {
    const resumo = resumoSegurancaContatoDryRun();

    expect(resumo.envioAutomaticoAtivo).toBe(false);
    expect(resumo.elegibilidadeFinalCalculada).toBe(false);
    expect(resumo.candidatosComportamentaisNaoSaoElegiveisFinais).toBe(true);
    expect(resumo.fontesConectadas).toContain("historico_de_exposicoes_de_pesquisa");
    expect(resumo.fontesPendentes).not.toContain("historico_de_exposicoes_de_pesquisa");
    expect(resumo.fontesPendentes).toContain("opt_out");
  });
});
