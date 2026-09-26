// @vitest-environment jsdom
//
// Testes de RENDERIZAÇÃO da Gamificação V2 na tela do ranking — o que o
// cliente realmente vê na tela (selo, missão, nível), não leitura de
// código-fonte. Complementa FidelidadeRankingScreen.test.ts (regressões
// estruturais herdadas do #445).
import { afterEach, describe, expect, test } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FidelidadeRankingScreen, type FidelidadeRankingScreenProps } from "./FidelidadeRankingScreen";

afterEach(cleanup);

const RANKING_BASE: FidelidadeRankingScreenProps["ranking"] = {
  posicao: 5,
  score: 100,
  participaCampanha: true,
  entorno: [{ posicao: 5, eVoce: true }],
  lista: [{ posicao: 5, score: 100, eVoce: true, participaCampanha: true, nomePublico: "Você" }],
  variacaoPosicao: null,
  participantes: {
    posicao: 5,
    total: 5,
    variacaoPosicao: null,
    lista: [{ posicao: 5, score: 100, eVoce: true, participaCampanha: true }],
    alvo: null,
    disputa: null,
  },
};

function montar(props: Partial<FidelidadeRankingScreenProps> = {}) {
  render(
    <FidelidadeRankingScreen
      ranking={RANKING_BASE}
      temporada={null}
      indicacao={{ ativa: true, estrelasPrimeiraCompra: 6 }}
      privacidade={null}
      privacidadeCarregando={false}
      privacidadeSalvando={null}
      privacidadeErro=""
      onAlterarPrivacidade={() => undefined}
      onRevogarTodas={() => undefined}
      onClose={() => undefined}
      {...props}
    />
  );
}

