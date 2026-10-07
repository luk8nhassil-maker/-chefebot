// @vitest-environment jsdom
//
// Testes de RENDERIZAÇÃO da Gamificação V2 na tela do ranking — o que o
// cliente realmente vê na tela (selo, missão, nível), não leitura de
// código-fonte. Complementa FidelidadeRankingScreen.test.ts (regressões
// estruturais herdadas do #445).
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
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

function montar(props: Partial<FidelidadeRankingScreenProps> = {}, manterModal = false) {
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
  if (!manterModal) {
    const dialog = screen.queryByRole("dialog");
    if (dialog) fireEvent.click(within(dialog).getByRole("button", { name: /^Voltar ao ranking$/ }));
    const outros = screen.queryByText("Outras informações do Ranking");
    if (outros) fireEvent.click(outros);
  }
}

describe("FidelidadeRankingScreen — Gamificação V2", () => {
  test("ao abrir o Ranking escolhe uma missão real, sem lista nem ação automática", () => {
    const onNovoPedido = vi.fn();
    montar({
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: { status: "desbloqueada" }, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: false },
      onNovoPedido,
    }, true);
    const dialog = screen.getByRole("dialog", { name: "Caçada ao Pódio liberada!" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText(/2x no Ranking desta temporada/)).toBeTruthy();
    expect(screen.queryByText("Sua próxima jogada")).toBeNull();
    expect(onNovoPedido).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Voltar ao ranking$/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Caçada ao Pódio liberada/ }));
    expect(screen.getByRole("dialog", { name: "Caçada ao Pódio liberada!" })).toBeTruthy();
  });

  test("missão de foto é a ação contextual e concede CTA único", () => {
    const onAdicionarFoto = vi.fn();
    montar({
      gamificacao: {
        statusSocial: null,
        bonusCompeticao: 0,
        missaoSemanal: null,
        missaoIndicacao: null,
        missaoFotoPerfil: { concluida: false, bonus: 5 },
        nivelChef: null,
        movimentoRecente: null,
        coroaAmeacada: false,
      },
      onAdicionarFoto,
    }, true);
    const dialog = screen.getByRole("dialog", { name: "Adicione uma foto e ganhe +5" });
    expect(within(dialog).getByText(/Bônus único no Ranking/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar foto e ganhar +5" }));
    expect(onAdicionarFoto).toHaveBeenCalledTimes(1);
  });

  test("temporada ativa usa nome autorizado e codinome como fallback", () => {
    montar({
      ranking: {
        ...RANKING_BASE,
        participantes: {
          ...RANKING_BASE.participantes,
          lista: [
            { posicao: 1, score: 140, eVoce: false, participaCampanha: true, nomePublico: "Ana Maria", codinomeSecreto: "Chef Fantasma 42" },
            { posicao: 5, score: 100, eVoce: true, participaCampanha: true, codinomeSecreto: "Mestre Brasa 17" },
          ],
        },
      },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Participando" }));
    expect(screen.getByText("Ana Maria")).toBeTruthy();
    expect(screen.queryByText("Chef Fantasma 42")).toBeNull();
    expect(screen.getByText(/Quem autoriza o nome aparece pelo nome/i)).toBeTruthy();
  });

  test("Story do Dia é contextual, não promete ponto antes de outra pessoa abrir", () => {
    const onCompartilharDivulgacao = vi.fn();
    montar({
      gamificacao: {
        statusSocial: null,
        bonusCompeticao: 0,
        missaoSemanal: null,
        missaoIndicacao: null,
        missaoFotoPerfil: null,
        missaoDivulgacao: { concluidaHoje: false, bonus: 3, elegivel: true },
        nivelChef: null,
        movimentoRecente: null,
        coroaAmeacada: false,
      },
      onCompartilharDivulgacao,
    }, true);
    const dialog = screen.getByRole("dialog", { name: "Compartilhe e busque +3" });
    expect(within(dialog).getByText(/Quando outra pessoa abrir hoje/)).toBeTruthy();
    expect(within(dialog).getByText(/Máximo de um bônus por dia/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Compartilhar Story do Dia" }));
    expect(onCompartilharDivulgacao).toHaveBeenCalledTimes(1);
  });

  test("nome completo só é exibido quando a finalidade explícita está concedida", () => {
    const onAlterarPrivacidade = vi.fn();
    montar({
      privacidade: {
        participaCampanha: true,
        regraJogo: { versao: "ranking-jogo-secreto-v1", aceitaRevelacao30d: true, diasRevelacao: 30 },
        finalidades: [{
          finalidade: "ranking_nome_completo",
          texto: "Mostrar meu nome completo no Ranking",
          textoVersao: "ranking-nome-completo-v1",
          disponivel: true,
          motivoIndisponivel: null,
          estado: "revogado",
          atualizadoEm: null,
        }],
      },
      onAlterarPrivacidade,
    });
    fireEvent.click(screen.getByText("Privacidade e participação"));
    const checkbox = screen.getByLabelText(/Mostrar meu nome completo/);
    fireEvent.click(checkbox);
    expect(onAlterarPrivacidade).toHaveBeenCalledWith(
      "ranking_nome_completo",
      "concedido",
      "ranking-nome-completo-v1",
    );
  });

  test("resultado anterior revela perfil por 30 dias e mostra prazo", () => {
    montar({
      resultadoAnterior: {
        temporadaId: "temp_anterior",
        encerradaEm: "2026-10-01T00:00:00.000Z",
        revelacaoAte: "2026-10-31T00:00:00.000Z",
        premioDescricao: null,
        participantesTopo: [{
          posicao: 1,
          score: 150,
          identidade: {
            participaCampanha: true,
            nomePublico: "Ana",
            telefoneMascarado: null,
            fotoPerfilUrl: "/api/cliente/ranking/resultado-foto?temporadaId=temp_anterior&posicao=1",
            codinomeSecreto: "Chef Fantasma 42",
            revelado: true,
          },
        }],
      },
    });
    expect(screen.getByRole("region", { name: "Identidades reveladas da temporada anterior" })).toBeTruthy();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByText("Perfil revelado")).toBeTruthy();
    expect(screen.getByText(/31\/10/)).toBeTruthy();
  });

  test("sem situação acionável abre o Ranking direto, sem modal inventado", () => {
    montar({ gamificacao: null }, true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  test("pedido pendente vem antes da missão e nunca promete crédito", () => {
    montar({
      posPedido: { estado: "pendente" },
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: { status: "desbloqueada" }, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: false },
    }, true);
    const dialog = screen.getByRole("dialog", { name: "Pedido recebido" });
    expect(within(dialog).getByText(/Quando as estrelas forem confirmadas/)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Caçada ao Pódio liberada!" })).toBeNull();
  });

  test("alerta de coroa só vence a missão quando há ameaça confirmada", () => {
    montar({
      ranking: { ...RANKING_BASE, participantes: { ...RANKING_BASE.participantes, alvo: { estado: "liderando", vantagem: 2 } } },
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: { status: "desbloqueada" }, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: true },
    }, true);
    const dialog = screen.getByRole("dialog", { name: "Coroa ameaçada!" });
    expect(within(dialog).getByRole("button", { name: "Ver como subir" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Caçada ao Pódio liberada!" })).toBeNull();
  });

  test("indicação bloqueada não ganha destaque automático", () => {
    montar({
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6, compartilhamentoLiberado: false },
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: { concluida: false }, nivelChef: null, movimentoRecente: null, coroaAmeacada: false },
    }, true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("modal removido por atualização do painel não reaparece sozinho", async () => {
    const base = {
      ranking: RANKING_BASE, temporada: null, indicacao: null, privacidade: null,
      privacidadeCarregando: false, privacidadeSalvando: null, privacidadeErro: "",
      onAlterarPrivacidade: () => undefined, onRevogarTodas: () => undefined,
      onNovoPedido: () => undefined, onClose: () => undefined,
    } satisfies FidelidadeRankingScreenProps;
    const ativa = { statusSocial: null, bonusCompeticao: 0, missaoSemanal: { status: "desbloqueada" as const }, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: false };
    const consumida = { ...ativa, missaoSemanal: { status: "consumida" as const } };
    const { rerender } = render(<FidelidadeRankingScreen {...base} gamificacao={ativa} />);
    expect(screen.getByRole("dialog", { name: "Caçada ao Pódio liberada!" })).toBeTruthy();
    rerender(<FidelidadeRankingScreen {...base} gamificacao={consumida} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    rerender(<FidelidadeRankingScreen {...base} gamificacao={ativa} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  test("participante anônimo vê controle de saída sem consentimento de identidade", () => {
    const onRevogarTodas = vi.fn();
    montar({ privacidade: { participaCampanha: true, finalidades: [] }, onRevogarTodas });
    fireEvent.click(screen.getByText("Privacidade e participação"));
    expect(screen.getByText(/Você pode escolher aparecer pelo nome durante a temporada/)).toBeTruthy();
    fireEvent.click(screen.getByText("Sair do Ranking e remover autorizações"));
    expect(onRevogarTodas).toHaveBeenCalledTimes(1);
  });
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

  test("conquista usa convite amigável, não botão genérico de compartilhar", () => {
    montar({
      ranking: {
        ...RANKING_BASE,
        participantes: {
          ...RANKING_BASE.participantes,
          variacaoPosicao: { direcao: "subiu", casas: 1 },
        },
      },
      onCompartilharConquista: () => undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: /Sua posição merece destaque/ }));
    expect(screen.getByRole("dialog", { name: "Sua posição merece destaque" })).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByText("CONQUISTA RECENTE")).toBeTruthy();
    expect(screen.getByText("Você pode convidar alguém conhecido para conhecer o ChefeBot e fortalecer sua posição.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fortalecer minha posição" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).toBeNull();
  });

  test("primeiro pedido libera os convites e mantém a tela clara", () => {
    montar({
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6, compartilhamentoLiberado: false },
      ranking: {
        ...RANKING_BASE,
        participantes: {
          ...RANKING_BASE.participantes,
          variacaoPosicao: { direcao: "subiu", casas: 1 },
        },
      },
      onCompartilharConquista: () => undefined,
      onNovoPedido: () => undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: /Sua posição merece destaque/ }));
    expect(screen.getByText(/Convites bloqueados/)).toBeTruthy();
    expect(screen.getByText(/Faça seu primeiro pedido confirmado para liberar o compartilhamento/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fortalecer minha posição" })).toBeNull();
  });

  test("modal de conquista cobre o ranking, fecha com Escape e devolve o foco", () => {
    montar({
      ranking: { ...RANKING_BASE, participantes: { ...RANKING_BASE.participantes, variacaoPosicao: { direcao: "subiu", casas: 1 } } },
      onCompartilharConquista: () => undefined,
    });
    const gatilho = screen.getByRole("button", { name: /Sua posição merece destaque/ });
    gatilho.focus();
    fireEvent.click(gatilho);
    expect(screen.getByRole("dialog", { name: "Sua posição merece destaque" }).getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("main", { name: "Pódio Chefe", hidden: true }).hasAttribute("inert")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(gatilho);
    expect(document.body.style.overflow).toBe("");
  });

  test("convite bloqueado não dispara compartilhamento pelo modal", () => {
    const onCompartilharConquista = vi.fn();
    montar({
      indicacao: { ativa: true, estrelasPrimeiraCompra: 6, compartilhamentoLiberado: false },
      ranking: { ...RANKING_BASE, participantes: { ...RANKING_BASE.participantes, variacaoPosicao: { direcao: "subiu", casas: 1 } } },
      onCompartilharConquista,
    });
    fireEvent.click(screen.getByRole("button", { name: /Sua posição merece destaque/ }));
    expect(screen.queryByRole("button", { name: "Fortalecer minha posição" })).toBeNull();
    expect(onCompartilharConquista).not.toHaveBeenCalled();
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
    screen.getByText("Como subir").click();
    expect(await screen.findByText("✓ Missão da temporada já concluída.")).toBeTruthy();
  });

  test("sem missão de indicação concluída, mostra o texto normal de estrelas", async () => {
    montar({
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: { concluida: false }, nivelChef: null, movimentoRecente: null, coroaAmeacada: false },
      onNovoPedido: () => undefined,
    });
    screen.getByText("Como subir").click();
    expect(await screen.findByText(/Estrelas na primeira compra dele/)).toBeTruthy();
  });

  test("missão de indicação incompleta aparece como card VISÍVEL, sem precisar abrir o sheet 'Quero subir'", () => {
    montar({
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: { concluida: false }, nivelChef: null, movimentoRecente: null, coroaAmeacada: false },
    });
    expect(screen.getByText("MISSÃO DA TEMPORADA")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Indique 1 amigo/ }));
    expect(screen.getByText("Indique 1 amigo — 0/1")).toBeTruthy();
  });

  test("missão de indicação concluída no card visível mostra 1/1 concluída", () => {
    montar({
      gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: { concluida: true }, nivelChef: null, movimentoRecente: null, coroaAmeacada: false },
    });
    fireEvent.click(screen.getByRole("button", { name: /Indique 1 amigo/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /Caçada ao Pódio liberada!/ }));
    expect(screen.getByText("Seu próximo pedido vale 2x no Ranking desta temporada.")).toBeTruthy();
    expect(screen.getByText(/Suas Estrelas normais da Fidelidade continuam as mesmas/)).toBeTruthy();
  });

  test("nível de chef mostra XP atual, XP do próximo nível e barra de progresso proporcional", () => {
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: { nivel: 2, nome: "Cozinheiro", xpAtual: 50, xpProximoNivel: 100 }, movimentoRecente: null, coroaAmeacada: false } });
    fireEvent.click(screen.getByRole("button", { name: /Nível 2 — Cozinheiro/ }));
    expect(within(screen.getByRole("dialog")).getByText("50 XP / 100 XP")).toBeTruthy();
    const barra = within(screen.getByRole("dialog")).getByRole("progressbar");
    expect(barra.getAttribute("aria-valuenow")).toBe("50");
  });

  test("nível máximo (sem próximo nível) mostra barra cheia e nunca pede XP restante inventado", () => {
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 0, missaoSemanal: null, missaoIndicacao: null, nivelChef: { nivel: 5, nome: "Lenda", xpAtual: 9999, xpProximoNivel: null }, movimentoRecente: null, coroaAmeacada: false } });
    fireEvent.click(screen.getByRole("button", { name: /Nível 5 — Lenda/ }));
    expect(within(screen.getByRole("dialog")).getByText("Nível máximo atingido.")).toBeTruthy();
    const barra = within(screen.getByRole("dialog")).getByRole("progressbar");
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
    expect(screen.getByText("Acompanhe sua posição nesta temporada.")).toBeTruthy();
  });

  test("BLOCKER: com temporada ativa mas SEM prêmio aprovado, ainda não promete presente", () => {
    montar({ temporada: { nome: "Temporada X", diasRestantes: 10, fimEm: null, estado: "ativa", premio: null } });
    expect(screen.queryByText(/ganhe presentes/)).toBeNull();
  });

  test("com prêmio configurado pelo servidor, mostra a descrição sem promessa genérica", () => {
    montar({
      temporada: {
        nome: "Temporada X",
        diasRestantes: 10,
        fimEm: null,
        estado: "ativa",
        premio: { descricao: "1 Pizza Família", quantidadePremiados: 3 },
      },
    });
    expect(screen.getByText("1 Pizza Família")).toBeTruthy();
    expect(screen.queryByText(/ganhe presentes/)).toBeNull();
  });

  test("pódio aparece primeiro e informações pessoais ficam em Minha posição", () => {
    montar({ onNovoPedido: () => undefined });
    const podio = screen.getByRole("region", { name: "Melhores posições" });
    const status = screen.getByRole("region", { name: "Seu status atual" });
    expect(podio.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status.textContent).toContain("SUA POSIÇÃO#5");
    expect(status.textContent).toContain("100 pontos no Ranking");
    expect(screen.getByText("Como subir")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Minha posição" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("region", { name: "Lista de posições" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Participando" }));
    expect(screen.queryByRole("region", { name: "Seu status atual" })).toBeNull();
    expect(screen.getByRole("region", { name: "Lista de posições" })).toBeTruthy();
    expect(screen.queryByText("Privacidade e participação")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Minha posição" }));
    expect(screen.getByText("Privacidade e participação")).toBeTruthy();
  });

  test("Minha posição mostra rivais sem repetir a linha Você", () => {
    montar({ ranking: { ...RANKING_BASE, participantes: {
      ...RANKING_BASE.participantes,
      disputa: {
        acima: { posicao: 4, score: 104, eVoce: false, nomePublico: "Rafael", telefoneMascarado: null },
        voce: { posicao: 5, score: 100, eVoce: true, nomePublico: null, telefoneMascarado: null },
        abaixo: { posicao: 6, score: 90, eVoce: false, nomePublico: "Julia", telefoneMascarado: null },
        sozinho: false,
      },
    } } });
    const vizinhos = screen.getByRole("region", { name: "Pessoas próximas de você" });
    expect(vizinhos.textContent).toContain("Rafael");
    expect(vizinhos.textContent).toContain("Julia");
    expect(vizinhos.textContent).not.toContain("Você");
  });

  test("bônus de competição não é apresentado como Estrelas reais", () => {
    montar({ gamificacao: { statusSocial: null, bonusCompeticao: 6, missaoSemanal: null, missaoIndicacao: null, nivelChef: null, movimentoRecente: null, coroaAmeacada: false } });
    expect(screen.getByText("6 de bônus na competição; suas Estrelas de Fidelidade não mudam.")).toBeTruthy();
  });
});
