import { vi, describe, test, expect, beforeEach } from "vitest";

// Etapa 2A: entradas do cliente que hoje desviam para caminhos especiais
// (imagem, PDF, comprovante Pix em texto, áudio) e retornam ANTES de chegar
// ao registro genérico de texto — deixando essas mensagens completamente
// ausentes do histórico permanente (conversa_full). Esta suíte dirige o
// handler POST completo (mesmo padrão de pixMercadoPagoDinamico.test.ts),
// mockando Redis/Evolution/transcrição, e verifica que cada tipo de entrada
// passa a gerar exatamente uma representação segura como autor "cliente",
// sempre antes de qualquer resposta do bot, sem base64/payload bruto.

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    keys: vi.fn(async () => []),
  };
  return { store, redisMock };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock }));

const { registrarMensagemMock } = vi.hoisted(() => ({
  registrarMensagemMock: vi.fn(async () => {}),
}));
vi.mock("@/lib/conversa", () => ({
  registrarMensagem: registrarMensagemMock,
  ultimasMensagensRelevantes: vi.fn(async () => []),
}));

const { transcreverAudioMock } = vi.hoisted(() => ({
  transcreverAudioMock: vi.fn(),
}));
vi.mock("@/lib/transcribeAudio", () => ({
  transcreverAudio: transcreverAudioMock,
}));

import { POST, montarMarcadorImagem, montarMarcadorDocumento } from "./route";

const PHONE = "5586999990001";

function webhookBody(overrides: Record<string, unknown>) {
  return {
    event: "messages.upsert",
    data: {
      key: { remoteJid: `${PHONE}@s.whatsapp.net`, id: `id-${Math.random()}`, fromMe: false },
      ...overrides,
    },
  };
}

function req(body: unknown) {
  return { json: async () => body } as never;
}

// Todas as chamadas de registrarMensagem feitas no request, na ordem real.
function chamadas() {
  return registrarMensagemMock.mock.calls as [string, string, string][];
}

function indiceDoAutor(autor: string): number {
  return chamadas().findIndex(([, a]) => a === autor);
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.stubEnv("EVOLUTION_API_URL", "https://evolution.exemplo.com");
  vi.stubEnv("EVOLUTION_API_KEY", "chave-teste");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}), text: async () => "" }));
});

describe("1. Imagem sem legenda", () => {
  test("registra '[Imagem recebida]' uma vez e continua o processamento atual", async () => {
    const res = await POST(req(webhookBody({ message: { imageMessage: {} } })));
    expect(res.status ?? 200).toBe(200);
    const clienteCalls = chamadas().filter(([, autor]) => autor === "cliente");
    expect(clienteCalls).toHaveLength(1);
    expect(clienteCalls[0][2]).toBe("[Imagem recebida]");
    // processarComprovante() continuou (sem pedido pendente) e enviou a
    // mensagem de encaminhamento — prova que o fluxo atual não foi pulado.
    const botCalls = chamadas().filter(([, autor]) => autor === "bot");
    expect(botCalls.length).toBeGreaterThan(0);
  });
});

describe("2. Imagem com legenda", () => {
  test("registra marcador com a legenda, sem payload bruto", async () => {
    await POST(req(webhookBody({ message: { imageMessage: { caption: "Aqui está meu comprovante" } } })));
    const clienteCalls = chamadas().filter(([, autor]) => autor === "cliente");
    expect(clienteCalls).toHaveLength(1);
    expect(clienteCalls[0][2]).toBe("[Imagem recebida] Aqui está meu comprovante");
    expect(clienteCalls[0][2]).not.toContain("base64");
    expect(clienteCalls[0][2].length).toBeLessThan(200);
  });
});

describe("3. PDF sem nome ou legenda", () => {
  test("registra '[Documento PDF recebido]'", async () => {
    await POST(req(webhookBody({ message: { documentMessage: { mimetype: "application/pdf" } } })));
    const clienteCalls = chamadas().filter(([, autor]) => autor === "cliente");
    expect(clienteCalls).toHaveLength(1);
    expect(clienteCalls[0][2]).toBe("[Documento PDF recebido]");
  });
});

