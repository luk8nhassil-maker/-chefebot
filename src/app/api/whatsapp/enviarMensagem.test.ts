import { vi, describe, test, expect, beforeEach } from "vitest";

// Regressão: enviarMensagem() (chamada diretamente em ~40 pontos do webhook,
// fora do fluxo estruturado de enviarRespostas()) enviava a mensagem real pelo
// WhatsApp mas nunca registrava nada em conversa_full — o histórico do painel
// só via as mensagens do bot que passavam por enviarRespostas(). Esta suíte
// cobre a centralização: toda mensagem realmente enviada (confirmada pela
// Evolution) passa a ser registrada como "bot" dentro da própria
// enviarMensagem(), e enviarRespostas() não duplica mais o registro.

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    keys: vi.fn(async () => []),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

const { enviarTextoWhatsAppMock } = vi.hoisted(() => ({
  enviarTextoWhatsAppMock: vi.fn(),
}));

vi.mock("@/lib/whatsappMensagem", () => ({
  enviarTextoWhatsApp: enviarTextoWhatsAppMock,
}));

const { registrarMensagemMock } = vi.hoisted(() => ({
  registrarMensagemMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/conversa", () => ({
  registrarMensagem: registrarMensagemMock,
  ultimasMensagensRelevantes: vi.fn(async () => []),
}));

import { enviarMensagem, enviarRespostas } from "./route";

const PHONE = "5586999990001";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  enviarTextoWhatsAppMock.mockResolvedValue({ ok: true });
  registrarMensagemMock.mockResolvedValue(undefined);
});

describe("enviarMensagem — envio confirmado registra exatamente uma mensagem bot", () => {
  test("chama enviarTextoWhatsApp e registra a mensagem como bot", async () => {
    await enviarMensagem(PHONE, "Olá! Como posso ajudar?");
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(1);
    expect(enviarTextoWhatsAppMock.mock.calls[0][0]).toBe(PHONE);
    expect(registrarMensagemMock).toHaveBeenCalledTimes(1);
    expect(registrarMensagemMock).toHaveBeenCalledWith(PHONE, "bot", "Olá! Como posso ajudar?");
  });
});

describe("enviarMensagem — falha da Evolution não registra mensagem falsa", () => {
  test("resultado ok:false (erro HTTP) não chama registrarMensagem", async () => {
    enviarTextoWhatsAppMock.mockResolvedValue({ ok: false, motivo: "http_500" });
    await enviarMensagem(PHONE, "Pagamento confirmado!");
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(1);
    expect(registrarMensagemMock).not.toHaveBeenCalled();
  });

  test("se enviarTextoWhatsApp lançar por algum motivo inesperado, a exceção propaga e não registra", async () => {
    // enviarTextoWhatsApp real não lança mais para falha de rede (agora vira
    // ok:false motivo network_error/timeout, ver whatsappMensagem.test.ts) —
    // este teste cobre o caso defensivo de uma exceção verdadeiramente
    // inesperada vinda do mock, não o caminho normal de falha de rede.
    enviarTextoWhatsAppMock.mockRejectedValue(new Error("erro inesperado"));
    await expect(enviarMensagem(PHONE, "oi")).rejects.toThrow("erro inesperado");
    expect(registrarMensagemMock).not.toHaveBeenCalled();
  });
});

describe("enviarMensagem — provider não configurado não registra mensagem falsa", () => {
  test("resultado provider_not_configured não chama registrarMensagem", async () => {
    enviarTextoWhatsAppMock.mockResolvedValue({ ok: false, motivo: "provider_not_configured" });
    await enviarMensagem(PHONE, "oi");
    expect(registrarMensagemMock).not.toHaveBeenCalled();
  });
});

