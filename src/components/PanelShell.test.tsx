import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { pushMock, pathnameRef } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  pathnameRef: { current: "/pedidos" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => pathnameRef.current,
}));

import PanelShell from "./PanelShell";

// Sem jsdom neste repo: renderToStaticMarkup + checagem do HTML gerado (ver
// ClientBottomNav.test.tsx). Cobre o requisito da Etapa "Acesso do salão":
// o item só existe na árvore quando a página o habilita via showGestaoNav
// (mesmo portão já usado por Dashboard/Configurações/Financeiro/Relatórios),
// nunca para páginas operacionais comuns (/pedidos, /cardapio, /conversas).

beforeEach(() => {
  pushMock.mockClear();
  pathnameRef.current = "/pedidos";
});

describe("PanelShell — item 'Acesso do salão' na sidebar", () => {
  test("não aparece quando showGestaoNav está desligado (páginas operacionais)", () => {
    const html = renderToStaticMarkup(<PanelShell>{null}</PanelShell>);
    expect(html).not.toContain("Acesso do salão");
    expect(html).not.toContain("Equipe");
  });

  test("aparece junto do grupo Gestão quando showGestaoNav está ligado", () => {
    const html = renderToStaticMarkup(<PanelShell showGestaoNav>{null}</PanelShell>);
    expect(html).toContain("Acesso do salão");
    expect(html).toContain("Equipe");
  });

  test("fica marcado como ativo quando a rota atual é /admin/salao", () => {
    pathnameRef.current = "/admin/salao";
    const html = renderToStaticMarkup(<PanelShell showGestaoNav>{null}</PanelShell>);
    const trecho = html.slice(html.indexOf("Acesso do salão") - 400, html.indexOf("Acesso do salão"));
    expect(trecho).toContain("ps-active");
  });

  test("aparece com showEquipeNav mesmo sem showGestaoNav (uso em /pedidos)", () => {
    const html = renderToStaticMarkup(<PanelShell showEquipeNav>{null}</PanelShell>);
    expect(html).toContain("Acesso do salão");
    expect(html).toContain("Equipe");
  });

  test("showEquipeNav não traz Dashboard/Configurações/Financeiro/Relatórios/Jornada do Chef — sem duplicar o painel administrativo em /pedidos", () => {
    const html = renderToStaticMarkup(<PanelShell showEquipeNav>{null}</PanelShell>);
    expect(html).not.toContain("Dashboard");
    expect(html).not.toContain("Configurações");
    expect(html).not.toContain("Financeiro");
    expect(html).not.toContain("Relatórios");
    expect(html).not.toContain("Jornada do Chef");
  });

  test("o item continua existindo uma única vez mesmo com showGestaoNav e showEquipeNav juntos", () => {
    const html = renderToStaticMarkup(<PanelShell showGestaoNav showEquipeNav>{null}</PanelShell>);
    const ocorrencias = html.split("Acesso do salão").length - 1;
    expect(ocorrencias).toBe(1);
  });
});