describe("4. PDF com filename e legenda", () => {
  test("registra representação legível, higieniza filename com caracteres de controle, sem base64/URL", async () => {
    await POST(req(webhookBody({
      message: {
        documentMessage: {
          mimetype: "application/pdf",
          fileName: "comprovante\n.pdf",
          caption: "Segue o pix",
        },
      },
    })));
    const clienteCalls = chamadas().filter(([, autor]) => autor === "cliente");
    expect(clienteCalls).toHaveLength(1);
    expect(clienteCalls[0][2]).toBe("[Documento recebido: comprovante.pdf] Segue o pix");
    expect(clienteCalls[0][2]).not.toContain("\n");
    expect(clienteCalls[0][2]).not.toMatch(/https?:\/\//);
  });
});

describe("5. Comprovante Pix textual", () => {
  test("registra o texto exatamente uma vez, antes do processamento Pix, sem alterar o fluxo mockado", async () => {
    const texto = "Comprovante de pagamento Pix realizado com sucesso, valor R$ 50,00 nome Fulano de Tal";
    await POST(req(webhookBody({ message: { conversation: texto } })));
    const clienteCalls = chamadas().filter(([, autor]) => autor === "cliente");
    expect(clienteCalls).toHaveLength(1);
    expect(clienteCalls[0][2]).toBe(texto);
    // A ordem real de invocação (índice no array de chamadas) prova que o
    // registro do cliente aconteceu antes de qualquer registro de "bot".
    const idxCliente = indiceDoAutor("cliente");
    const idxBot = indiceDoAutor("bot");
    expect(idxBot).toBeGreaterThan(idxCliente);
  });
});

describe("6. Áudio transcrito", () => {
  test("registra exatamente uma mensagem de cliente com a transcrição e mantém o processamento", async () => {
    store.set(`session:${PHONE}`, { step: "done", cart: [], deliveryFee: 0 });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ base64: "AUDIODATA==", mimetype: "audio/ogg" }),
    } as Response);
    transcreverAudioMock.mockResolvedValue("quero uma pizza de calabresa");

    await POST(req(webhookBody({ message: { audioMessage: {} } })));

    const clienteCalls = chamadas().filter(([, autor]) => autor === "cliente");
    expect(clienteCalls).toHaveLength(1);
    expect(clienteCalls[0][2]).toBe("[Áudio transcrito] quero uma pizza de calabresa");
    expect(clienteCalls[0][2]).not.toContain("AUDIODATA");

    // O eco da transcrição (resposta do bot) deve ter sido registrado DEPOIS.
    const idxCliente = indiceDoAutor("cliente");
    const idxBot = indiceDoAutor("bot");
    expect(idxBot).toBeGreaterThan(idxCliente);
  });
});

describe("7. Áudio sem transcrição (falha na transcrição)", () => {
  test("registra exatamente um marcador de indisponibilidade e mantém o escalonamento", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ base64: "AUDIODATA==", mimetype: "audio/ogg" }),
    } as Response);
    transcreverAudioMock.mockResolvedValue(null);

    await POST(req(webhookBody({ message: { audioMessage: {} } })));

    const clienteCalls = chamadas().filter(([, autor]) => autor === "cliente");
    expect(clienteCalls).toHaveLength(1);
    expect(clienteCalls[0][2]).toBe("[Áudio recebido — transcrição indisponível]");
    // Escalonamento continua acontecendo (pedido "novo" com escalonado=true).
    const pedidos = (store.get("pedidos") as Array<{ escalonado?: boolean }>) || [];
    expect(pedidos.some(p => p.escalonado === true)).toBe(true);
    expect(store.get(`postOrderPriority:${PHONE}`)).toBe(true);
  });
});

