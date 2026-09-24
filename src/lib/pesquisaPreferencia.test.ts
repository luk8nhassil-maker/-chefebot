import { describe, expect, test } from "vitest";
import type { EventoAnalitico } from "./historicoAnalitico";
import { MOMENTOS_PESQUISA, analisarPesquisaPreferencia } from "./pesquisaPreferencia";

const DIA = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 8, 1, 12, 0, 0);

function evento(
  clienteId: string,
  pedidoId: string,
  dia: number,
  statusAnalitico: EventoAnalitico["statusAnalitico"] = "entregue"
): EventoAnalitico {
  return {
    pedidoId,
    clienteId,
    tenantId: "default",
    criadoEmMs: BASE + dia * DIA,
    expedienteId: `exp-${dia}`,
    valorElegivelCents: 5000,
    statusAnalitico,
    canal: "app",
    estrelasGeradas: 5,
    schemaVersao: 1,
    regraVersao: "estrelas-faixas-v1",
  };
}

describe("MOMENTOS_PESQUISA", () => {
  test("possui IDs únicos de M0 a M14", () => {
    const ids = MOMENTOS_PESQUISA.map((momento) => momento.id);
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(15);
    expect(ids[0]).toBe("M0");
    expect(ids[14]).toBe("M14");
  });

  test("baseline M0 não envia pergunta", () => {
    expect(MOMENTOS_PESQUISA.find((momento) => momento.id === "M0")?.perguntaPrincipal).toBeNull();
  });
});

describe("analisarPesquisaPreferencia", () => {
  test("retorna dry-run vazio sem inventar limiares", () => {
    const agoraMs = BASE + 10 * DIA;
    const resumo = analisarPesquisaPreferencia([], {
      agoraMs,
      janelaInicioMs: BASE,
    });

    expect(resumo.modo).toBe("dry-run");
    expect(resumo.cobertura.clientesObservados).toBe(0);
    expect(resumo.calibracao.medianaIntervaloDias).toBeNull();
    expect(resumo.calibracao.p75IntervaloDias).toBeNull();
    expect(resumo.calibracao.p90IntervaloDias).toBeNull();
    expect(resumo.momentos.M1.quantidade).toBe(0);
  });

  test("calibra frequência com quantis do histórico observado, sem corte fixo de dias", () => {
    const eventos = [
      evento("cid_a", "a1", 0),
      evento("cid_a", "a2", 1),
      evento("cid_a", "a3", 3),
      evento("cid_a", "a4", 6),
      evento("cid_b", "b1", 0),
      evento("cid_b", "b2", 4),
    ];

    const resumo = analisarPesquisaPreferencia(eventos, {
      agoraMs: BASE + 7 * DIA,
      janelaInicioMs: BASE,
    });

    expect(resumo.calibracao.medianaIntervaloDias).toBe(2);
    expect(resumo.calibracao.p75IntervaloDias).toBe(3);
    expect(resumo.calibracao.p90IntervaloDias).toBe(4);
    expect(resumo.calibracao.origemDosLimiares).toBe("quantis_do_historico_observado");
    expect(resumo.momentos.M1.quantidade).toBe(2);
    expect(resumo.momentos.M2.quantidade).toBe(2);
    expect(resumo.estadosAtuais.S4).toBe(1);
    expect(resumo.estadosAtuais.S2).toBe(1);
  });

  test("separa recorrente, queda e possível inatividade usando p75/p90 observados", () => {
    const eventos = [
      evento("cid_a", "a1", 0),
      evento("cid_a", "a2", 1),
      evento("cid_a", "a3", 3),
      evento("cid_a", "a4", 6),
      evento("cid_b", "b1", 0),
      evento("cid_b", "b2", 4),
      evento("cid_c", "c1", 0),
      evento("cid_c", "c2", 1),
      evento("cid_d", "d1", 0),
      evento("cid_d", "d2", 1),
    ];

    const resumo = analisarPesquisaPreferencia(eventos, {
      agoraMs: BASE + 8 * DIA,
      janelaInicioMs: BASE,
    });

    expect(resumo.calibracao.p75IntervaloDias).toBe(3);
    expect(resumo.calibracao.p90IntervaloDias).toBe(4);
    expect(resumo.estadosAtuais.S4).toBe(1);
    expect(resumo.estadosAtuais.S5).toBe(1);
    expect(resumo.estadosAtuais.S6).toBe(2);
    expect(resumo.momentos.M4.quantidade).toBe(1);
    expect(resumo.momentos.M5.quantidade).toBe(1);
  });

  test("detecta retorno após intervalo atípico pela distribuição, sem número comercial hardcoded", () => {
    const eventos: EventoAnalitico[] = [];
    for (let i = 0; i < 9; i += 1) {
      eventos.push(evento(`cid_curto_${i}`, `p${i}_1`, 0));
      eventos.push(evento(`cid_curto_${i}`, `p${i}_2`, 1));
    }
    eventos.push(evento("cid_retorno", "ret_1", 0));
    eventos.push(evento("cid_retorno", "ret_2", 10));

    const resumo = analisarPesquisaPreferencia(eventos, {
      agoraMs: BASE + 11 * DIA,
      janelaInicioMs: BASE,
    });

    expect(resumo.calibracao.p90IntervaloDias).toBe(1);
    expect(resumo.momentos.M6.quantidade).toBe(1);
  });

  test("estornado não participa do comportamento", () => {
    const resumo = analisarPesquisaPreferencia(
      [
        evento("cid_a", "p1", 0),
        evento("cid_a", "p2", 1, "estornado"),
      ],
      {
        agoraMs: BASE + 2 * DIA,
        janelaInicioMs: BASE,
      }
    );

    expect(resumo.cobertura.pedidosValidosObservados).toBe(1);
    expect(resumo.cobertura.clientesObservados).toBe(1);
    expect(resumo.momentos.M2.quantidade).toBe(0);
  });

  test("resumo agregado não expõe identificadores ou PII", () => {
    const resumo = analisarPesquisaPreferencia(
      [evento("cid_secreto_123", "pedido_1", 0)],
      {
        agoraMs: BASE + DIA,
        janelaInicioMs: BASE,
      }
    );
    const texto = JSON.stringify(resumo);

    expect(texto).not.toContain("cid_secreto_123");
    expect(texto).not.toContain("clienteId");
    expect(texto).not.toContain("telefone");
    expect(texto).not.toContain("endereco");
  });

  test("marca explicitamente a limitação de cobertura histórica", () => {
    const resumo = analisarPesquisaPreferencia(
      [evento("cid_a", "p1", 0)],
      {
        agoraMs: BASE + DIA,
        janelaInicioMs: BASE,
      }
    );

    expect(resumo.cobertura.primeiraCompraObservadaNaoEquivaleAPrimeiraCompraVitalicia).toBe(true);
    expect(resumo.observacoes.join(" ")).toMatch(/histórico analítico disponível/i);
  });
});
