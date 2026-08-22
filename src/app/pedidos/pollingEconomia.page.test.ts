import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/pedidos — economia sem perder responsividade", () => {
  test("usa scheduler sem sobreposição para pedidos, preservando polling em segundo plano para alertas", () => {
    expect(fonte).toContain('import { iniciarPollingVisivel } from "@/lib/pollingVisivel"');
    expect(fonte).toContain("executar: carregarPedidos");
    expect(fonte).toContain("intervaloMs: 3000");
    expect(fonte).toContain("pausarOculto: false");
    expect(fonte).not.toContain("setInterval(carregarPedidos, 3000)");
    expect(fonte).not.toContain("setTimeout(carregarPedidos, 3000)");
  });

  test("sessoes e historico param quando a aba fica oculta e retomam sem mudar os 3s visiveis", () => {
    const usosPausa = fonte.match(/pausarOculto: true/g) ?? [];
    expect(usosPausa.length).toBeGreaterThanOrEqual(2);
    expect(fonte).not.toContain("setInterval(carregarSessoes, 3000)");
    expect(fonte).not.toContain("setInterval(() => carregarHistoricoConversa(sessaoAtiva), 3000)");
  });
});