describe("8. Falha no download do áudio", () => {
  test("registra o marcador indisponível e não perde a mensagem", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}), text: async () => "erro" } as Response);

    await POST(req(webhookBody({ message: { audioMessage: {} } })));

    const clienteCalls = chamadas().filter(([, autor]) => autor === "cliente");
    expect(clienteCalls).toHaveLength(1);
    expect(clienteCalls[0][2]).toBe("[Áudio recebido — transcrição indisponível]");
  });

  test("exceção na chamada de download também cai no marcador indisponível, sem duplicar", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    await POST(req(webhookBody({ message: { audioMessage: {} } })));
    const clienteCalls = chamadas().filter(([, autor]) => autor === "cliente");
    expect(clienteCalls).toHaveLength(1);
    expect(clienteCalls[0][2]).toBe("[Áudio recebido — transcrição indisponível]");
  });
});

describe("9. Texto normal (regressão)", () => {
  test("continua sendo registrado exatamente uma vez, sem marcador", async () => {
    await POST(req(webhookBody({ message: { conversation: "Oi, quero uma pizza" } })));
    const clienteCalls = chamadas().filter(([, autor]) => autor === "cliente");
    expect(clienteCalls).toHaveLength(1);
    expect(clienteCalls[0][2]).toBe("Oi, quero uma pizza");
  });
});

describe("10. Ordem: entrada do cliente sempre antes da primeira resposta do bot", () => {
  test("imagem, comprovante texto e áudio transcrito — cliente sempre precede bot na mesma requisição", async () => {
    // Imagem
    await POST(req(webhookBody({ message: { imageMessage: {} } })));
    expect(indiceDoAutor("bot")).toBeGreaterThan(indiceDoAutor("cliente"));
    registrarMensagemMock.mockClear();

    // Comprovante texto
    const texto = "Comprovante Pix confirmado, valor R$ 30,00 nome Ciclano";
    await POST(req(webhookBody({ message: { conversation: texto } })));
    expect(indiceDoAutor("bot")).toBeGreaterThan(indiceDoAutor("cliente"));
    registrarMensagemMock.mockClear();

    // Áudio transcrito
    store.set(`session:${PHONE}`, { step: "done", cart: [], deliveryFee: 0 });
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ base64: "X", mimetype: "audio/ogg" }) } as Response);
    transcreverAudioMock.mockResolvedValue("oi");
    await POST(req(webhookBody({ message: { audioMessage: {} } })));
    expect(indiceDoAutor("bot")).toBeGreaterThan(indiceDoAutor("cliente"));
  });
});

describe("11. Segurança — nenhum dado técnico no histórico", () => {
  test("nenhuma chamada de registrarMensagem contém base64, payload bruto, URL temporária ou chave Pix", async () => {
    store.set(`session:${PHONE}`, { step: "done", cart: [], deliveryFee: 0 });
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ base64: "SEGREDO_BASE64==", mimetype: "audio/ogg" }) } as Response);
    transcreverAudioMock.mockResolvedValue("quero pizza");

    await POST(req(webhookBody({ message: { imageMessage: { caption: "oi" } } })));
    await POST(req(webhookBody({
      message: { documentMessage: { mimetype: "application/pdf", fileName: "nota.pdf" } },
    })));
    await POST(req(webhookBody({ message: { audioMessage: {} } })));

    for (const [, , texto] of chamadas()) {
      expect(texto).not.toContain("base64");
      expect(texto).not.toContain("SEGREDO_BASE64");
      // Nenhuma URL técnica/interna (API da Evolution) deve vazar — o link
      // público do cardápio nas respostas normais do bot é esperado e não
      // é o alvo desta checagem.
      expect(texto).not.toContain("evolution.exemplo.com");
      expect(texto).not.toContain("apikey");
    }
  });
});

