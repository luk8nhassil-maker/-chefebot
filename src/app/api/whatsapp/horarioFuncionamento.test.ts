import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Guarda estrutural sem jsdom/mocks pesados (mesma abordagem usada em
// src/app/cardapio/page.test.ts): o handler POST completo já tem cobertura
// própria em outros arquivos deste diretório; aqui só garantimos que o
// horário exibido pelo bot ("Hoje nosso atendimento vai até *Xh*") continua
// vindo da mesma fonte usada por estaAberto/mensagemFechado — config:pizzaria
// no Redis — em vez do valor hardcoded "22h" que nunca acompanhava o
// horaFechamento real configurado pela pizzaria.
const fonte = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf-8");

describe("/api/whatsapp — fonte única de horário para o bot", () => {
  test("importa setHorarioFuncionamento de @/lib/bot", () => {
    expect(fonte).toMatch(/import \{[^}]*setHorarioFuncionamento[^}]*\} from "@\/lib\/bot"/);
  });

  test("chama setHorarioFuncionamento com o horaFechamento real de config:pizzaria, no mesmo bloco dos outros setters dinâmicos", () => {
    const bloco = fonte.slice(fonte.indexOf("setMenuDinamico(menuDinamico)"), fonte.indexOf("setEsgotados(esgotadosLista)"));
    expect(bloco).toContain("setHorarioFuncionamento(`${config.horaFechamento}h`)");
  });

  test("não introduz uma segunda fonte de horário — continua usando o mesmo objeto `config` de getConfig()/estaAberto/mensagemFechado", () => {
    expect(fonte).toMatch(/function estaAberto\(config: ConfigPizzaria\)/);
    expect(fonte).toMatch(/function mensagemFechado\(config: ConfigPizzaria\)/);
    expect(fonte).toContain("const config = await getConfig();");
  });
});
