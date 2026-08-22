import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lib = readFileSync(fileURLToPath(new URL("./inatividadeConversa.ts", import.meta.url)), "utf-8");
const bot = readFileSync(fileURLToPath(new URL("./bot.ts", import.meta.url)), "utf-8");
const route = readFileSync(fileURLToPath(new URL("../app/api/interno/cancelamento-inatividade/route.ts", import.meta.url)), "utf-8");

describe("WhatsApp — inatividade não pode assustar nem apagar o atendimento", () => {
  test("espera 20 minutos antes do lembrete", () => {
    expect(lib).toContain("20 * 60 * 1000");
    expect(lib).not.toContain("10 * 60 * 1000");
  });

  test("mensagem deixa explícito que nada foi cancelado", () => {
    const inicio = bot.indexOf("mensagemLembretePorInatividade");
    expect(inicio).toBeGreaterThan(-1);
    const trecho = bot.slice(inicio, bot.indexOf("// Anexa o link", inicio));
    expect(trecho).toContain("nada foi cancelado");
    expect(trecho).toContain("continua por aqui");
    expect(trecho).not.toContain("cancelei esse pedido");
  });

  test("tick vira lembrete não destrutivo e mantém a sessão viva", () => {
    expect(route).not.toContain("await redis.del(`session:${phone}`)");
    expect(route).not.toContain("await redis.del(`manual:${phone}`)");
    expect(route).toContain("await redis.expire(`session:${phone}`, 1800)");
    expect(route).toContain("lembrete_ja_enviado");
    expect(route).toContain("lembreteEnviado");
  });
});