describe("12. Regressão do PR #212 — mensagens do bot continuam corretas", () => {
  test("uma única resposta do bot é registrada por chamada de enviarMensagem, sem duplicar em enviarRespostas", async () => {
    await POST(req(webhookBody({ message: { conversation: "Oi, quero uma pizza" } })));
    const botCalls = chamadas().filter(([, autor]) => autor === "bot");
    // Cada mensagem de bot só pode aparecer uma vez (sem repetição do mesmo texto).
    const textos = botCalls.map(([, , t]) => t);
    expect(new Set(textos).size).toBe(textos.length);
  });
});

describe("QA local — sequência completa (texto, imagem, Pix texto, áudio, PDF)", () => {
  test("histórico final mantém ordem, sem duplicação, sem dado técnico, e é consumível como MensagemRelevante[]", async () => {
    // 1. texto do cliente
    await POST(req(webhookBody({ message: { conversation: "Oi, quero uma pizza de calabresa" } })));
    // (2 é a resposta do bot, já coberta pelas chamadas "bot" registradas acima)

    // 3. imagem com legenda
    await POST(req(webhookBody({ message: { imageMessage: { caption: "Aqui está meu comprovante" } } })));
    // (4 é a resposta do bot)

    // 5. comprovante Pix textual
    const textoPix = "Comprovante Pix confirmado, valor R$ 45,00 nome Maria da Silva";
    await POST(req(webhookBody({ message: { conversation: textoPix } })));
    // (6 é a resposta do bot)

    // 7. áudio transcrito
    store.set(`session:${PHONE}`, { step: "done", cart: [], deliveryFee: 0 });
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ base64: "SEGREDO==", mimetype: "audio/ogg" }) } as Response);
    transcreverAudioMock.mockResolvedValue("quero também uma coca-cola");
    await POST(req(webhookBody({ message: { audioMessage: {} } })));

    // 8. PDF sem legenda
    await POST(req(webhookBody({ message: { documentMessage: { mimetype: "application/pdf", fileName: "recibo.pdf" } } })));

    const historico = chamadas().map(([, autor, texto]) => ({ autor, texto }));

    // Contém todas as entradas esperadas do cliente, na ordem em que ocorreram.
    const entradasCliente = historico.filter(m => m.autor === "cliente").map(m => m.texto);
    expect(entradasCliente).toEqual([
      "Oi, quero uma pizza de calabresa",
      "[Imagem recebida] Aqui está meu comprovante",
      textoPix,
      "[Áudio transcrito] quero também uma coca-cola",
      "[Documento recebido: recibo.pdf]",
    ]);

    // Diferencia cliente e bot: as duas entradas de cliente que efetivamente
    // geraram resposta do bot neste cenário (texto e imagem) têm o bot
    // registrado depois, nunca antes.
    const idxTexto = historico.findIndex(m => m.texto === "Oi, quero uma pizza de calabresa");
    const idxBotAposTexto = historico.findIndex((m, i) => i > idxTexto && m.autor === "bot");
    expect(idxBotAposTexto).toBeGreaterThan(idxTexto);

    const idxImagem = historico.findIndex(m => m.texto.startsWith("[Imagem recebida]"));
    const idxBotAposImagem = historico.findIndex((m, i) => i > idxImagem && m.autor === "bot");
    expect(idxBotAposImagem).toBeGreaterThan(idxImagem);

    // Sem duplicação: nenhuma entrada de cliente se repete.
    expect(new Set(entradasCliente).size).toBe(entradasCliente.length);

    // Sem base64/payload técnico em nenhuma entrada (cliente ou bot).
    for (const { texto } of historico) {
      expect(texto).not.toContain("SEGREDO");
      expect(texto).not.toContain("base64");
    }

    // Formato consumível por /api/pedido-combinado (MensagemRelevante[]: autor + texto, sempre string).
    for (const { autor, texto } of historico) {
      expect(["cliente", "bot"]).toContain(autor);
      expect(typeof texto).toBe("string");
      expect(texto.length).toBeGreaterThan(0);
    }
  });
});

