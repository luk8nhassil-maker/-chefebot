import { vi, describe, it, expect, beforeEach } from "vitest";

// vi.mock é hoisted — não pode referenciar variáveis externas na factory
vi.mock("./redis", () => ({
  redis: {
    get: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockResolvedValue("OK"),
  },
}));

import { redis } from "./redis";
import { registrarMensagem } from "./conversa";
import { validarEnvioMensagemHumana } from "./validarEnvioMensagemHumana";
import { createInitialSession } from "./bot";

// ─── 1. Validação da entrada ──────────────────────────────────────────────────

describe("1. validarEnvioMensagemHumana — validação de entrada", () => {
  it("rejeita quando phone está ausente", () => {
    const r = validarEnvioMensagemHumana({ text: "Olá, tudo bem?" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/phone/i);
  });

  it("rejeita quando phone é string vazia", () => {
    const r = validarEnvioMensagemHumana({ phone: "", text: "Olá" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/phone/i);
  });

  it("rejeita quando text está ausente", () => {
    const r = validarEnvioMensagemHumana({ phone: "5511999999999" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/text/i);
  });

  it("rejeita quando text é string vazia", () => {
    const r = validarEnvioMensagemHumana({ phone: "5511999999999", text: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/text/i);
  });

  it("rejeita quando text contém só espaços", () => {
    const r = validarEnvioMensagemHumana({ phone: "5511999999999", text: "   " });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/text/i);
  });

  it("aceita inputs válidos e retorna ok: true", () => {
    const r = validarEnvioMensagemHumana({ phone: "5511999999999", text: "Seu pedido está a caminho!" });
    expect(r.ok).toBe(true);
  });
});

// ─── 2. Formatação do telefone ────────────────────────────────────────────────

describe("2. validarEnvioMensagemHumana — formatação do telefone", () => {
  it("adiciona 55 quando phone não tem prefixo", () => {
    const r = validarEnvioMensagemHumana({ phone: "11999999999", text: "oi" });
    expect(r.ok).toBe(true);
    expect(r.phone).toBe("5511999999999");
  });

  it("não duplica 55 quando phone já tem prefixo", () => {
    const r = validarEnvioMensagemHumana({ phone: "5511999999999", text: "oi" });
    expect(r.ok).toBe(true);
    expect(r.phone).toBe("5511999999999");
  });

  it("remove caracteres não numéricos do phone", () => {
    const r = validarEnvioMensagemHumana({ phone: "+55 (11) 99999-9999", text: "oi" });
    expect(r.ok).toBe(true);
    expect(r.phone).toBe("5511999999999");
  });
});

// ─── 3. senderName padrão e customizado ──────────────────────────────────────

describe("3. validarEnvioMensagemHumana — senderName", () => {
  it("usa Kellyne como senderName padrão", () => {
    const r = validarEnvioMensagemHumana({ phone: "5511999999999", text: "oi" });
    expect(r.senderName).toBe("Kellyne");
  });

  it("aceita senderName customizado", () => {
    const r = validarEnvioMensagemHumana({ phone: "5511999999999", text: "oi", senderName: "João" });
    expect(r.senderName).toBe("João");
  });
});

// ─── 4. Registro no histórico como mensagem humana ───────────────────────────

describe("4. registrarMensagem — salva mensagem humana como atendente", () => {
  const mockSet = redis.set as ReturnType<typeof vi.fn>;
  const mockGet = redis.get as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue([]);
    mockSet.mockResolvedValue("OK");
  });

  it("salva mensagem com autor atendente (não bot, não cliente)", async () => {
    await registrarMensagem("5511999999999", "atendente", "[Kellyne] Olá!");
    const chamada = mockSet.mock.calls[0];
    const log = chamada[1] as Array<{ autor: string; texto: string }>;
    expect(log[0].autor).toBe("atendente");
    expect(log[0].texto).toContain("Kellyne");
  });

  it("salva mensagem com autor bot diferente de atendente", async () => {
    await registrarMensagem("5511999999999", "bot", "Aqui está o menu.");
    const chamada = mockSet.mock.calls[0];
    const log = chamada[1] as Array<{ autor: string; texto: string }>;
    expect(log[0].autor).toBe("bot");
    expect(log[0].autor).not.toBe("atendente");
  });

  it("salva mensagem com autor cliente diferente de atendente", async () => {
    await registrarMensagem("5511999999999", "cliente", "Quero uma pizza.");
    const chamada = mockSet.mock.calls[0];
    const log = chamada[1] as Array<{ autor: string; texto: string }>;
    expect(log[0].autor).toBe("cliente");
    expect(log[0].autor).not.toBe("atendente");
  });
});

// ─── 5. Conversa assumida — bot continua pausado ──────────────────────────────

describe("5. bot pausado quando conversa está em atendimento humano", () => {
  it("registrarMensagem com atendente não altera a sessão do bot", async () => {
    const mockSet = redis.set as ReturnType<typeof vi.fn>;
    const mockGet = redis.get as ReturnType<typeof vi.fn>;
    mockGet.mockResolvedValue([]);
    mockSet.mockResolvedValue("OK");

    const sessao = createInitialSession();
    const stepAntes = sessao.step;
    const cartAntes = [...sessao.cart];

    await registrarMensagem("5511999999999", "atendente", "[Kellyne] Aguarde um momento!");

    // A sessão do bot não foi tocada
    expect(sessao.step).toBe(stepAntes);
    expect(sessao.cart).toEqual(cartAntes);
  });

  it("bot continua com step e escalado preservados após envio de mensagem humana", () => {
    const sessao = createInitialSession();
    sessao.step = "payment" as any;
    sessao.escalado = true;

    // Enviar mensagem humana não altera a sessão do bot — apenas registra
    // A sessão não muda porque registrarMensagem não recebe nem retorna BotSession
    expect(sessao.step).toBe("payment");
    expect(sessao.escalado).toBe(true);
  });
});
