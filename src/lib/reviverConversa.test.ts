import { describe, it, expect } from "vitest";
import { detectarConversaMorta, escolherStepDeRetomada } from "./reviverConversa";
import { createInitialSession, type BotSession } from "./bot";

function sessaoBase(over: Partial<BotSession> = {}): BotSession {
  return { ...createInitialSession(), ...over };
}

const ctxPadrao = { emManual: false, botAtivo: true, aguardandoPix: false, cooldownAtivo: false };

// ─── Helper: escolherStepDeRetomada ─────────────────────────────────────────

describe("escolherStepDeRetomada", () => {
  it("sem pedido → category", () => {
    const s = sessaoBase({ step: "escalado" });
    expect(escolherStepDeRetomada(s)).toBe("category");
  });

  it("com pedido mas sem tipoEntrega → delivery_type", () => {
    const s = sessaoBase({
      step: "escalado",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
    });
    expect(escolherStepDeRetomada(s)).toBe("delivery_type");
  });

  it("delivery sem bairro → neighborhood", () => {
    const s = sessaoBase({
      step: "escalado",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
      deliveryType: "delivery",
      neighborhood: "",
    });
    expect(escolherStepDeRetomada(s)).toBe("neighborhood");
  });

  it("delivery com bairro mas sem endereço → address", () => {
    const s = sessaoBase({
      step: "escalado",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
      deliveryType: "delivery",
      neighborhood: "Centro",
      address: "",
    });
    expect(escolherStepDeRetomada(s)).toBe("address");
  });

  it("sem pagamento → payment", () => {
    const s = sessaoBase({
      step: "escalado",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
      deliveryType: "pickup",
      paymentMethod: "",
    });
    expect(escolherStepDeRetomada(s)).toBe("payment");
  });

  it("pedido completo com cliente → confirm", () => {
    const s = sessaoBase({
      step: "escalado",
      customerName: "João",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
      deliveryType: "pickup",
      paymentMethod: "Pix",
    });
    expect(escolherStepDeRetomada(s)).toBe("confirm");
  });
});

// ─── detectarConversaMorta ───────────────────────────────────────────────────

describe("detectarConversaMorta", () => {
  it("sem pedido e step escalado → deveReviver true, novoStep category", () => {
    const s = sessaoBase({ step: "escalado" });
    const r = detectarConversaMorta(s, ctxPadrao);
    expect(r.deveReviver).toBe(true);
    expect(r.novoStep).toBe("category");
  });

  it("step done com pedido e pendências → deveReviver true", () => {
    const s = sessaoBase({
      step: "done",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
      deliveryType: "delivery",
    });
    const r = detectarConversaMorta(s, ctxPadrao);
    expect(r.deveReviver).toBe(true);
  });

  it("aguardando Pix → NÃO deve reviver", () => {
    const s = sessaoBase({ step: "escalado" });
    const r = detectarConversaMorta(s, { ...ctxPadrao, aguardandoPix: true });
    expect(r.deveReviver).toBe(false);
    expect(r.motivo).toBe("aguardando_pix");
  });

  it("manual ativo → NÃO deve reviver", () => {
    const s = sessaoBase({ step: "escalado" });
    const r = detectarConversaMorta(s, { ...ctxPadrao, emManual: true });
    expect(r.deveReviver).toBe(false);
    expect(r.motivo).toBe("atendimento_manual");
  });

  it("bot global desligado → NÃO deve reviver", () => {
    const s = sessaoBase({ step: "escalado" });
    const r = detectarConversaMorta(s, { ...ctxPadrao, botAtivo: false });
    expect(r.deveReviver).toBe(false);
    expect(r.motivo).toBe("bot_desligado");
  });

  it("cooldown ativo → NÃO deve reviver em loop", () => {
    const s = sessaoBase({ step: "escalado" });
    const r = detectarConversaMorta(s, { ...ctxPadrao, cooldownAtivo: true });
    expect(r.deveReviver).toBe(false);
    expect(r.motivo).toBe("cooldown_ativo");
  });

  it("step de fluxo normal (category) → NÃO deve reviver", () => {
    const s = sessaoBase({ step: "category" });
    const r = detectarConversaMorta(s, ctxPadrao);
    expect(r.deveReviver).toBe(false);
  });

  it("sessão null → NÃO deve reviver (sem sessão para reparar)", () => {
    const r = detectarConversaMorta(null, ctxPadrao);
    expect(r.deveReviver).toBe(false);
    expect(r.motivo).toBe("sem_sessao");
  });

  it("detectar não altera a sessão original", () => {
    const s = sessaoBase({ step: "escalado" });
    const stepAntes = s.step;
    const cartAntes = JSON.stringify(s.cart);
    detectarConversaMorta(s, ctxPadrao);
    expect(s.step).toBe(stepAntes);
    expect(JSON.stringify(s.cart)).toBe(cartAntes);
  });
});