describe("13. montarMarcadorImagem/montarMarcadorDocumento — payload inseguro (tipagem, sem any)", () => {
  test("data === null nunca lança e cai no marcador padrão", () => {
    expect(montarMarcadorImagem(null)).toBe("[Imagem recebida]");
    expect(montarMarcadorDocumento(null)).toBe("[Documento PDF recebido]");
  });

  test("data === undefined nunca lança e cai no marcador padrão", () => {
    expect(montarMarcadorImagem(undefined)).toBe("[Imagem recebida]");
    expect(montarMarcadorDocumento(undefined)).toBe("[Documento PDF recebido]");
  });

  test("objeto vazio ({}) nunca lança e cai no marcador padrão", () => {
    expect(montarMarcadorImagem({})).toBe("[Imagem recebida]");
    expect(montarMarcadorDocumento({})).toBe("[Documento PDF recebido]");
  });

  test("sem 'message' nunca lança e cai no marcador padrão", () => {
    expect(montarMarcadorImagem({ key: {} })).toBe("[Imagem recebida]");
    expect(montarMarcadorDocumento({ key: {} })).toBe("[Documento PDF recebido]");
  });

  test("'message' com tipo inesperado (string, número, array) nunca lança", () => {
    expect(montarMarcadorImagem({ message: "texto solto" })).toBe("[Imagem recebida]");
    expect(montarMarcadorImagem({ message: 123 })).toBe("[Imagem recebida]");
    expect(montarMarcadorImagem({ message: [] })).toBe("[Imagem recebida]");
    expect(montarMarcadorDocumento({ message: "texto solto" })).toBe("[Documento PDF recebido]");
  });

  test("caption/fileName com tipo inesperado (número, objeto, array) são ignorados com segurança", () => {
    expect(montarMarcadorImagem({ message: { imageMessage: { caption: 123 } } })).toBe("[Imagem recebida]");
    expect(montarMarcadorImagem({ message: { imageMessage: { caption: {} } } })).toBe("[Imagem recebida]");
    expect(montarMarcadorImagem({ message: { imageMessage: { caption: null } } })).toBe("[Imagem recebida]");
    expect(montarMarcadorDocumento({ message: { documentMessage: { fileName: 42, caption: [] } } })).toBe("[Documento PDF recebido]");
  });

  test("continua funcionando normalmente com payload bem formado", () => {
    expect(montarMarcadorImagem({ message: { imageMessage: { caption: "oi" } } })).toBe("[Imagem recebida] oi");
    expect(montarMarcadorDocumento({ message: { documentMessage: { fileName: "nota.pdf", caption: "segue" } } }))
      .toBe("[Documento recebido: nota.pdf] segue");
  });
});

