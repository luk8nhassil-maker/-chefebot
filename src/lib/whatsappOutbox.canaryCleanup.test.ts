import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  zrange: vi.fn(),
  eval: vi.fn(),
}));
vi.mock("./redis", () => ({ redis: mock }));

import { encerrarCanariosExpiradosSemReenvio, encerrarCanarioVinculadoSemReenvio } from "./whatsappOutbox";

const PHONE = "5598999990691";
const TOKEN = "CBTEST-X38F";
const idempotencyKey = `canary:${TOKEN}`;
const text = `Teste técnico do ChefeBot: ${TOKEN}\nResponda exatamente: ${TOKEN}`;

function job(extra: Record<string, unknown> = {}) {
  return {
    id: "job-antigo", kind: "text", phone: PHONE, text, conversationId: "hash-conversa", priority: "critica",
    state: "ambiguous", createdAt: Date.now() - 60 * 60_000,
    idempotencyKey, result: { motivo: "lease_expired_without_provider_confirmation" },
    ...extra,
  };
}

describe("conciliação estritamente limitada ao canário expirado", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.zrange.mockResolvedValue(["job-antigo"]);
    mock.get.mockResolvedValue(job());
    mock.eval.mockResolvedValue(1);
  });

  it("encerra uma única vez por script atômico sem chamar provider", async () => {
    expect(await encerrarCanariosExpiradosSemReenvio(PHONE)).toBe(1);
    expect(mock.eval).toHaveBeenCalledTimes(1);
    const [script, keys, args] = mock.eval.mock.calls[0];
    expect(script).toContain("expired_technical_canary_closed_without_resend");
    expect(script).toContain("job.state ~= 'ambiguous'");
    expect(keys[1]).toBe("whatsapp:outbox:reconciliation");
    expect(args.slice(0, 4)).toEqual(["job-antigo", idempotencyKey, PHONE, text]);
  });

  it.each([
    ["outro número", { phone: "5598999990000" }],
    ["job de cliente", { idempotencyKey: "pedido:42" }],
    ["conteúdo adulterado", { text: "Outro conteúdo" }],
    ["resultado de transporte incerto", { result: { motivo: "timeout" } }],
    ["canário ainda recente", { createdAt: Date.now() }],
    ["já entregue", { state: "delivered" }],
  ])("não encerra %s", async (_name, change) => {
    mock.get.mockResolvedValue(job(change));
    expect(await encerrarCanariosExpiradosSemReenvio(PHONE)).toBe(0);
    expect(mock.eval).not.toHaveBeenCalled();
  });

  it("não alega encerramento se Redis negar a transição", async () => {
    mock.eval.mockResolvedValue(0);
    expect(await encerrarCanariosExpiradosSemReenvio(PHONE)).toBe(0);
  });

  it("não varre nem apaga entradas quando a quarentena está vazia", async () => {
    mock.zrange.mockResolvedValue([]);
    expect(await encerrarCanariosExpiradosSemReenvio(PHONE)).toBe(0);
    expect(mock.get).not.toHaveBeenCalled();
    expect(mock.eval).not.toHaveBeenCalled();
  });
});

describe("canário anterior vinculado por jobId registrado", () => {
  const createdAt = Date.now() - 60 * 60_000;
  const vinculo = { token: TOKEN, outboundOutboxJobId: "job-antigo",
    createdAt, expiresAt: createdAt + 600_000, state: "expired" };

  beforeEach(() => {
    vi.resetAllMocks();
    mock.get.mockResolvedValue(job({ createdAt }));
    mock.eval.mockResolvedValue(1);
  });

  it("reconcilia por vínculo persistido, sem reenviar nem presumir entrega", async () => {
    expect(await encerrarCanarioVinculadoSemReenvio(PHONE, vinculo)).toBe(1);
    expect(mock.eval).toHaveBeenCalledTimes(1);
    const [script, keys, args] = mock.eval.mock.calls[0];
    expect(script).toContain("expired_technical_canary_closed_without_resend");
    expect(script).toContain("job.text ~= ARGV[3] and job.idempotencyKey ~= ARGV[4]");
    expect(keys[1]).toBe("whatsapp:outbox:reconciliation");
    expect(args.slice(0, 4)).toEqual(["job-antigo", PHONE, text, idempotencyKey]);
  });

  it("admite formato de texto legado apenas quando dedupe e vínculo são exatos", async () => {
    mock.get.mockResolvedValue(job({ createdAt, text: "formato legado" }));
    expect(await encerrarCanarioVinculadoSemReenvio(PHONE, vinculo)).toBe(1);
  });

  it.each([
    ["outro telefone", { phone: "5598999990000" }],
    ["job de cliente sem marcador canário", { idempotencyKey: "pedido:42", text: "Mensagem comercial" }],
    ["resultado transportado sem confirmação", { result: { motivo: "timeout" } }],
    ["já entregue", { state: "delivered" }],
    ["job muito distante no tempo", { createdAt: createdAt - 20 * 60_000 }],
    ["id não corresponde ao vínculo", { id: "job-outro" }],
  ])("bloqueia %s", async (_name, change) => {
    mock.get.mockResolvedValue(job({ createdAt, ...change }));
    expect(await encerrarCanarioVinculadoSemReenvio(PHONE, vinculo)).toBe(0);
    expect(mock.eval).not.toHaveBeenCalled();
  });

  it("nega canário sem vínculo ou ainda ativo", async () => {
    expect(await encerrarCanarioVinculadoSemReenvio(PHONE, { ...vinculo, outboundOutboxJobId: undefined })).toBe(0);
    expect(await encerrarCanarioVinculadoSemReenvio(PHONE, { ...vinculo, state: "outbound_sent" })).toBe(0);
    expect(mock.get).not.toHaveBeenCalled();
  });

  it("não declara encerramento quando script Lua rejeita", async () => {
    mock.eval.mockResolvedValue(0);
    expect(await encerrarCanarioVinculadoSemReenvio(PHONE, vinculo)).toBe(0);
  });
});