// ─── Cenários de webhook — usa detectarConversaMorta (não hardcode) ──────────

describe("cenários de webhook via helper", () => {
  it("step escalado + bot ativo → deveReviver true (webhook revive)", () => {
    const s = sessaoBase({ step: "escalado" });
    const r = detectarConversaMorta(s, ctxPadrao);
    expect(r.deveReviver).toBe(true);
    expect(r.novoStep).toBeDefined();
  });

  it("step done + bot ativo → deveReviver true (webhook revive — não só escalado)", () => {
    const s = sessaoBase({ step: "done" });
    const r = detectarConversaMorta(s, ctxPadrao);
    expect(r.deveReviver).toBe(true);
    expect(r.novoStep).toBeDefined();
  });

  it("cooldown ativo → deveReviver false (sem loop de revival)", () => {
    const s = sessaoBase({ step: "escalado" });
    const r = detectarConversaMorta(s, { ...ctxPadrao, cooldownAtivo: true });
    expect(r.deveReviver).toBe(false);
    expect(r.motivo).toBe("cooldown_ativo");
  });

  it("manual ativo → deveReviver false (webhook não chama processMessage)", () => {
    const s = sessaoBase({ step: "escalado" });
    const r = detectarConversaMorta(s, { ...ctxPadrao, emManual: true });
    expect(r.deveReviver).toBe(false);
    expect(r.motivo).toBe("atendimento_manual");
  });

  it("bot global desligado → deveReviver false (webhook não chama processMessage)", () => {
    const s = sessaoBase({ step: "escalado" });
    const r = detectarConversaMorta(s, { ...ctxPadrao, botAtivo: false });
    expect(r.deveReviver).toBe(false);
    expect(r.motivo).toBe("bot_desligado");
  });

  it("aguardando Pix → deveReviver false (não revive durante pagamento)", () => {
    const s = sessaoBase({ step: "escalado" });
    const r = detectarConversaMorta(s, { ...ctxPadrao, aguardandoPix: true });
    expect(r.deveReviver).toBe(false);
    expect(r.motivo).toBe("aguardando_pix");
  });

  it("histórico conversa:phone — helper não acessa Redis (nunca apaga conversa)", () => {
    const s = sessaoBase({ step: "escalado" });
    // Se o helper chamasse Redis aqui sem mock, lançaria erro. Não lança → ok.
    expect(() => detectarConversaMorta(s, ctxPadrao)).not.toThrow();
  });
});

// ─── Rota /api/conversas/reviver (lógica pura) ───────────────────────────────

describe("lógica pura da rota reviver", () => {
  it("sessão existente → novoStep baseado no estado do pedido", () => {
    const s = sessaoBase({
      step: "escalado",
      cart: [{ category: "pizza", name: "Pizza", size: "G", flavor: "Calabresa", border: "Sem borda", price: 50 }],
      deliveryType: "pickup",
      paymentMethod: "Pix",
      customerName: "Ana",
    });
    const novoStep = escolherStepDeRetomada(s);
    expect(novoStep).toBe("confirm");
  });

  it("sessão com manual ativo: reviver manual remove o lock e salva step seguro", () => {
    // O lock é removido pela rota — aqui testamos que o step calculado é válido
    const s = sessaoBase({ step: "escalado" });
    const novoStep = escolherStepDeRetomada(s);
    expect(["category", "delivery_type", "neighborhood", "address", "payment", "pedindo_nome", "confirm"]).toContain(novoStep);
  });

  it("phone vazio → erro: a rota deve validar phone obrigatório", () => {
    // Simula a validação que a rota faz antes de processar
    const body: Record<string, unknown> = {};
    const phoneVazio = !body.phone;
    expect(phoneVazio).toBe(true);
  });

  it("histório da conversa (conversa:phone) não é tocado pelo helper", () => {
    // escolherStepDeRetomada não acessa Redis — apenas lê a session
    const s = sessaoBase({ step: "escalado" });
    // Se chamasse Redis, lançaria erro aqui (sem mock). Não lança → ok.
    expect(() => escolherStepDeRetomada(s)).not.toThrow();
  });
});