describe("14. domínio oficial do cardápio no WhatsApp real", () => {
  const DOMINIO_ANTIGO = "chefebot-pjif.vercel.app";

  function configurarPizzariaAberta() {
    store.set("config:pizzaria", {
      nomePizzaria: "Chefe da Pizza",
      horaAbertura: 0,
      horaFechamento: 24,
      chavePix: "",
      nomeTitularPix: "",
      limitePico: 0,
    });
    // Mesmo com origens hostis presentes, o link de navegação humana deve
    // permanecer fail-closed no domínio oficial do cliente.
    vi.stubEnv("VERCEL_URL", "chefebot-preview-123.vercel.app");
    vi.stubEnv("NEXT_PUBLIC_URL", "http://localhost:3000");
  }

  function requestComHostPreview(body: unknown) {
    return {
      url: "https://chefebot-preview-123.vercel.app/api/whatsapp",
      json: async () => body,
    } as never;
  }

  function textosDoBot(): string[] {
    return chamadas().filter(([, autor]) => autor === "bot").map(([, , texto]) => texto);
  }

  function ultimoTextoDoBot(): string {
    const textos = textosDoBot();
    const ultimo = textos.at(-1);
    if (!ultimo) throw new Error("Resposta do bot não registrada");
    return ultimo;
  }

  function extrairLinkOficial(texto: string): { href: string; token: string } {
    const linksCardapio = (texto.match(/https?:\/\/\S+/g) ?? []).filter((link) =>
      link.includes("/cardapio")
    );
    expect(linksCardapio).toHaveLength(1);

    const href = linksCardapio[0];
    const url = new URL(href);
    const tokens = url.searchParams.getAll("t");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatch(/^[a-f0-9]{32}$/);
    return { href, token: tokens[0] };
  }

  function esperarLinkSeguro(texto: string) {
    const link = extrairLinkOficial(texto);
    const url = new URL(link.href);
    expect(url.protocol).toBe("https:");
    expect(url.origin).toBe("https://chefedapizza.com.br");
    expect(url.pathname).toBe("/cardapio");
    expect(url.searchParams.getAll("t")).toEqual([link.token]);
    expect(texto).not.toContain(DOMINIO_ANTIGO);
    expect(texto).not.toContain("chefebot-preview-123.vercel.app");
    expect(texto).not.toContain("localhost");
    expect(texto).not.toContain("chefedapizza.com.br//");
    return link;
  }

  function esperarTodasAsMensagensDoBotSemOrigemTecnica() {
    const textos = textosDoBot();
    expect(textos.length).toBeGreaterThan(0);
    for (const texto of textos) {
      expect(texto).not.toContain(DOMINIO_ANTIGO);
      expect(texto).not.toContain("chefebot-preview-123.vercel.app");
      expect(texto).not.toContain("localhost");
    }
  }

  test("cliente novo envia 'oi' e recebe /cardapio?t= no domínio oficial", async () => {
    configurarPizzariaAberta();

    await POST(requestComHostPreview(webhookBody({ message: { conversation: "oi" } })));

    // Primeiro contato agora chega em duas bolhas: a saudação padrão (com o
    // link do cardápio) e, na sequência, as opções de categoria.
    const textos = textosDoBot();
    const saudacao = textos[0];
    const opcoes = ultimoTextoDoBot();
    esperarLinkSeguro(saudacao);
    esperarTodasAsMensagensDoBotSemOrigemTecnica();
    expect(saudacao).toContain("cardápio digital");
    expect(opcoes).toContain("1. Pizza");
    expect(opcoes).toContain("2. Lanches");
    expect(opcoes).toContain("3. Bebidas");
    expect(opcoes).toContain("4. Sucos e Vitaminas");
  });

  test("cliente recorrente recebe o mesmo token no 'oi' e na opção 2", async () => {
    configurarPizzariaAberta();
    store.set(`cliente:${PHONE}`, {
      nome: "Cliente Teste",
      ultimoPedido: ["Pizza Calabresa G"],
      ultimoTotal: 50,
      totalPedidos: 2,
      ultimaVisita: Date.now() - 60_000,
    });

    await POST(requestComHostPreview(webhookBody({ message: { conversation: "oi" } })));
    const saudacao = ultimoTextoDoBot();
    const primeiroLink = esperarLinkSeguro(saudacao);
    esperarTodasAsMensagensDoBotSemOrigemTecnica();
    expect(saudacao).toContain("1. Pedir o de sempre");
    expect(saudacao).toContain("2. Ver o cardápio");

    registrarMensagemMock.mockClear();
    await POST(requestComHostPreview(webhookBody({ message: { conversation: "2" } })));

    const respostaOpcao2 = ultimoTextoDoBot();
    const segundoLink = esperarLinkSeguro(respostaOpcao2);
    esperarTodasAsMensagensDoBotSemOrigemTecnica();
    expect(segundoLink.token).toBe(primeiroLink.token);
    expect(respostaOpcao2).toContain("1. Pizza");
    expect(respostaOpcao2).toContain("2. Lanches");
    expect(respostaOpcao2).toContain("3. Bebidas");
    expect(respostaOpcao2).toContain("4. Sucos e Vitaminas");
  });
});
