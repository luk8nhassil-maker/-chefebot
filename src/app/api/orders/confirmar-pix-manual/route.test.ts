import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && redisStore.has(key)) return null;
      redisStore.set(key, value);
      return "OK";
    }),
    // Compare-and-delete atômico do lock GLOBAL de "pedidos" (ver
    // src/lib/pedidosConcorrencia.ts) — 1 chave + 1 arg (o token).
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      const [chave] = keys;
      const [tokenEsperado] = args;
      if (redisStore.get(chave) === tokenEsperado) {
        redisStore.delete(chave);
        return 1;
      }
      return 0;
    }),
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => {
      if (token === "token-kellyne") return { username: "kellyne", name: "Kellyne", role: "atendente" };
      if (token === "token-entregador") return { username: "moto", name: "Motoboy", role: "entregador" };
      return null;
    }),
    validateCredentials: vi.fn((username: string, password: string) => {
      if (username === "kellyne" && password === "senha-correta") {
        return { username: "kellyne", name: "Kellyne", role: "atendente" };
      }
      return null;
    }),
  };
});

const registrarAuditoriaPixManualMock = vi.fn(async (entry: Record<string, unknown>) => { void entry; });
vi.mock("@/lib/pixAuditoria", () => ({
  registrarAuditoriaPixManual: (entry: Record<string, unknown>) => registrarAuditoriaPixManualMock(entry),
}));

const enviarTextoWhatsAppMock = vi.fn(async () => ({ ok: true, latenciaMs: 1, tentativas: 1 }));
vi.mock("@/lib/whatsappMensagem", () => ({
  enviarTextoWhatsApp: (...args: unknown[]) => enviarTextoWhatsAppMock(...args),
}));

import { POST } from "./route";
import { redis } from "@/lib/redis";

type PedidoTeste = {
  id: string;
  cliente: string;
  telefone?: string;
  total: number;
  status: string;
  pagamento: string;
  horario: string;
  pixConfirmado?: boolean;
  pix?: {
    txid?: string;
    valorEsperado?: number;
    status?: string;
    confirmadoPor?: string;
    confirmadoEm?: string;
    confirmadoPorUsuario?: string;
    confirmadoPorRole?: string;
  };
};

function seedPedido(overrides: Record<string, unknown> = {}): PedidoTeste {
  const pedido: PedidoTeste = {
    id: "ped_1",
    cliente: "Fulano",
    telefone: "86999998888",
    total: 50,
    status: "novo",
    pagamento: "Pix",
    horario: "12:00",
    pix: { txid: "chefebot_ped_1", valorEsperado: 50, status: "pendente" },
    ...overrides,
  };
  redisStore.set("pedidos", [pedido]);
  return pedido;
}

function req(body: Record<string, unknown>, cookie = "auth-token=token-kellyne") {
  return new NextRequest("http://localhost/api/orders/confirmar-pix-manual", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  redisStore.clear();
  registrarAuditoriaPixManualMock.mockClear();
  enviarTextoWhatsAppMock.mockClear();
  enviarTextoWhatsAppMock.mockResolvedValue({ ok: true, latenciaMs: 1, tentativas: 1 });
  vi.mocked(redis.get).mockClear();
  vi.mocked(redis.set).mockClear();
});

