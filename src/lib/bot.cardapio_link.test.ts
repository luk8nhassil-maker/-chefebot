import { describe, it, expect } from "vitest";
import {
  processMessage,
  createInitialSession,
  montarSaudacaoRetorno,
  type BotSession,
  type ClienteHistorico,
} from "./bot";

const LINK_CARDAPIO = "https://chefedapizza.com.br/cardapio";
const TEXTO_LINK_OBRIGATORIO =
  "Se preferir ver o cardápio digital, é só acessar:\nhttps://chefedapizza.com.br/cardapio";

function historicoFake(overrides: Partial<ClienteHistorico> = {}): ClienteHistorico {
  return {
    nome: "Ana Silva",
    ultimoPedido: ["Pizza Calabresa G"],
    ultimoTotal: 50,
    totalPedidos: 2,
    ultimaVisita: Date.now() - 1000 * 60 * 60, // 1h atrás
    ...overrides,
  };
}

describe("regra: link do cardápio digital nas mensagens de entrada", () => {
  it("cliente novo (saudação inicial) recebe o link do cardápio, na saudação padrão", () => {
    const sess = createInitialSession(); // step: "welcome"
    const res = processMessage("oi", sess);
    const msg = res.messages.join("\n");
    // A saudação inicial usa a copy padrão (mensagemSaudacaoPadrao em
    // src/lib/bot.ts), não a frase genérica usada nas outras entradas
    // (retorno, reinício de sessão etc.) — mas o link continua obrigatório.
    expect(msg).toContain("cardápio digital");
    expect(msg).toContain(LINK_CARDAPIO);
  });

  it("cliente retornando sem pedido ativo (montarSaudacaoRetorno) recebe o link do cardápio", () => {
    // Cobre tanto o caso "sem sessão ativa + histórico" quanto o caso
    // "sessão em done + saudação (novo pedido recorrente)" — ambos no
    // webhook chamam essa mesma função para montar a mensagem de entrada.
    const historico = historicoFake({ totalPedidos: 1, ultimaVisita: Date.now() - 1000 * 60 * 60 });
    const msg = montarSaudacaoRetorno(historico);
    expect(msg).toContain(TEXTO_LINK_OBRIGATORIO);
  });

  it("cliente retornando com muitos pedidos (>=5) também recebe o link do cardápio", () => {
    const historico = historicoFake({ totalPedidos: 6 });
    const msg = montarSaudacaoRetorno(historico);
    expect(msg).toContain(TEXTO_LINK_OBRIGATORIO);
  });

  it("cliente que sumiu há mais de 20 dias também recebe o link do cardápio", () => {
    const historico = historicoFake({ ultimaVisita: Date.now() - 1000 * 60 * 60 * 24 * 30 });
    const msg = montarSaudacaoRetorno(historico);
    expect(msg).toContain(TEXTO_LINK_OBRIGATORIO);
  });

  it("cliente com sessão 'done' que manda mensagem não reconhecida recebe o link ao reiniciar o atendimento", () => {
    // Este é o fallback de "sessão expirou, vamos começar de novo" — reinício
    // do atendimento, não uma consulta de status de pedido em andamento.
    const sess: BotSession = { step: "done", cart: [], deliveryFee: 0, tentativasInvalidas: 0 };
    const res = processMessage("quero fazer outro pedido", sess);
    const msg = res.messages.join("\n");
    expect(msg).toContain(TEXTO_LINK_OBRIGATORIO);
    expect(res.session.step).toBe("category");
  });

  it("fluxo normal do WhatsApp continua funcionando depois da saudação com link", () => {
    let sess = createInitialSession();
    const saudacao = processMessage("oi", sess);
    expect(saudacao.session.step).toBe("category");
    sess = saudacao.session;

    const pedido = processMessage("pizza calabresa", sess);
    expect(pedido.messages.join("\n").toLowerCase()).not.toContain("erro");
    expect(pedido.session.step).not.toBe("welcome");
  });
});
