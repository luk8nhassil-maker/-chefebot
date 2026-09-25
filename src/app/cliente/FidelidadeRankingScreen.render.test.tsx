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
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: { nivel: 2, nome: "Cozinheiro", xpAtual: 10, xpProximoNivel: 100 } } });
    expect(screen.queryByText(/Campeão/)).toBeNull();
    expect(screen.getByText(/Nível 2/)).toBeTruthy();
  });

  test("statusSocial campeao mostra o selo Campeão", () => {
    montar({ gamificacao: { statusSocial: "campeao", bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: null } });
    expect(screen.getByText("Campeão")).toBeTruthy();
  });

  test("statusSocial elite mostra o selo Elite Top 10", () => {
    montar({ gamificacao: { statusSocial: "elite", bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: null } });
    expect(screen.getByText("Elite Top 10")).toBeTruthy();
  });

  test("missão semanal desbloqueada mostra o card Caçada ao Pódio", () => {
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: { status: "desbloqueada" }, missaoIndicacao: null, nivelChef: null } });
    expect(screen.getByText("Caçada ao Pódio liberada!")).toBeTruthy();
  });

  test("missão semanal inativa ou consumida nunca mostra o card (nunca falso positivo)", () => {
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: { status: "inativa" }, missaoIndicacao: null, nivelChef: null } });
    expect(screen.queryByText(/Caçada ao Pódio/)).toBeNull();
    cleanup();
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: { status: "consumida" }, missaoIndicacao: null, nivelChef: null } });
    expect(screen.queryByText(/Caçada ao Pódio/)).toBeNull();
  });

  test("nível de chef mostra nível e nome quando presente", () => {
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: { nivel: 3, nome: "Chef", xpAtual: 600, xpProximoNivel: null } } });
    expect(screen.getByText("Nível 3 — Chef")).toBeTruthy();
  });

  test("missão de indicação concluída aparece no sheet 'Quero subir'", async () => {
    montar({
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: { concluida: true }, nivelChef: null },
      onNovoPedido: () => undefined,
    });
    screen.getByText("Quero subir").click();
    expect(await screen.findByText("✓ Missão da temporada já concluída.")).toBeTruthy();
  });

  test("sem missão de indicação concluída, mostra o texto normal de estrelas", async () => {
    montar({
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: { concluida: false }, nivelChef: null },
      onNovoPedido: () => undefined,
    });
    screen.getByText("Quero subir").click();
    expect(await screen.findByText(/Estrelas na primeira compra dele/)).toBeTruthy();
  });
});
