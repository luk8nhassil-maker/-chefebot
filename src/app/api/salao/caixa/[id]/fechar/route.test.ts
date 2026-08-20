import { beforeEach, describe, expect, it, vi } from "vitest";

const { lerAdminMock, lerSalaoMock, fecharContaMock } = vi.hoisted(() => ({
  lerAdminMock: vi.fn(),
  lerSalaoMock: vi.fn(),
  fecharContaMock: vi.fn(),
}));

vi.mock("@/lib/sessaoAdministrativa", () => ({ lerSessaoAdministrativa: lerAdminMock }));
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
  lerAdminMock.mockResolvedValue(null);
  lerSalaoMock.mockResolvedValue(null);
  fecharContaMock.mockResolvedValue({
    ok: true,
    estado: { comandaId: "comanda_1", status: "fechada" },
    deduplicado: false,
  });
});

describe("POST /api/salao/caixa/[id]/fechar", () => {
  it("continua bloqueando sem sessão administrativa nem sessão do Salão", async () => {
    const res = await POST(req(), PARAMS);
    expect(res.status).toBe(401);
    expect(fecharContaMock).not.toHaveBeenCalled();
  });

  it("permite a sessão do Salão registrar pagamento usando o mesmo fechamento seguro", async () => {
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

  it("preserva o fechamento administrativo já existente", async () => {
    lerAdminMock.mockResolvedValue({ role: "atendente", nome: "Caixa 1", username: "caixa" });

    const res = await POST(req(), PARAMS);
    expect(res.status).toBe(200);
    expect(fecharContaMock).toHaveBeenCalledWith(expect.objectContaining({
      comandaId: "comanda_1",
      responsavel: "Caixa 1",
      requestId: REQUEST_ID,
    }));
  });

  it("não chega ao motor de pagamento com requestId inválido", async () => {
    lerSalaoMock.mockResolvedValue({ tipo: "salao" });

    const res = await POST(req({ requestId: "curto", totalEsperadoCentavos: 6600, pagamento: "Cartão" }), PARAMS);
    expect(res.status).toBe(400);
    expect(fecharContaMock).not.toHaveBeenCalled();
  });
});
