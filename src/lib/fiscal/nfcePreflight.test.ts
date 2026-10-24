import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import type { PedidoSnapshotOficial } from "@/lib/pedidoSnapshot";
import { prepararNfce, type PedidoParaNfce } from "./nfcePreflight";

const snapshot: PedidoSnapshotOficial = {
  itens: [{
    kind: "pizza", nome: "Item de teste (fictício)", quantidade: 2,
    precoUnitarioCents: 1250, totalCents: 2500,
    selecao: { sizeId: "tam-teste", flavorIds: ["sabor-teste"] },
  }],
  subtotalCents: 2500, descontoFidelidadeCents: 0,
  taxaEntregaCents: 0, totalCents: 2500,
  entrega: { tipo: "retirada" }, pagamento: "Dinheiro", criadoEm: "2026-10-24T15:00:00Z",
};

const pedido: PedidoParaNfce = {
  id: "pedido-sintetico", status: "entregue", total: 25,
  pagamento: "Dinheiro", snapshotOficial: snapshot,
};

describe("pré-conferência NFC-e: nenhum valor fiscal é inventado", () => {
  test("confere composição e valor, mas nunca declara emissão liberada", () => {
    const resposta = prepararNfce(pedido, true);
    expect(resposta.emissor).toBe("WLG Sistemas");
    expect(resposta.resumo?.totalCentavos).toBe(2500);
    expect(resposta.resumo?.itens).toHaveLength(1);
    expect(resposta.podeEmitir).toBe(false);
    expect(resposta.motivos.join(" ")).toContain("credenciamento");
  });
  test("sem configuração do emissor bloqueia", () => {
    expect(prepararNfce(pedido, false).motivos.join(" ")).toContain("não configurado");
  });
  test("recusa preço adulterado, sem reconstruir pelo nome", () => {
    const p: PedidoParaNfce = { ...pedido, total: 26 };
    const r = prepararNfce(p, true);
    expect(r.resumo).toBeNull();
    expect(r.motivos.join(" ")).toContain("Totais divergentes");
  });
  test("recusa item com preço negativo e quantidade fracionária", () => {
    const p: PedidoParaNfce = {
      ...pedido, snapshotOficial: { ...snapshot, itens: [
        { ...snapshot.itens[0], quantidade: 1.5, precoUnitarioCents: -100 },
      ] },
    };
    expect(prepararNfce(p, true).resumo).toBeNull();
  });
  test("recusa falta de snapshot oficial", () => {
    const r = prepararNfce({ ...pedido, snapshotOficial: undefined }, true);
    expect(r.resumo).toBeNull();
    expect(r.podeEmitir).toBe(false);
  });
  test("recusa Pix ainda não confirmado", () => {
    const r = prepararNfce({ ...pedido, pagamento: "Pix", pixConfirmado: false }, true);
    expect(r.motivos.join(" ")).toContain("Pix ainda sem confirmação");
  });
  test("bloqueia nota por rodada, exige conta inteira do Salão", () => {
    const p = { ...pedido, comandaId: "comanda-teste" };
    expect(prepararNfce(p, true).motivos.join(" ")).toContain("conta inteira");
  });
  test("bloqueia pedido não concluído ou cancelado", () => {
    expect(prepararNfce({ ...pedido, status: "novo" }, true).motivos.join(" ")).toContain("Conclua");
    expect(prepararNfce({ ...pedido, status: "cancelado" }, true).motivos.join(" ")).toContain("cancelado");
  });
  test("bloqueia desconto e taxa sem aprovação fiscal", () => {
    const outro = { ...snapshot, subtotalCents: 2500, descontoFidelidadeCents: 200,
      taxaEntregaCents: 300, totalCents: 2600 };
    const r = prepararNfce({ ...pedido, total: 26, snapshotOficial: outro }, true);
    expect(r.motivos.join(" ")).toContain("Desconto ou entrega");
  });
});

describe("gate fiscal seguro (testes estruturais)", () => {
  const route = readFileSync(new URL("../../app/api/fiscal/nfce/preparar/route.ts", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../../app/pedidos/page.tsx", import.meta.url), "utf8");
  const ux = readFileSync(new URL("../../components/FiscalNfcePreflight.tsx", import.meta.url), "utf8");

  test("API exige autenticação e não escreve pedidos nem emite", () => {
    expect(route).toContain('exigirRole(usuario, ["admin", "atendente", "dev"])');
    expect(route).toContain('redis.get<PedidoParaNfce[]>("pedidos")');
    expect(route).toContain("WLG_FISCAL_CLIENT_ID");
    expect(route).toContain("WLG_FISCAL_CLIENT_SECRET");
    expect(route).toContain("WLG_FISCAL_EMPRESA_ID");
    expect(route).not.toContain("FOCUS_NFCE_TOKEN");
    expect(route).not.toMatch(/redis\.(set|eval|del|incr|hset|lpush|rpush)\s*\(/);
    expect(route).not.toContain("fetch(");
  });
  test("POST de emissão é explicitamente recusado", () => {
    expect(route).toContain("export async function POST");
    expect(route).toContain("status: 423");
  });
  test("Preview nunca lê o Redis real", () => {
    expect(route.indexOf("if (emPreviewVercel())")).toBeLessThan(route.indexOf("redis.get<"));
  });
  test("interface fica invisível sem a flag específica e sem notas falsas", () => {
    expect(panel).toContain('process.env.NEXT_PUBLIC_FISCAL_NFCE_UI === "true"');
    expect(ux).toContain("disabled");
    expect(ux).toContain("ainda não é uma nota emitida");
  });
});
