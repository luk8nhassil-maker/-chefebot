import { beforeEach, describe, expect, test, vi } from "vitest";

const { tokenMock, buscaMock } = vi.hoisted(() => ({
  tokenMock: vi.fn(async (): Promise<string | null> => "token-seguro"),
  buscaMock: vi.fn(),
}));

vi.mock("./mercadoPagoIntegracao", () => ({ resolveActiveMercadoPagoToken: tokenMock }));
vi.mock("./mercadoPagoWebhook", () => ({ buscarPagamentoMercadoPagoDetalhado: buscaMock }));

import { cancelarPagamentoMercadoPagoPendente, consultarEstadoPagamentoMercadoPago } from "./mercadoPagoCancelamento";

beforeEach(() => {
  vi.clearAllMocks();
  tokenMock.mockResolvedValue("token-seguro");
  buscaMock.mockResolvedValue({
    ok: true,
    pagamento: { id: "123", status: "pending", transactionAmount: 50, externalReference: "tx" },
  });
});

describe("Mercado Pago — cancelamento seguro de cobrança pendente", () => {
  test("PUT cancelled encerra a cobrança pendente usando Bearer server-side", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 123, status: "cancelled" }) }));
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await cancelarPagamentoMercadoPagoPendente("123");

    expect(resultado.estado).toBe("cancelado");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.mercadopago.com/v1/payments/123",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ Authorization: "Bearer token-seguro" }),
        body: JSON.stringify({ status: "cancelled" }),
      })
    );
  });

  test("se o pagamento ficou approved, nunca trata como cancelado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    buscaMock.mockResolvedValue({
      ok: true,
      pagamento: { id: "123", status: "approved", transactionAmount: 50, externalReference: "tx" },
    });

    const resultado = await cancelarPagamentoMercadoPagoPendente("123");

    expect(resultado.estado).toBe("pago");
  });

  test("falha no cancelamento + provider ainda pending mantém pedido para retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    const resultado = await cancelarPagamentoMercadoPagoPendente("123");

    expect(resultado.estado).toBe("ainda_pendente");
  });

  test("status rejected/cancelled/refunded é classificado como não cobravel", async () => {
    for (const status of ["rejected", "cancelled", "refunded"]) {
      buscaMock.mockResolvedValueOnce({
        ok: true,
        pagamento: { id: "123", status, transactionAmount: 50, externalReference: "tx" },
      });
      const resultado = await consultarEstadoPagamentoMercadoPago("123");
      expect(resultado.estado).toBe("nao_cobravel");
    }
  });

  test("sem token nunca tenta cancelar às cegas", async () => {
    tokenMock.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await cancelarPagamentoMercadoPagoPendente("123");

    expect(resultado.estado).toBe("inconclusivo");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