describe("FidelidadeRankingScreen — Gamificação V2", () => {
  test("sem gamificacao (fail-closed), não mostra nenhum selo nem missão", () => {
    montar({ gamificacao: null });
    expect(screen.queryByText(/Campeão/)).toBeNull();
    expect(screen.queryByText(/Nível/)).toBeNull();
    expect(screen.queryByText(/Caçada ao Pódio/)).toBeNull();
  });

  test("statusSocial null não mostra selo de status, mesmo com nivelChef presente", () => {
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: { nivel: 2, nome: "Cozinheiro", xpAtual: 10, xpProximoNivel: 100 }, movimentoRecente: null, coroaAmeacada: false } });
    expect(screen.queryByText(/Campeão/)).toBeNull();
    expect(screen.getByText(/Nível 2/)).toBeTruthy();
  });

  test("statusSocial campeao mostra o selo Campeão", () => {
    montar({ gamificacao: { statusSocial: "campeao", bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: false } });
    expect(screen.getByText("Campeão")).toBeTruthy();
  });

  test("statusSocial elite mostra o selo Elite Top 10", () => {
    montar({ gamificacao: { statusSocial: "elite", bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: false } });
    expect(screen.getByText("Elite Top 10")).toBeTruthy();
  });

  test("missão semanal desbloqueada mostra o card Caçada ao Pódio", () => {
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: { status: "desbloqueada" }, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: false } });
    expect(screen.getByText("Caçada ao Pódio liberada!")).toBeTruthy();
  });

  test("missão semanal inativa ou consumida nunca mostra o card (nunca falso positivo)", () => {
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: { status: "inativa" }, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: false } });
    expect(screen.queryByText(/Caçada ao Pódio/)).toBeNull();
    cleanup();
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: { status: "consumida" }, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: false } });
    expect(screen.queryByText(/Caçada ao Pódio/)).toBeNull();
  });

  test("nível de chef mostra nível e nome quando presente", () => {
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: { nivel: 3, nome: "Chef", xpAtual: 600, xpProximoNivel: null }, movimentoRecente: null, coroaAmeacada: false } });
    expect(screen.getByText("Nível 3 — Chef")).toBeTruthy();
  });

  test("missão de indicação concluída aparece no sheet 'Quero subir'", async () => {
    montar({
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: { concluida: true }, nivelChef: null, movimentoRecente: null, coroaAmeacada: false },
      onNovoPedido: () => undefined,
    });
    screen.getByText("Quero subir").click();
    expect(await screen.findByText("✓ Missão da temporada já concluída.")).toBeTruthy();
  });

  test("sem missão de indicação concluída, mostra o texto normal de estrelas", async () => {
    montar({
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: { concluida: false }, nivelChef: null, movimentoRecente: null, coroaAmeacada: false },
      onNovoPedido: () => undefined,
    });
    screen.getByText("Quero subir").click();
    expect(await screen.findByText(/Estrelas na primeira compra dele/)).toBeTruthy();
  });

  test("missão de indicação incompleta aparece como card VISÍVEL, sem precisar abrir o sheet 'Quero subir'", () => {
    montar({
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: { concluida: false }, nivelChef: null, movimentoRecente: null, coroaAmeacada: false },
    });
    expect(screen.getByText("MISSÃO DA TEMPORADA")).toBeTruthy();
    expect(screen.getByText("Indique 1 amigo — 0/1")).toBeTruthy();
  });

  test("missão de indicação concluída no card visível mostra 1/1 concluída", () => {
    montar({
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: { concluida: true }, nivelChef: null, movimentoRecente: null, coroaAmeacada: false },
    });
    expect(screen.getByText("Indique 1 amigo — 1/1 ✓ Concluída")).toBeTruthy();
  });

  test("sem missão de indicação ativa (null), nunca mostra o card da temporada", () => {
    montar({
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: false },
    });
    expect(screen.queryByText("MISSÃO DA TEMPORADA")).toBeNull();
  });

  test("copy da missão semanal nunca confunde o bônus do Ranking com Estrelas normais da Fidelidade", () => {
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: { status: "desbloqueada" }, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: false } });
    expect(screen.getByText("Seu próximo pedido vale 2x no Ranking desta temporada.")).toBeTruthy();
    expect(screen.getByText(/Suas Estrelas normais da Fidelidade continuam as mesmas/)).toBeTruthy();
  });

  test("nível de chef mostra XP atual, XP do próximo nível e barra de progresso proporcional", () => {
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: { nivel: 2, nome: "Cozinheiro", xpAtual: 50, xpProximoNivel: 100 }, movimentoRecente: null, coroaAmeacada: false } });
    expect(screen.getByText("50 XP / 100 XP")).toBeTruthy();
    const barra = screen.getByRole("progressbar");
    expect(barra.getAttribute("aria-valuenow")).toBe("50");
  });

  test("nível máximo (sem próximo nível) mostra barra cheia e nunca pede XP restante inventado", () => {
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: { nivel: 5, nome: "Lenda", xpAtual: 9999, xpProximoNivel: null }, movimentoRecente: null, coroaAmeacada: false } });
    expect(screen.getByText("Nível máximo atingido.")).toBeTruthy();
    const barra = screen.getByRole("progressbar");
    expect(barra.getAttribute("aria-valuenow")).toBe("100");
  });

  test("movimento recente sobe: mostra '▲N desde sua última visita', nunca 'desde ontem'", () => {
    montar({
      gamificacao: {
        statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: null,
        movimentoRecente: { variacao: { direcao: "subiu", casas: 2 }, desde: "2026-01-01T00:00:00.000Z" },
        coroaAmeacada: false,
      },
    });
    expect(screen.getByText("▲ 2 desde sua última visita")).toBeTruthy();
    expect(screen.queryByText(/desde ontem/)).toBeNull();
  });

  test("movimento recente 'manteve' não mostra chip (nada a destacar)", () => {
    montar({
      gamificacao: {
        statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: null,
        movimentoRecente: { variacao: { direcao: "manteve", casas: 0 }, desde: "2026-01-01T00:00:00.000Z" },
        coroaAmeacada: false,
      },
    });
    expect(screen.queryByText(/desde sua última visita/)).toBeNull();
  });

  test("líder sem coroaAmeacada configurada mostra framing neutro 'Defenda sua coroa'", () => {
    montar({
      ranking: {
        ...RANKING_BASE,
        participantes: { ...RANKING_BASE.participantes, alvo: { estado: "liderando", vantagem: 6 } },
      },
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: false },
    });
    expect(screen.getByText("Defenda sua coroa")).toBeTruthy();
    expect(screen.queryByText("Coroa ameaçada!")).toBeNull();
  });

  test("líder com coroaAmeacada true (config real do admin) mostra o alerta 'Coroa ameaçada!'", () => {
    montar({
      ranking: {
        ...RANKING_BASE,
        participantes: { ...RANKING_BASE.participantes, alvo: { estado: "liderando", vantagem: 2 } },
      },
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: true },
    });
    expect(screen.getByText("Coroa ameaçada!")).toBeTruthy();
  });

  test("quem não lidera nunca vê a seção 'Defenda sua coroa'", () => {
    montar({
      ranking: {
        ...RANKING_BASE,
        participantes: { ...RANKING_BASE.participantes, alvo: { estado: "alcancar", alvoPosicao: 4, necessario: 3, scoreAlvo: 22 } },
      },
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: false },
    });
    expect(screen.queryByText("Defenda sua coroa")).toBeNull();
    expect(screen.queryByText("Coroa ameaçada!")).toBeNull();
  });

  test("selo social de OUTRO membro do Top 10 aparece no pódio, não só do próprio cliente", () => {
    montar({
      ranking: {
        ...RANKING_BASE,
        participantes: {
          ...RANKING_BASE.participantes,
          lista: [
            { posicao: 1, score: 500, eVoce: false, participaCampanha: true, nomePublico: "Rival", statusSocial: "campeao" },
            { posicao: 5, score: 100, eVoce: true, participaCampanha: true, statusSocial: undefined },
          ],
        },
      },
    });
    expect(screen.getByTitle("Campeão")).toBeTruthy();
  });

  test("BLOCKER: sem temporada/prêmio configurado, o header nunca promete 'ganhe presentes'", () => {
    montar({ temporada: null });
    expect(screen.queryByText(/ganhe presentes/)).toBeNull();
    expect(screen.getByText("Suba com suas Estrelas e avance na temporada.")).toBeTruthy();
  });

  test("BLOCKER: com temporada ativa mas SEM prêmio aprovado, ainda não promete presente", () => {
    montar({ temporada: { nome: "Temporada X", diasRestantes: 10, fimEm: null, estado: "ativa", premio: null } });
    expect(screen.queryByText(/ganhe presentes/)).toBeNull();
  });

  test("com prêmio real aprovado e configurado pelo servidor, mostra a copy de presente", () => {
    montar({
      temporada: {
        nome: "Temporada X",
        diasRestantes: 10,
        fimEm: null,
        estado: "ativa",
        premio: { descricao: "1 Pizza Família", quantidadePremiados: 3 },
      },
    });
    expect(screen.getByText("Suba com suas Estrelas e ganhe presentes.")).toBeTruthy();
  });
});
