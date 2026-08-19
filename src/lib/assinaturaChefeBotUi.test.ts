import { describe, expect, it } from "vitest";
import {
  ehRotaOperacionalAssinatura,
  estadoCtaAssinatura,
  planoIndisponivelPorPendencia,
  temSessaoOperacionalAssinatura,
} from "./assinaturaChefeBotUi";

describe("assinatura ChefeBot — UI e permissões", () => {
  it("protege rotas operacionais sem bloquear cardápio público, login ou entregador", () => {
    expect(ehRotaOperacionalAssinatura("/pedidos")).toBe(true);
    expect(ehRotaOperacionalAssinatura("/cardapio/admin")).toBe(true);
    expect(ehRotaOperacionalAssinatura("/pedido")).toBe(false);
    expect(ehRotaOperacionalAssinatura("/login")).toBe(false);
    expect(ehRotaOperacionalAssinatura("/entregador")).toBe(false);
  });

  it("reconhece somente sessão de equipe operacional no cookie público", () => {
    const admin = encodeURIComponent(JSON.stringify({ username: "teste", role: "admin" }));
    const atendente = encodeURIComponent(JSON.stringify({ username: "teste", role: "atendente" }));
    const entregador = encodeURIComponent(JSON.stringify({ username: "teste", role: "entregador" }));

    expect(temSessaoOperacionalAssinatura(`x=1; auth-user=${admin}`)).toBe(true);
    expect(temSessaoOperacionalAssinatura(`auth-user=${atendente}`)).toBe(true);
    expect(temSessaoOperacionalAssinatura(`auth-user=${entregador}`)).toBe(false);
    expect(temSessaoOperacionalAssinatura("auth-user=%7Bmalformado")).toBe(false);
  });

  it("não permite confirmar plano sem seleção, permissão ou durante loading", () => {
    expect(estadoCtaAssinatura({ planoSelecionado: false, regular: false, canManage: true, loading: false })).toEqual({
      disabled: true,
      label: "Escolha um plano",
    });
    expect(estadoCtaAssinatura({ planoSelecionado: true, regular: false, canManage: false, loading: false }).disabled).toBe(true);
    expect(estadoCtaAssinatura({ planoSelecionado: true, regular: false, canManage: true, loading: true }).disabled).toBe(true);
    expect(estadoCtaAssinatura({ planoSelecionado: true, regular: false, canManage: true, loading: false })).toEqual({
      disabled: false,
      label: "Continuar para o pagamento",
    });
  });

  it("com pendência congela a dívida no plano atual", () => {
    expect(planoIndisponivelPorPendencia({ blocked: false, daysLate: 1, isCurrent: false })).toBe(true);
    expect(planoIndisponivelPorPendencia({ blocked: true, daysLate: 0, isCurrent: false })).toBe(true);
    expect(planoIndisponivelPorPendencia({ blocked: true, daysLate: 3, isCurrent: true })).toBe(false);
  });
});
