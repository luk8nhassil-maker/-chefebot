import { describe, expect, test } from "vitest";
import { identificadorAnonimoMensagem, partesHorarioLocal, resumirTrafegoWhatsapp } from "./whatsappTrafficPeak";

describe("medição anônima de picos do WhatsApp", () => {
  test("exibe fuso real de São Paulo sem usar hora de UTC", () => {
    const at = Date.parse("2026-10-20T02:17:00.000Z");
    expect(partesHorarioLocal(at)).toEqual({
      dia: "2026-10-19", hora: "23", minuto: "2026-10-19 23:17",
    });
  });

  test("deduplicação usa hash, sem expor telefone nem message ID", () => {
    const id = identificadorAnonimoMensagem("559900000000", "ABC-123");
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(id).not.toContain("ABC-123");
    expect(id).not.toContain("5599");
    expect(id).toBe(identificadorAnonimoMensagem("559900000000", "ABC-123"));
    expect(id).not.toBe(identificadorAnonimoMensagem("559900000001", "ABC-123"));
  });

  test("calcula pico do minuto, hora e total a partir de contadores, não estimativas", () => {
    const now = Date.parse("2026-10-20T03:00:00.000Z");
    const resumo = resumirTrafegoWhatsapp([
      { data: "2026-10-18", hash: { "h:19": 8, "h:20": 4, peakMinute: 3, peakMinuteAt: "2026-10-18 19:04" } },
      { data: "2026-10-19", hash: { "h:19": 12, "h:20": 3, peakMinute: 5, peakMinuteAt: "2026-10-19 19:06" } },
    ], now - 8 * 86_400_000, now);
    expect(resumo.total7d).toBe(27);
    expect(resumo.picoHora).toEqual({ data: "2026-10-19", hora: 19, mensagens: 12 });
    expect(resumo.picoMinuto).toEqual({ quando: "2026-10-19 19:06", mensagens: 5 });
    expect(resumo.coberturaDias).toBe(7);
    expect(resumo.suficienteParaRepresentatividade).toBe(true);
  });

  test("sem histórico não inventa pico, nem dados suficientes", () => {
    const resumo = resumirTrafegoWhatsapp([{ data: "2026-10-19", hash: null }], null, Date.now());
    expect(resumo.total7d).toBe(0);
    expect(resumo.picoHora).toBeNull();
    expect(resumo.picoMinuto).toBeNull();
    expect(resumo.coberturaDias).toBe(0);
    expect(resumo.suficienteParaRepresentatividade).toBe(false);
  });
});
