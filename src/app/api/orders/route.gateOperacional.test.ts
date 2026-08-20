import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("PATCH /api/orders — fronteira do gate operacional", () => {
  test("revalida a pendência no pedido fresco sob mutex", () => {
    expect(source).toContain("const pendenciaAtual = classificarPendencia(pedidos[index], agoraMs)");
    expect(source).toContain("Este pedido não está mais pendente. Atualize o painel antes de continuar.");
  });

  test("não confia na ação declarada pelo navegador", () => {
    expect(source).toContain("const acaoEsperada = status === statusAnterior");
    expect(source).toContain("const transicaoCompativel = limpezaResolvida.acao === 'adiou'");
    expect(source).toContain("A ação informada não corresponde à etapa atual deste pedido.");
  });

  test("payload de resolução malformado falha fechado", () => {
    expect(source).toContain("limpeza !== undefined && !limpezaResolvida");
    expect(source).toContain("Resolução operacional inválida.");
  });

  test("mesa sem telefone não tenta WhatsApp sintético", () => {
    expect(source).toContain("if (digitos.length < 10) return null");
  });
});
