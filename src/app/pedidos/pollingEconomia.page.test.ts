import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/pedidos — economia sem perder responsividade", () => {
  test("mantém 3s em segundo plano, mas consulta revisão leve antes do array completo", () => {
    expect(fonte).toContain('import { iniciarPollingVisivel } from "@/lib/pollingVisivel"');
    expect(fonte).toContain('fetch("/api/orders?revisao=true", { cache: "no-store" })');
    expect(fonte).toContain("revisaoAtual !== revisaoPedidosRef.current");
    expect(fonte).toContain("await carregarPedidosCompleto(revisaoAtual)");
    expect(fonte).toContain("executar: carregarPedidos");
    expect(fonte).toContain("intervaloMs: 3000");
    expect(fonte).toContain("pausarOculto: false");
    expect(fonte).not.toContain("setInterval(carregarPedidos, 3000)");
    expect(fonte).not.toContain("setTimeout(carregarPedidos, 3000)");
  });

  test("força carga completa nos vencimentos locais e na virada do expediente", () => {
    expect(fonte).toContain("pedidoPrecisaAtualizacaoTemporal");
    expect(fonte).toContain("ESCALONAMENTO_TTL_MS");
    expect(fonte).toContain("expedientePedidosRef.current !== chaveExpedienteOperacional(agora)");
  });

  test("sessoes e historico param quando a aba fica oculta e retomam sem mudar os 3s visiveis", () => {
    const usosPausa = fonte.match(/pausarOculto: true/g) ?? [];
    expect(usosPausa.length).toBeGreaterThanOrEqual(2);
    expect(fonte).not.toContain("setInterval(carregarSessoes, 3000)");
    expect(fonte).not.toContain("setInterval(() => carregarHistoricoConversa(sessaoAtiva), 3000)");
  });
});
