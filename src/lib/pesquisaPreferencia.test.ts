import { describe, expect, test } from "vitest";
import type { EventoAnalitico } from "./historicoAnalitico";
import { MOMENTOS_PESQUISA, analisarPesquisaPreferencia } from "./pesquisaPreferencia";

const DIA = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 8, 1, 12, 0, 0);

function evento(
  clienteId: string,
  pedidoId: string,
  dia: number,
  statusAnalitico: EventoAnalitico["statusAnalitico"] = "entregue",
  expedienteId: string = `exp-${dia}`
): EventoAnalitico {
  return {
    pedidoId,
    clienteId,
    tenantId: "default",
    criadoEmMs: BASE + dia * DIA,
    expedienteId,
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
    expect(resumo.cobertura.ocasioesCompraObservadas).toBe(0);
    expect(resumo.cobertura.intervalosEntreOcasioesObservados).toBe(0);
    expect(resumo.cobertura.clientesComHistoricoSuficienteParaQueda).toBe(0);
    expect(resumo.cobertura.clientesSemHistoricoSuficienteParaQueda).toBe(0);
    expect(resumo.calibracao.medianaIntervaloDias).toBeNull();
    expect(resumo.calibracao.p75IntervaloDias).toBeNull();
    expect(resumo.calibracao.p90IntervaloDias).toBeNull();
    expect(resumo.momentos.M1.quantidade).toBe(0);
  });

  test("calibra frequência com quantis de ocasiões observadas, sem corte fixo de dias", () => {
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
    expect(resumo.cobertura.ocasioesCompraObservadas).toBe(6);
    expect(resumo.cobertura.intervalosEntreOcasioesObservados).toBe(4);
    expect(resumo.cobertura.clientesComHistoricoSuficienteParaQueda).toBe(1);
    expect(resumo.cobertura.clientesSemHistoricoSuficienteParaQueda).toBe(1);
    expect(resumo.momentos.M1.quantidade).toBe(2);
    expect(resumo.momentos.M2.quantidade).toBe(2);
    expect(resumo.estadosAtuais.S4).toBe(1);
    expect(resumo.estadosAtuais.S2).toBe(1);
  });

  test("colapsa múltiplos pedidos do mesmo expediente em uma única ocasião", () => {
    const resumo = analisarPesquisaPreferencia(
      [
        evento("cid_a", "p1", 0, "entregue", "exp-1"),
        evento("cid_a", "p2", 0.05, "entregue", "exp-1"),
        evento("cid_a", "p3", 2, "entregue", "exp-2"),
      ],
      {
        agoraMs: BASE + 3 * DIA,
        janelaInicioMs: BASE,
      }
    );

    expect(resumo.cobertura.pedidosValidosObservados).toBe(3);
    expect(resumo.cobertura.ocasioesCompraObservadas).toBe(2);
    expect(resumo.cobertura.intervalosEntreOcasioesObservados).toBe(1);
    expect(resumo.momentos.M2.quantidade).toBe(1);
    expect(resumo.estadosAtuais.S2).toBe(1);
  });

  test("não classifica uma ou duas ocasiões como queda ou inatividade", () => {
    const eventos = [
      // Queda real: histórico 2d, 2d; gap atual 3d.
      evento("cid_queda", "q1", 0),
      evento("cid_queda", "q2", 2),
      evento("cid_queda", "q3", 4),
      // Inatividade real: histórico 1d, 1d; gap atual 5d.
      evento("cid_inativo", "i1", 0),
      evento("cid_inativo", "i2", 1),
      evento("cid_inativo", "i3", 2),
      // Apenas duas ocasiões, mesmo com gap atual alto: histórico insuficiente.
      evento("cid_duas", "d1", 0),
      evento("cid_duas", "d2", 4),
      // Apenas uma ocasião: histórico insuficiente.
      evento("cid_uma", "u1", 0),
    ];

    const resumo = analisarPesquisaPreferencia(eventos, {
      agoraMs: BASE + 7 * DIA,
      janelaInicioMs: BASE,
    });

    // Intervalos históricos: 1,1,2,2,4 => p75=2 e p90=4.
    expect(resumo.calibracao.p75IntervaloDias).toBe(2);
    expect(resumo.calibracao.p90IntervaloDias).toBe(4);
    expect(resumo.estadosAtuais.S5).toBe(1);
    expect(resumo.estadosAtuais.S6).toBe(1);
    expect(resumo.estadosAtuais.S2).toBe(1);
    expect(resumo.estadosAtuais.S1).toBe(1);
    expect(resumo.momentos.M5.quantidade).toBe(1);
    expect(resumo.cobertura.clientesComHistoricoSuficienteParaQueda).toBe(2);
    expect(resumo.cobertura.clientesSemHistoricoSuficienteParaQueda).toBe(2);
    expect(resumo.segmentacaoQueda.minimoOcasioesParaCompararRitmo).toBe(3);
    expect(resumo.segmentacaoQueda.minimoIntervalosHistoricosPorCliente).toBe(2);
  });

  test("exige que M5 supere o ritmo do próprio cliente e o da população", () => {
    const eventos = [
      // Ritmo pessoal lento: 4d,4d. Gap atual 3d não é queda pessoal.
      evento("cid_lento", "l1", 0),
      evento("cid_lento", "l2", 4),
      evento("cid_lento", "l3", 8),
      // Ritmo curto ajuda a formar os quantis da população.
      evento("cid_curto", "c1", 0),
      evento("cid_curto", "c2", 1),
      evento("cid_curto", "c3", 2),
    ];

    const resumo = analisarPesquisaPreferencia(eventos, {
      agoraMs: BASE + 11 * DIA,
      janelaInicioMs: BASE,
    });

    expect(resumo.momentos.M5.quantidade).toBe(0);
    expect(resumo.estadosAtuais.S5).toBe(0);
  });

  test("não marca retorno com apenas duas ocasiões, mesmo após intervalo longo", () => {
    const eventos: EventoAnalitico[] = [];
    for (let i = 0; i < 10; i += 1) {
      eventos.push(evento(`cid_curto_${i}`, `p${i}_1`, 0));
      eventos.push(evento(`cid_curto_${i}`, `p${i}_2`, 1));
    }
    eventos.push(evento("cid_sem_contexto", "ret_1", 0));
    eventos.push(evento("cid_sem_contexto", "ret_2", 10));

    const resumo = analisarPesquisaPreferencia(eventos, {
      agoraMs: BASE + 11 * DIA,
      janelaInicioMs: BASE,
    });

    expect(resumo.calibracao.p90IntervaloDias).toBe(1);
    expect(resumo.momentos.M6.quantidade).toBe(0);
  });

  test("detecta retorno após ausência quando existe ritmo anterior do próprio cliente", () => {
    const eventos: EventoAnalitico[] = [];
    for (let i = 0; i < 10; i += 1) {
      eventos.push(evento(`cid_curto_${i}`, `p${i}_1`, 0));
      eventos.push(evento(`cid_curto_${i}`, `p${i}_2`, 1));
    }
    eventos.push(evento("cid_retorno", "ret_1", 0));
    eventos.push(evento("cid_retorno", "ret_2", 1));
    eventos.push(evento("cid_retorno", "ret_3", 10));

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
    expect(resumo.cobertura.ocasioesCompraObservadas).toBe(1);
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

  test("marca explicitamente as limitações de cobertura histórica e de queda", () => {
    const resumo = analisarPesquisaPreferencia(
      [evento("cid_a", "p1", 0)],
      {
        agoraMs: BASE + DIA,
        janelaInicioMs: BASE,
      }
    );

    expect(resumo.cobertura.primeiraCompraObservadaNaoEquivaleAPrimeiraCompraVitalicia).toBe(true);
    expect(resumo.cobertura.clientesSemHistoricoSuficienteParaQueda).toBe(1);
    expect(resumo.observacoes.join(" ")).toMatch(/histórico analítico disponível/i);
    expect(resumo.observacoes.join(" ")).toMatch(/3 ocasiões/i);
  });
});