describe("enviarRespostas — envia e registra duas mensagens, sem duplicar", () => {
  test("duas mensagens: dois envios, exatamente dois registros (não quatro)", async () => {
    await enviarRespostas(PHONE, ["Primeira mensagem", "Segunda mensagem"], {
      nomePizzaria: "Chefe da Pizza",
      horaAbertura: 18,
      horaFechamento: 23,
      chavePix: "",
      nomeTitularPix: "",
      limitePico: 0,
    });
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(2);
    expect(registrarMensagemMock).toHaveBeenCalledTimes(2);
    expect(registrarMensagemMock).toHaveBeenNthCalledWith(1, PHONE, "bot", "Primeira mensagem");
    expect(registrarMensagemMock).toHaveBeenNthCalledWith(2, PHONE, "bot", "Segunda mensagem");
  });

  test("se uma das mensagens falhar no envio, ela não é registrada mas a outra sim", async () => {
    enviarTextoWhatsAppMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, motivo: "http_500" });
    await enviarRespostas(PHONE, ["Enviada com sucesso", "Falhou"], {
      nomePizzaria: "Chefe da Pizza",
      horaAbertura: 18,
      horaFechamento: 23,
      chavePix: "",
      nomeTitularPix: "",
      limitePico: 0,
    });
    expect(registrarMensagemMock).toHaveBeenCalledTimes(1);
    expect(registrarMensagemMock).toHaveBeenCalledWith(PHONE, "bot", "Enviada com sucesso");
  });
});

describe("enviarMensagem — chamada direta (bug real anterior) agora registra", () => {
  test("uma chamada direta de enviarMensagem() (fora de enviarRespostas) passa a aparecer no histórico", async () => {
    // Reproduz o padrão real do webhook: dezenas de call sites chamam
    // enviarMensagem() diretamente (não via enviarRespostas), ex. confirmação
    // de pagamento, mensagens de entregador, despedida etc.
    await enviarMensagem(PHONE, "✅ Entrega confirmada!\n\nTodas as entregas concluídas!");
    expect(registrarMensagemMock).toHaveBeenCalledWith(
      PHONE,
      "bot",
      "✅ Entrega confirmada!\n\nTodas as entregas concluídas!",
    );
  });
});

describe("enviarMensagem — mensagem com link do cardápio registra o texto final (com token)", () => {
  test("registra a versão com ?t=token, não a mensagem original sem token", async () => {
    const original = "Segue nosso cardápio: https://chefebot-pjif.vercel.app/cardapio";
    await enviarMensagem(PHONE, original);

    expect(registrarMensagemMock).toHaveBeenCalledTimes(1);
    const [, , textoRegistrado] = registrarMensagemMock.mock.calls[0];
    expect(textoRegistrado).not.toBe(original);
    expect(textoRegistrado).toMatch(/^Segue nosso cardápio: https:\/\/chefebot-pjif\.vercel\.app\/cardapio\?t=[a-f0-9]{32}$/);
    expect(textoRegistrado).not.toContain("chefedapizza.com.br");

    // O texto enviado pela Evolution e o texto registrado devem ser o MESMO
    // texto final (com token) — nunca a versão anterior à transformação.
    const textoEnviado = enviarTextoWhatsAppMock.mock.calls[0][1];
    expect(textoEnviado).toBe(textoRegistrado);
  });
});

describe("enviarMensagem/enviarRespostas — não duplicação", () => {
  test("enviarRespostas não chama registrarMensagem além do que enviarMensagem já chama internamente", async () => {
    await enviarRespostas(PHONE, ["Única mensagem"], {
      nomePizzaria: "Chefe da Pizza",
      horaAbertura: 18,
      horaFechamento: 23,
      chavePix: "",
      nomeTitularPix: "",
      limitePico: 0,
    });
    // Uma mensagem em enviarRespostas -> exatamente 1 chamada a registrarMensagem,
    // nunca 2 (o antigo bug de duplicação seria enviarMensagem + enviarRespostas
    // registrando cada uma a sua própria vez).
    expect(registrarMensagemMock).toHaveBeenCalledTimes(1);
  });
});
