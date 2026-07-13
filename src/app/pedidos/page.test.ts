import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Sem jsdom/testing-library neste repo para telas grandes com efeitos de
// browser (cookies, Notification, wake lock, push) — ver admin/page.test.ts
// e cliente/page.test.ts para o mesmo padrão. Os requisitos da
// auto-verificação de Pix Mercado Pago (Nível 6.3B) ficam garantidos
// estruturalmente na fonte, sem precisar montar a árvore inteira.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/pedidos — botão manual de verificação Pix Mercado Pago (preservado)", () => {
  test("botão manual continua renderizado, visível só para admin/dev, chamando reconciliarPixMercadoPago", () => {
    expect(fonte).toMatch(/\{isAdmin && <button onClick=\{reconciliarPixMercadoPago\}/);
    expect(fonte).toContain("Verificar pagamentos Pix Mercado Pago");
  });

  test("clique manual delega para executarReconciliacaoPix(true) — mesma função interna da auto-verificação", () => {
    expect(fonte).toContain("const reconciliarPixMercadoPago = () => executarReconciliacaoPix(true)");
  });

  test("clique manual continua mostrando o resumo em alert", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    expect(corpo).toMatch(/if \(manual\) alert\(`Pix Mercado Pago verificado:\\n\$\{resumo\}`\)/);
  });
});

describe("/pedidos — auto-verificação de Pix Mercado Pago (Nível 6.3B)", () => {
  test("dispara a mesma rota já validada (POST /api/admin/mercadopago/reconciliar-pix)", () => {
    const ocorrencias = fonte.match(/fetch\("\/api\/admin\/mercadopago\/reconciliar-pix", \{ method: "POST" \}\)/g) ?? [];
    // uma única chamada de fetch compartilhada entre manual e automática
    expect(ocorrencias.length).toBe(1);
  });

  test("useEffect de auto-verificação só roda para admin/dev e depois do painel carregar", () => {
    const inicioEfeito = fonte.indexOf("useEffect(() => {\n    if (!isAdmin || loading) return");
    expect(inicioEfeito).toBeGreaterThan(-1);
  });

  test("chama a verificação automaticamente ao montar (uma vez) e depois a cada 2 minutos", () => {
    const corpo = fonte.slice(
      fonte.indexOf("useEffect(() => {\n    if (!isAdmin || loading) return"),
      fonte.indexOf("}, [isAdmin, loading])") + "}, [isAdmin, loading])".length
    );
    expect(corpo).toContain("rodar()"); // dispara uma vez ao montar
    expect(corpo).toContain("setInterval(rodar, 120000)"); // repete a cada 2 minutos
    expect(corpo).toContain("clearInterval(intervalo)"); // limpa ao desmontar/reavaliar
  });

  test("pausa quando a aba está oculta (document.hidden)", () => {
    const corpo = fonte.slice(
      fonte.indexOf("useEffect(() => {\n    if (!isAdmin || loading) return"),
      fonte.indexOf("}, [isAdmin, loading])") + "}, [isAdmin, loading])".length
    );
    expect(corpo).toContain("if (!document.hidden) executarReconciliacaoPix(false)");
  });

  test("auto-verificação chama executarReconciliacaoPix(false) — nunca (true), nunca dispara alert direto", () => {
    const corpo = fonte.slice(
      fonte.indexOf("useEffect(() => {\n    if (!isAdmin || loading) return"),
      fonte.indexOf("}, [isAdmin, loading])") + "}, [isAdmin, loading])".length
    );
    expect(corpo).toContain("executarReconciliacaoPix(false)");
    expect(corpo).not.toContain("executarReconciliacaoPix(true)");
    expect(corpo).not.toContain("alert(");
  });

  test("alert só é chamado dentro de blocos condicionados a `manual`, nunca incondicionalmente", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    const linhas = corpo.split("\n");
    const indicesComAlert = linhas.reduce<number[]>((acc, l, i) => (l.includes("alert(") ? [...acc, i] : acc), []);
    expect(indicesComAlert.length).toBeGreaterThan(0);
    for (const i of indicesComAlert) {
      // "manual" aparece na própria linha (alert de uma linha) ou na guarda
      // imediatamente acima (if (manual) {\n  alert(...) — várias linhas).
      const janela = linhas.slice(Math.max(0, i - 1), i + 1).join("\n");
      expect(janela).toMatch(/manual/);
    }
  });
});

describe("/pedidos — reentrância e resiliência da verificação de Pix Mercado Pago", () => {
  test("não roda uma verificação se outra já está em andamento (guard por ref, compartilhado manual/automático)", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    expect(corpo).toMatch(/if \(reconciliandoPixRef\.current\) return/);
    expect(corpo).toContain("reconciliandoPixRef.current = true");
    expect(corpo).toContain("reconciliandoPixRef.current = false");
  });

  test("guard usa useRef (não só state), para não ter condição de corrida entre closures do interval", () => {
    expect(fonte).toContain("const reconciliandoPixRef = useRef(false)");
  });

  test("quando confirmados > 0, recarrega a lista de pedidos (carregarPedidos)", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    expect(corpo).toContain('if (typeof data.confirmados === "number" && data.confirmados > 0) carregarPedidos()');
  });

  test("falha de rede ou resposta não-ok nunca lança exceção não tratada (try/catch envolve o fetch)", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    expect(corpo).toMatch(/try \{[\s\S]*fetch\("\/api\/admin\/mercadopago\/reconciliar-pix"[\s\S]*\} catch \{/);
  });

  test("erro de rede na auto-verificação não propaga alert (só quando manual)", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    const blocoCatch = corpo.slice(corpo.lastIndexOf("} catch {"));
    expect(blocoCatch).toContain("if (manual) alert(");
  });
});

describe("/pedidos — segurança: nenhuma confirmação acontece no frontend", () => {
  test("frontend só chama a rota protegida; não escreve pix.status/pixConfirmado diretamente a partir da verificação", () => {
    const corpo = fonte.slice(
      fonte.indexOf("const executarReconciliacaoPix = async"),
      fonte.indexOf("const reconciliarPixMercadoPago =")
    );
    expect(corpo).not.toMatch(/pixConfirmado:\s*true/);
    expect(corpo).not.toMatch(/status:\s*["']confirmado["']/);
  });

  test("não importa/altera src/lib/mercadoPagoReconciliacao.ts nem o serializador/gerador de Pix (patch fica só na tela)", () => {
    expect(fonte).not.toMatch(/from ["']@\/lib\/mercadoPagoReconciliacao["']/);
    expect(fonte).not.toContain("pixCopiaECola");
    expect(fonte).not.toContain("serializarPixCliente");
  });
});
