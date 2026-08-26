import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  interpretarRespostaPedidos,
  MENSAGEM_FALHA_CARGA_PEDIDOS,
  type RespostaPedidos,
} from "./pedidosPainelCarga";

function resposta(parcial: Partial<RespostaPedidos>): RespostaPedidos {
  return {
    ok: parcial.ok ?? true,
    status: parcial.status ?? 200,
    json: parcial.json ?? (async () => []),
  };
}

// ---------------------------------------------------------------------------
// Reprodução do incidente: /pedidos preso em "Carregando..." para sempre.
//
// A regra central: NENHUMA resposta possível pode devolver um resultado que
// deixe a tela sem decisão. Se este bloco falhar, o spinner eterno voltou.
// ---------------------------------------------------------------------------
describe("incidente /pedidos preso em Carregando — toda resposta tem desfecho", () => {
  const cenarios: Array<{ nome: string; resposta: RespostaPedidos | null }> = [
    { nome: "500 do backend (ex.: Redis fora)", resposta: resposta({ ok: false, status: 500 }) },
    { nome: "502 do gateway", resposta: resposta({ ok: false, status: 502 }) },
    { nome: "503 de indisponibilidade", resposta: resposta({ ok: false, status: 503 }) },
    { nome: "504 de timeout", resposta: resposta({ ok: false, status: 504 }) },
    { nome: "402 de cobrança", resposta: resposta({ ok: false, status: 402 }) },
    { nome: "403 de permissão", resposta: resposta({ ok: false, status: 403 }) },
    { nome: "429 de rate limit", resposta: resposta({ ok: false, status: 429 }) },
    {
      nome: "200 com HTML de página de erro (json() lança)",
      resposta: resposta({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <") } }),
    },
    {
      nome: "200 com objeto de erro em vez de array",
      resposta: resposta({ ok: true, status: 200, json: async () => ({ error: "Nao autorizado" }) }),
    },
    { nome: "200 com null", resposta: resposta({ ok: true, status: 200, json: async () => null }) },
    { nome: "200 com string", resposta: resposta({ ok: true, status: 200, json: async () => "erro" }) },
    {
      nome: "200 com array contendo null (explodiria no primeiro p.id)",
      resposta: resposta({ ok: true, status: 200, json: async () => [{ id: "1" }, null] }),
    },
    {
      nome: "200 com array de primitivos",
      resposta: resposta({ ok: true, status: 200, json: async () => ["1", "2"] }),
    },
    { nome: "sem resposta nenhuma (falha de rede)", resposta: null },
  ];

  for (const cenario of cenarios) {
    test(`${cenario.nome}: resolve num desfecho classificado, nunca em "não sei"`, async () => {
      const resultado = await interpretarRespostaPedidos(cenario.resposta);
      expect(["ok", "erro", "nao_autenticado"]).toContain(resultado.tipo);
    });

    test(`${cenario.nome}: é ERRO explícito — nunca uma lista vazia disfarçada de sucesso`, async () => {
      const resultado = await interpretarRespostaPedidos(cenario.resposta);
      expect(resultado.tipo).toBe("erro");
      // A confusão que a operação não pode ter: "não consegui acessar" virando
      // "não existe nenhum pedido".
      expect(resultado).not.toMatchObject({ tipo: "ok", pedidos: [] });
    });
  }

  test("nunca lança — o chamador jamais precisa de um catch que engula tudo", async () => {
    const explosiva = resposta({
      ok: true,
      status: 200,
      json: async () => { throw new Error("boom") },
    });
    await expect(interpretarRespostaPedidos(explosiva)).resolves.toMatchObject({ tipo: "erro" });
  });
});

describe("interpretarRespostaPedidos — caminhos válidos preservados", () => {
  test("200 com array devolve os pedidos", async () => {
    const pedidos = [{ id: "1" }, { id: "2" }];
    const resultado = await interpretarRespostaPedidos(resposta({ json: async () => pedidos }));
    expect(resultado).toEqual({ tipo: "ok", pedidos });
  });

  test("200 com array VAZIO continua sendo sucesso — 'nenhum pedido' é um estado legítimo", async () => {
    const resultado = await interpretarRespostaPedidos(resposta({ json: async () => [] }));
    expect(resultado).toEqual({ tipo: "ok", pedidos: [] });
  });

  test("401 continua sendo sessão expirada, não erro genérico", async () => {
    const resultado = await interpretarRespostaPedidos(resposta({ ok: false, status: 401 }));
    expect(resultado).toEqual({ tipo: "nao_autenticado" });
  });

  test("o motivo distingue as famílias de falha, para o log ser útil", async () => {
    expect(await interpretarRespostaPedidos(null)).toMatchObject({ motivo: "sem_resposta", status: null });
    expect(await interpretarRespostaPedidos(resposta({ ok: false, status: 500 }))).toMatchObject({ motivo: "status_http", status: 500 });
    expect(
      await interpretarRespostaPedidos(resposta({ json: async () => { throw new Error("x") } }))
    ).toMatchObject({ motivo: "corpo_ilegivel" });
    expect(await interpretarRespostaPedidos(resposta({ json: async () => ({}) }))).toMatchObject({ motivo: "formato_inesperado" });
  });
});

// ---------------------------------------------------------------------------
// Contrato da tela. O módulo acima não serve para nada se /pedidos continuar
// com o `.catch(() => {})` que engolia a falha e mantinha loading=true.
// ---------------------------------------------------------------------------
describe("/pedidos — a tela não pode voltar a engolir a falha da carga inicial", () => {
  const fonte = readFileSync(
    fileURLToPath(new URL("../app/pedidos/page.tsx", import.meta.url)),
    "utf-8"
  );
  const carregar = fonte.slice(
    fonte.indexOf("const carregarPedidos ="),
    fonte.indexOf("useEffect(() => {\n    const tituloOriginal")
  );

  test("a carga usa o interpretador em vez de confiar que o corpo é array", () => {
    expect(carregar).toContain("interpretarRespostaPedidos");
  });

  test("não existe mais um catch vazio na carga de pedidos", () => {
    expect(carregar).not.toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  test("o caminho de erro encerra o loading — a origem do spinner eterno", () => {
    const trechoErro = carregar.slice(carregar.indexOf('resultado.tipo === "erro"'));
    expect(trechoErro).toContain("setLoading(false)");
  });

  test("o caminho de erro NÃO grava uma lista vazia por cima dos pedidos", () => {
    const trechoErro = carregar.slice(carregar.indexOf('resultado.tipo === "erro"'));
    expect(trechoErro).not.toContain("setPedidos([])");
  });

  test("existe estado de erro explícito na tela, com opção de tentar de novo", () => {
    expect(fonte).toContain("erroCarga");
    // A tela usa a MENSAGEM compartilhada — nunca um texto solto que possa
    // divergir do contrato deste módulo.
    expect(fonte).toContain("MENSAGEM_FALHA_CARGA_PEDIDOS");
    expect(MENSAGEM_FALHA_CARGA_PEDIDOS.length).toBeGreaterThan(0);
    expect(fonte).toContain("Tentar de novo");
    // O spinner eterno morava aqui: hoje o `if (loading)` é seguido de um
    // desfecho de erro explícito para a primeira carga.
    expect(fonte).toContain("erroCarga && !jaCarregouPedidos");
  });

  test("401 continua deslogando e voltando para o login", () => {
    expect(carregar).toContain('nao_autenticado');
    expect(carregar).toContain('/login?callbackUrl=/pedidos');
  });
});
