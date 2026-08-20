import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("/pedidos — contrato do Salão para o gate operacional", () => {
  test("não pula Fazendo direto para Servido", () => {
    expect(source).not.toContain('(isDineInDetail && p.status === "em_preparo") ? "entregue"');
    expect(source).not.toContain('(isDineIn && pedido.status === "em_preparo") ? "entregue"');
    expect(source).toContain('const nextStatus = NEXT_STATUS[p.status]');
    expect(source).toContain('const nextStatus = NEXT_STATUS[pedido.status]');
  });

  test("comanda também usa a progressão canônica", () => {
    expect(source).toContain('const alvoNextStatusFamilia = alvoAcaoFamilia\n              ? NEXT_STATUS[alvoAcaoFamilia.status]');
  });

  test("pedido de Salão/retirada nunca abre seleção de entregador ao ficar pronto", () => {
    expect(source).toContain('!isPedidoDineIn(pedido) && !isPedidoRetirada(pedido)');
    expect(source).toContain('!isPedidoDineIn(alvoAcaoFamilia) && !isPedidoRetirada(alvoAcaoFamilia)');
  });

  test("rótulos distinguem Pronto para servir de Servido", () => {
    expect(source).toContain('return "Pronto para servir"');
    expect(source).toContain('return "Pedido servido"');
  });
});