describe("POST /api/orders/confirmar-pix-manual — segurança da confirmação manual de Pix", () => {
  test("1. requisição sem autenticação é recusada", async () => {
    seedPedido();
    const res = await POST(req({ id: "ped_1", senha: "senha-correta" }, ""));
    expect(res.status).toBe(401);
  });

  test("2. role não autorizada (entregador) é recusada", async () => {
    seedPedido();
    const res = await POST(req({ id: "ped_1", senha: "senha-correta" }, "auth-token=token-entregador"));
    expect(res.status).toBe(401);
  });

  test("3. senha incorreta é recusada e pedido continua pendente", async () => {
    seedPedido();
    const res = await POST(req({ id: "ped_1", senha: "senha-errada" }));
    const data = await res.json();
    expect(res.status).toBe(401);
    expect(data.error).toMatch(/Senha incorreta/);
    const pedidos = redisStore.get("pedidos") as PedidoTeste[];
    expect(pedidos[0].pixConfirmado).toBeUndefined();
    expect(pedidos[0].pix!.status).toBe("pendente");
  });

  test("4. senha correta da sessão autenticada permite continuar e confirma o pedido", async () => {
    seedPedido();
    const res = await POST(req({ id: "ped_1", senha: "senha-correta" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.confirmadoPor).toBe("manual");
    const pedidos = redisStore.get("pedidos") as PedidoTeste[];
    expect(pedidos[0].pixConfirmado).toBe(true);
    expect(pedidos[0].pix!.status).toBe("confirmado");
    expect(pedidos[0].pix!.confirmadoPor).toBe("manual");
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledWith(
      "5586999998888",
      "*Fulano*, pagamento confirmado! ✅\n\nRecebemos seu Pix e seu pedido foi liberado para a cozinha. 🍕"
    );
  });

  test("5. valor enviado pelo frontend não é confiado — servidor usa o valor do pedido", async () => {
    seedPedido();
    const res = await POST(req({ id: "ped_1", senha: "senha-correta", valorConfirmado: 999999, total: 1 }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.valorConfirmado).toBe(50);
    const pedidos = redisStore.get("pedidos") as PedidoTeste[];
    expect(pedidos[0].total).toBe(50);
  });

  test("6. pedido inexistente é recusado", async () => {
    seedPedido();
    const res = await POST(req({ id: "nao-existe", senha: "senha-correta" }));
    expect(res.status).toBe(404);
  });

  test("7. pedido cancelado não pode ser confirmado", async () => {
    seedPedido({ status: "cancelado" });
    const res = await POST(req({ id: "ped_1", senha: "senha-correta" }));
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.error).toMatch(/cancelado/);
  });

  test("8. pedido já pago (automático) não é confirmado novamente", async () => {
    seedPedido({ pixConfirmado: true, pix: { valorEsperado: 50, status: "confirmado", confirmadoPor: "webhook", confirmadoEm: "2026-07-14T10:00:00.000Z" } });
    const res = await POST(req({ id: "ped_1", senha: "senha-correta" }));
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.error).toMatch(/já foi confirmado/);
    expect(data.confirmadoPor).toBe("webhook");
  });

  test("9. corrida entre automático e manual não gera duplicidade — confirmação automática vence", async () => {
    const pendente = seedPedido();
    const confirmadoPorWebhook = [{
      ...pendente,
      pixConfirmado: true,
      pix: { valorEsperado: 50, status: "confirmado" as const, confirmadoPor: "webhook" as const, confirmadoEm: "2026-07-14T10:00:00.000Z" },
    }];
    // 1ª leitura (antes da senha): pedido ainda pendente. 2ª leitura — a
    // releitura FRESCA feita dentro do lock global (ver
    // confirmarPixManualAtomico), depois do SET NX de aquisição — mostra
    // que o webhook já confirmou nesse meio-tempo (janela da corrida).
    vi.mocked(redis.get)
      .mockImplementationOnce(async () => [pendente])
      .mockImplementationOnce(async () => confirmadoPorWebhook);
    const res = await POST(req({ id: "ped_1", senha: "senha-correta" }));
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.confirmadoPor).toBe("webhook");
    // Nenhuma escrita da chave "pedidos" ocorre — só o SET NX (adquirir) e o
    // EVAL (liberar) do lock global, best-effort, nunca a mutação em si.
    expect(vi.mocked(redis.set).mock.calls.some(([key]) => key === "pedidos")).toBe(false);
  });

  test("10. confirmação correta registra auditoria com os campos esperados (sem senha)", async () => {
    seedPedido();
    await POST(req({ id: "ped_1", senha: "senha-correta" }));
    expect(registrarAuditoriaPixManualMock).toHaveBeenCalledTimes(1);
    const entry = registrarAuditoriaPixManualMock.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      pedidoId: "ped_1",
      metodo: "manual",
      usuario: "kellyne",
      nome: "Kellyne",
      role: "atendente",
      valorConfirmado: 50,
      origem: "painel_pedidos",
      statusFinal: "confirmado",
    });
    expect(JSON.stringify(entry)).not.toMatch(/senha/i);
  });

  test("11. senha nunca é persistida no pedido nem na auditoria", async () => {
    seedPedido();
    await POST(req({ id: "ped_1", senha: "senha-correta" }));
    const pedidos = redisStore.get("pedidos") as PedidoTeste[];
    expect(JSON.stringify(pedidos)).not.toMatch(/senha-correta/);
    const auditCalls = registrarAuditoriaPixManualMock.mock.calls;
    expect(JSON.stringify(auditCalls)).not.toMatch(/senha-correta/);
  });

  test("12. metadata identifica corretamente a confirmação manual (usuário, nome, role)", async () => {
    seedPedido();
    const res = await POST(req({ id: "ped_1", senha: "senha-correta" }));
    const data = await res.json();
    expect(data.confirmadoPor).toBe("manual");
    expect(data.confirmadoPorNome).toBe("Kellyne");
    const pedidos = redisStore.get("pedidos") as PedidoTeste[];
    expect(pedidos[0].pix!.confirmadoPorUsuario).toBe("kellyne");
    expect(pedidos[0].pix!.confirmadoPorRole).toBe("atendente");
  });

  test("id ou senha ausentes retornam 400 sem tocar o pedido", async () => {
    seedPedido();
    const res = await POST(req({ id: "ped_1" }));
    expect(res.status).toBe(400);
    const pedidos = redisStore.get("pedidos") as PedidoTeste[];
    expect(pedidos[0].pixConfirmado).toBeUndefined();
  });

  test("15. falha no WhatsApp não desfaz a confirmação e retorna aviso operacional", async () => {
    enviarTextoWhatsAppMock.mockResolvedValueOnce({ ok: false, motivo: "http_400", latenciaMs: 1, tentativas: 1 });
    seedPedido();
    const res = await POST(req({ id: "ped_1", senha: "senha-correta" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.avisoOperacional).toMatch(/mensagem ao cliente não foi enviada/i);
    const pedidos = redisStore.get("pedidos") as PedidoTeste[];
    expect(pedidos[0].pixConfirmado).toBe(true);
  });
});

describe("POST /api/orders/confirmar-pix-manual — isolamento do fluxo automático (não altera webhook nem comprovante)", () => {
  test("13. este arquivo não importa nem reimplementa a lógica do webhook Mercado Pago", async () => {
    const fs = await import("node:fs");
    const url = await import("node:url");
    const fonte = fs.readFileSync(url.fileURLToPath(new URL("./route.ts", import.meta.url)), "utf-8");
    expect(fonte).not.toMatch(/from ['"].*mercadoPago/i);
    expect(fonte).not.toMatch(/from ['"].*webhook/i);
  });

  test("14. este arquivo não importa a avaliação de evidência de comprovante (fluxo do WhatsApp continua intacto)", async () => {
    const fs = await import("node:fs");
    const url = await import("node:url");
    const fonte = fs.readFileSync(url.fileURLToPath(new URL("./route.ts", import.meta.url)), "utf-8");
    expect(fonte).not.toContain("pixComprovante");
    expect(fonte).not.toContain("registrarPixEvidencia");
  });
});
