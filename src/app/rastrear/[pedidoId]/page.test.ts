import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mesma abordagem de guarda estrutural usada em src/app/cliente/page.test.ts
// (sem jsdom/testing-library neste repo): confirma que /rastrear/[pedidoId]
// ganhou o menu inferior compartilhado com "Pedido" ativo, sem quebrar
// token/polling/status/Pix/mapa já existentes.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/rastrear/[pedidoId] — menu inferior fixo com Pedido ativo", () => {
  test("renderiza o menu inferior compartilhado, fora de qualquer condicional de carregamento", () => {
    expect(fonte).toContain("import ClientBottomNav from '@/components/ClientBottomNav'");
    expect(fonte).toMatch(/<ClientBottomNav active="pedido"/);
  });

  test("Início do menu abre /pedido (via href padrão do componente, sem override)", () => {
    // Não passamos inicioHref customizado: o padrão do componente compartilhado
    // já é "/pedido", conferido em ClientBottomNav.test.tsx.
    expect(fonte).not.toMatch(/<ClientBottomNav[^>]*inicioHref=/);
  });

  test("Sacola volta para /pedido restaurando o rascunho e sinalizando abrir a sacola", () => {
    expect(fonte).toContain("CF_OPEN_CART_KEY");
    expect(fonte).toMatch(/onSacolaClick=\{abrirSacola\}/);
    expect(fonte).toContain("window.location.href = '/pedido'");
  });

  test("não passa mais pedidoHref — aba Pedido é o link estático /cliente/pedidos do componente", () => {
    expect(fonte).not.toContain("pedidoHref");
  });

  test("clicar em 'Pedido' no menu abre a listagem /cliente/pedidos, nunca recarrega o próprio rastreamento", () => {
    // Sem pedidoHref/override: o link vem do padrão do componente compartilhado
    // (sempre /cliente/pedidos), conferido em ClientBottomNav.test.tsx.
    expect(fonte).not.toMatch(/href=\{`\/rastrear\/\$\{pedidoId\}`\}/);
  });

  test("navegação de 'continuar comprando' usa /pedido, nunca /cardapio", () => {
    expect(fonte).not.toContain("/cardapio");
  });

  test("retorno do cabeçalho é '← Meus pedidos', apontando para /cliente/pedidos", () => {
    expect(fonte).toMatch(/href="\/cliente\/pedidos"[^>]*>[\s\S]{0,40}← Meus pedidos/);
    expect(fonte).not.toContain("← Cardápio");
  });

  test("preserva token/polling/status/Pix/mapa: params, fetchStatus, fetchLocalizacao e intervalo continuam intactos", () => {
    expect(fonte).toContain("params.then(p => setPedidoId(p.pedidoId))");
    expect(fonte).toContain("fetch(`/api/pedido-status?pedidoId=${pedidoId}`");
    expect(fonte).toContain("fetch(`/api/localizacao?pedidoId=${pedidoId}`");
    expect(fonte).toContain("setInterval(talvezAtualizar, 10000)");
    expect(fonte).toContain("MapaEntregador");
  });

  test("usa o hook central usePixPendente e repassa para a barra + indicador do menu", () => {
    expect(fonte).toContain("import PixPendenteBar, { usePixPendente } from '@/components/PixPendenteBar'");
    expect(fonte).toContain("usePixPendente()");
    expect(fonte).toContain("<PixPendenteBar pendente={pixPendente} />");
    expect(fonte).toMatch(/<ClientBottomNav[\s\S]{0,220}pixPendente=\{!!pixPendente\}/);
  });

  test("preserva a edição de pedido trazida da main: token/edição por query string continuam intactos", () => {
    expect(fonte).toContain("setStatusToken(sp.get('token'))");
    expect(fonte).toContain("EdicaoStatus");
    expect(fonte).toContain("/editar/status?token=");
  });
});

describe("/rastrear/[pedidoId] — [bloqueio] WhatsApp dinâmico, sem número fictício", () => {
  test("[caso 14] número de telefone fixo não existe mais neste arquivo", () => {
    expect(fonte).not.toContain("PIZZARIA_NUMERO");
    expect(fonte).not.toContain("5586999999999");
  });

  test("[caso 12] reaproveita a mesma solução de /pedido/pagamento/[token] — mesmo endpoint, nenhuma segunda lógica de contato", () => {
    expect(fonte).toContain("/api/pedido-app/pagamento-pix?token=");
    expect(fonte).toMatch(/href=\{`https:\/\/wa\.me\/\$\{whatsappPizzaria\}`\}/);
  });

  test("[caso 13] botão de WhatsApp só renderiza quando há número configurado", () => {
    expect(fonte).toMatch(/\{whatsappPizzaria && \(/);
  });

  test("busca o contato só quando há statusToken — sem token (rastreio do motoboy), nunca tenta buscar", () => {
    expect(fonte).toMatch(/if \(!statusToken\) return/);
  });

  test("nenhuma cor hexadecimal nova (ex.: #fff) — só tokens do design system", () => {
    expect(fonte).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(fonte).toContain("var(--on-success)");
  });
});

describe("/rastrear/[pedidoId] — polling pausado com aba oculta", () => {
  test("polling de status/localização só consulta com document.visibilityState visible", () => {
    expect(fonte).toMatch(/if \(document\.visibilityState === 'visible'\) \{\s*fetchStatus\(\)\s*fetchLocalizacao\(\)/);
  });

  test("polling de status/localização escuta visibilitychange e limpa o listener ao desmontar", () => {
    expect(fonte).toContain("intervalRef.current = setInterval(talvezAtualizar, 10000)");
    expect(fonte).toMatch(/document\.addEventListener\('visibilitychange', talvezAtualizar\)[\s\S]{0,120}if \(intervalRef\.current\) clearInterval/);
  });

  test("polling de edição (token) só consulta com aba visível e limpa o listener ao desmontar", () => {
    expect(fonte).toContain("if (document.visibilityState === 'visible') fetchEdicao()");
    expect(fonte).toContain("const iv = setInterval(talvezAtualizar, 10000)");
    expect(fonte).toMatch(/ativo = false; clearInterval\(iv\); document\.removeEventListener\('visibilitychange', talvezAtualizar\)/);
  });
});
