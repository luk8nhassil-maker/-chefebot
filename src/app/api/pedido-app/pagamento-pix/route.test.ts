import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { GET } from "./route";

function getReq(query: string) {
  return {
    nextUrl: new URL(`https://chefebot.test/api/pedido-app/pagamento-pix${query}`),
  } as never;
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("GET /api/pedido-app/pagamento-pix", () => {
  it("token válido + Pix pendente retorna QR/copia-e-cola e dados mínimos", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      numero: 4821,
      statusToken: "token-ok",
      status: "novo",
      total: 89.9,
      pagamento: "Pix",
      pix: { status: "pendente", provider: "mercadopago", qrCode: "000201...emv...6304F2A1", qrCodeBase64: "iVBORw0KG...", providerPaymentId: "mp-123", valorEsperado: 89.9 },
      telefone: "(99) 99999-9999",
      endereco: "Rua Secreta",
      cliente: "Fulano",
    }]);

    const res = await GET(getReq("?token=token-ok"));
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      id: "pedido-1",
      numero: 4821,
      total: 89.9,
      estado: "aguardando",
      pix: { provider: "mercadopago", qrCode: "000201...emv...6304F2A1" },
    });
  });

  it("token inválido não retorna dados do pedido", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      numero: 4821,
      statusToken: "token-ok",
      status: "novo",
      total: 89.9,
      pagamento: "Pix",
      pix: { status: "pendente", provider: "mercadopago", qrCode: "000201..." },
    }]);

    const res = await GET(getReq("?token=token-errado"));
    const body = await json(res);

    expect(res.status).toBe(404);
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("pix");
  });

  it("token ausente retorna 400", async () => {
    const res = await GET(getReq(""));
    expect(res.status).toBe(400);
  });

  it("pedido confirmado não retorna QR nem copia-e-cola", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      numero: 4821,
      statusToken: "token-ok",
      status: "novo",
      total: 89.9,
      pagamento: "Pix",
      pixConfirmado: true,
      pix: { status: "confirmado", provider: "mercadopago", qrCode: "000201...", providerPaymentId: "mp-123" },
    }]);

    const body = await json(await GET(getReq("?token=token-ok")));

    expect(body).toMatchObject({ ok: true, estado: "confirmado" });
    expect(body).not.toHaveProperty("pix");
  });

  it("pedido cancelado não retorna dados Pix", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      numero: 4821,
      statusToken: "token-ok",
      status: "cancelado",
      total: 89.9,
      pagamento: "Pix",
      pix: { status: "pendente", provider: "mercadopago", qrCode: "000201..." },
    }]);

    const body = await json(await GET(getReq("?token=token-ok")));

    expect(body).toMatchObject({ ok: true, estado: "indisponivel" });
    expect(body).not.toHaveProperty("pix");
  });

  it("pedido em revisão não retorna QR (estado em_analise)", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      numero: 4821,
      statusToken: "token-ok",
      status: "novo",
      total: 89.9,
      pagamento: "Pix",
      pix: { status: "em_revisao", provider: "mercadopago", qrCode: "000201..." },
    }]);

    const body = await json(await GET(getReq("?token=token-ok")));

    expect(body).toMatchObject({ ok: true, estado: "em_analise" });
    expect(body).not.toHaveProperty("pix");
  });

  it("pedido sem QR/copia-e-cola disponível vira indisponível mesmo aguardando pix", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      numero: 4821,
      statusToken: "token-ok",
      status: "novo",
      total: 89.9,
      pagamento: "Pix",
      pix: { status: "pendente" },
    }]);

    const body = await json(await GET(getReq("?token=token-ok")));

    expect(body).toMatchObject({ ok: true, estado: "indisponivel" });
    expect(body).not.toHaveProperty("pix");
  });

  it("nunca expõe providerPaymentId, telefone ou endereço", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      numero: 4821,
      statusToken: "token-ok",
      status: "novo",
      total: 89.9,
      pagamento: "Pix",
      pix: { status: "pendente", provider: "mercadopago", qrCode: "000201...", providerPaymentId: "mp-123", qrCodeBase64: "iVBORw0KG..." },
      telefone: "(99) 99999-9999",
      endereco: "Rua Secreta",
      cliente: "Fulano",
    }]);

    const body = await json(await GET(getReq("?token=token-ok")));

    expect(body).not.toHaveProperty("telefone");
    expect(body).not.toHaveProperty("endereco");
    expect(body).not.toHaveProperty("cliente");
    expect((body.pix as Record<string, unknown>)).not.toHaveProperty("providerPaymentId");
    expect((body.pix as Record<string, unknown>)).not.toHaveProperty("qrCodeBase64");
  });

  it("id inexistente/token não encontrado retorna 404 seguro", async () => {
    store.set("pedidos", []);
    const res = await GET(getReq("?token=qualquer"));
    expect(res.status).toBe(404);
  });

  it("[caso 4] Pix integral de R$ 100 retorna valorPix igual ao total", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      numero: 4821,
      statusToken: "token-ok",
      status: "novo",
      total: 100,
      pagamento: "Pix",
      pix: { status: "pendente", provider: "mercadopago", qrCode: "000201...", valorEsperado: 100 },
    }]);

    const body = await json(await GET(getReq("?token=token-ok")));

    expect(body.valorPix).toBe(100);
    expect(body.total).toBe(100);
  });

  it("[caso 5] pedido misto total R$ 100 com Pix R$ 40 retorna valorPix 40 (nunca o total)", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      numero: 4821,
      statusToken: "token-ok",
      status: "novo",
      total: 100,
      pagamento: "Pix (R$ 40,00) + Dinheiro (R$ 60,00)",
      pix: { status: "pendente", provider: "mercadopago", qrCode: "000201...", valorEsperado: 40 },
    }]);

    const body = await json(await GET(getReq("?token=token-ok")));

    expect(body.valorPix).toBe(40);
    expect(body.total).toBe(100);
  });

  it("[caso 8] valorPix vem exclusivamente de pixCliente.valorEsperado, nunca recalculado", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      numero: 4821,
      statusToken: "token-ok",
      status: "novo",
      total: 250.5,
      pagamento: "Pix (R$ 33,33) + Dinheiro (R$ 217,17)",
      pix: { status: "pendente", provider: "manual", valorEsperado: 33.33 },
    }, ]);
    // pedido acima usa provider "manual" sem chavePix configurada — sem
    // config, serializarPixCliente não monta pixCliente; ajusta para ter
    // config válida no mesmo teste via segundo pedido com token distinto.
    store.set("config:pizzaria", { chavePix: "11999999999", nomeTitularPix: "Chefe da Pizza" });

    const body = await json(await GET(getReq("?token=token-ok")));

    expect(body.valorPix).toBe(33.33);
  });

  it("estado diferente de 'aguardando' nunca retorna valorPix", async () => {
    store.set("pedidos", [{
      id: "pedido-1",
      numero: 4821,
      statusToken: "token-ok",
      status: "novo",
      total: 100,
      pagamento: "Pix",
      pixConfirmado: true,
      pix: { status: "confirmado", provider: "mercadopago", qrCode: "000201...", valorEsperado: 100 },
    }]);

    const body = await json(await GET(getReq("?token=token-ok")));

    expect(body).not.toHaveProperty("valorPix");
  });

  it("[caso 11] whatsappPizzaria vem de config:pizzaria normalizado pelo helper existente", async () => {
    store.set("pedidos", [{
      id: "pedido-1", numero: 4821, statusToken: "token-ok", status: "novo", total: 100,
      pagamento: "Pix", pix: { status: "pendente", provider: "mercadopago", qrCode: "000201...", valorEsperado: 100 },
    }]);
    store.set("config:pizzaria", { whatsappPizzaria: "86999999999" });

    const body = await json(await GET(getReq("?token=token-ok")));

    expect(body.whatsappPizzaria).toBe("5586999999999");
  });

  it("whatsappPizzaria aparece mesmo quando o pedido não está mais 'aguardando' (não depende do estado)", async () => {
    store.set("pedidos", [{
      id: "pedido-1", numero: 4821, statusToken: "token-ok", status: "novo", total: 100,
      pagamento: "Pix", pixConfirmado: true,
      pix: { status: "confirmado", provider: "mercadopago", qrCode: "000201...", valorEsperado: 100 },
    }]);
    store.set("config:pizzaria", { whatsappPizzaria: "86999999999" });

    const body = await json(await GET(getReq("?token=token-ok")));

    expect(body.estado).toBe("confirmado");
    expect(body.whatsappPizzaria).toBe("5586999999999");
  });

  it("sem número configurado (ou inválido), whatsappPizzaria não aparece na resposta", async () => {
    store.set("pedidos", [{
      id: "pedido-1", numero: 4821, statusToken: "token-ok", status: "novo", total: 100,
      pagamento: "Pix", pix: { status: "pendente", provider: "mercadopago", qrCode: "000201...", valorEsperado: 100 },
    }]);
    store.set("config:pizzaria", {});

    const body = await json(await GET(getReq("?token=token-ok")));

    expect(body).not.toHaveProperty("whatsappPizzaria");
  });

  it("nunca expõe nenhuma outra configuração de config:pizzaria além do WhatsApp normalizado", async () => {
    store.set("pedidos", [{
      id: "pedido-1", numero: 4821, statusToken: "token-ok", status: "novo", total: 100,
      pagamento: "Pix", pix: { status: "pendente", provider: "mercadopago", qrCode: "000201...", valorEsperado: 100 },
    }]);
    store.set("config:pizzaria", { whatsappPizzaria: "86999999999", chavePix: "chave-secreta-interna", nomeTitularPix: "Titular Secreto" });

    const body = await json(await GET(getReq("?token=token-ok")));

    expect(body).not.toHaveProperty("chavePix");
    expect(body).not.toHaveProperty("nomeTitularPix");
  });
});
