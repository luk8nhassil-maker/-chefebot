import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function requestTelemetria(body: unknown) {
  return new NextRequest("http://localhost/api/cliente/telemetria", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { logSpy = vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { logSpy.mockRestore(); });

describe("POST /api/cliente/telemetria — diagnostico temporario sem PII", () => {
  test("evento da allowlist e registrado com versao e motivo", async () => {
    const res = await POST(requestTelemetria({ evt: "bearer_session_ok", ok: true, v: "p3h3" }));
    expect(res.status).toBe(204);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("evt=bearer_session_ok"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("v=p3h3"));
  });

  test("bundle antigo (sem marcador v) fica identificado como v=antigo", async () => {
    await POST(requestTelemetria({ evt: "otp_verified" }));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("v=antigo"));
  });

  test("evento fora da allowlist nao registra nada", async () => {
    const res = await POST(requestTelemetria({ evt: "telefone_do_cliente" }));
    expect(res.status).toBe(204);
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("qualquer PII extra no body e ignorada — nunca chega ao log", async () => {
    await POST(requestTelemetria({
      evt: "profile_loaded",
      telefone: "5599974000691",
      codigo: "123456",
      sessao: "a".repeat(32),
      nome: "Maria",
      motivo: "5599974000691",
      v: "5599974000691",
    }));
    const texto = logSpy.mock.calls.map((c) => c.join(" ")).join(" | ");
    expect(texto).toContain("evt=profile_loaded");
    expect(texto).not.toContain("5599974000691");
    expect(texto).not.toContain("123456");
    expect(texto).not.toContain("Maria");
    expect(texto).not.toContain("a".repeat(32));
  });

  test("trace valido e registrado; trace com PII e descartado (vira '-')", async () => {
    await POST(requestTelemetria({ evt: "otp_verified", trace: "P3-XY12AB", status: 401 }));
    const texto = logSpy.mock.calls.map((c) => c.join(" ")).join(" | ");
    expect(texto).toContain("trace=P3-XY12AB");
    expect(texto).toContain("status=401");
    logSpy.mockClear();
    await POST(requestTelemetria({ evt: "otp_verified", trace: "5599974000691" }));
    const texto2 = logSpy.mock.calls.map((c) => c.join(" ")).join(" | ");
    expect(texto2).toContain("trace=-");
    expect(texto2).not.toContain("5599974000691");
  });

  test("body invalido responde 204 sem lancar", async () => {
    const res = await POST(new NextRequest("http://localhost/api/cliente/telemetria", { method: "POST", body: "nao-e-json" }));
    expect(res.status).toBe(204);
  });
});
