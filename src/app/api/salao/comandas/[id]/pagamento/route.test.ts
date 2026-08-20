import { beforeEach, describe, expect, it, vi } from "vitest";

const { lerSalaoMock, fecharContaMock } = vi.hoisted(() => ({
  lerSalaoMock: vi.fn(),
  fecharContaMock: vi.fn(),
}));

vi.mock("@/lib/salaoAuth", () => ({ lerSessaoSalao: lerSalaoMock }));
vi.mock("@/lib/salaoConta.server", () => ({ fecharContaSalao: fecharContaMock }));

import { POST } from "./route";

const PARAMS = { params: Promise.resolve({ id: "comanda_1" }) };
const REQUEST_ID = "terminal_salao_1234567890";

function req(body: Record<string, unknown> = {
  requestId: REQUEST_ID,
  totalEsperadoCentavos: 6600,
  pagamento: "Cartão",
}) {
  return {
    json: async () => body,
    cookies: { get: () => undefined },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  lerSalaoMock.mockResolvedValue(null);
  fecharContaMock.mockResolvedValue({
    ok: true,
    estado: { comandaId: "comanda_1", status: "fechada" },
    deduplicado: false,
  });
});

describe("POST /api/salao/comandas/[id]/pagamento", () => {
  it("bloqueia sem sessão do Salão", async () => {
    const res = await POST(req(), PARAMS);
    expect(res.status).toBe(401);
    expect(fecharContaMock).not.toHaveBeenCalled();
  });

  it("usa o mesmo fechamento seguro com responsável do terminal", async () => {
    lerSalaoMock.mockResolvedValue({ tipo: "salao" });

    const res = await POST(req(), PARAMS);
    expect(res.status).toBe(200);
    expect(fecharContaMock).toHaveBeenCalledTimes(1);
    expect(fecharContaMock).toHaveBeenCalledWith({
      comandaId: "comanda_1",
      responsavel: "Terminal do salão",
      requestId: REQUEST_ID,
      totalEsperadoCentavos: 6600,
      pagamento: "Cartão",
      troco: undefined,
      valorPix: undefined,
      valorDinheiro: undefined,
    });
  });

  it("não chega ao motor financeiro com requestId inválido", async () => {
    lerSalaoMock.mockResolvedValue({ tipo: "salao" });

    const res = await POST(req({ requestId: "curto", totalEsperadoCentavos: 6600, pagamento: "Cartão" }), PARAMS);
    expect(res.status).toBe(400);
    expect(fecharContaMock).not.toHaveBeenCalled();
  });

  it("propaga rejeição do fechamento central sem transformar em sucesso", async () => {
    lerSalaoMock.mockResolvedValue({ tipo: "salao" });
    fecharContaMock.mockResolvedValue({ ok: false, status: 409, error: "A conta ainda não pode ser fechada." });

    const res = await POST(req(), PARAMS);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: "A conta ainda não pode ser fechada." });
  });
});
