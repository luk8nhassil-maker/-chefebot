import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// AUDITORIA + REGRESSÃO — incidente de produção: notificações de status
// chegando com nome/telefone de OUTRO cliente na mesma conversa do WhatsApp.
//
// Causa raiz comprovada: o campo `id` de todo pedido (usado como ÚNICA chave
// de busca em toda troca de status / notificação) era gerado com
// `Date.now().toString()` — resolução de 1ms, sem sufixo aleatório nem
// verificação de unicidade. Sob criação concorrente (dois clientes
// finalizando pedido no mesmo milissegundo, perfeitamente plausível em
// horário de pico com múltiplos webhooks da Evolution API chegando em
// paralelo), dois pedidos de clientes DIFERENTES podiam nascer com o MESMO
// `id`. Como `pedidos.findIndex(p => p.id === id)` sempre resolve para a
// PRIMEIRA ocorrência, toda troca de status feita a partir daí (em_preparo,
// saiu_entrega, entregue, ...) — não importa a qual dos dois pedidos o
// operador realmente pretendia mudar o status — acabava lendo nome+telefone
// do primeiro pedido daquele id, notificando sempre o MESMO cliente errado,
// repetidamente, com mensagens de status que na verdade pertenciam ao outro.
// Isso bate com o padrão observado (mesmo nome recebendo várias mensagens de
// status diferentes, enquanto outro nome aparece isolado).
//
// O `numero` sequencial (via INCR atômico, ver src/lib/numeracao.ts) já era o
// único identificador realmente único no sistema — mas não é usado como
// chave de busca em nenhum PATCH/notificação; só o `id` era usado.
//
// Patch: `gerarIdPedidoUnico` (src/lib/numeracao.ts) reivindica o id via
// SET NX antes de devolvê-lo, preservando `id === Date.now().toString()` no
// caso comum (sem mudar formato/tamanho em nenhum outro fluxo, inclusive o
// txid do Pix) e só desempatando no caso raro de colisão real.
//
// Os testes do grupo "CAUSA RAIZ" abaixo agora expressam a garantia SEGURA
// (pós-patch) — não devem voltar a aceitar colisão de id.

const redisStore = new Map<string, unknown>();

function defaultGetImpl(key: string) {
  return Promise.resolve(redisStore.has(key) ? redisStore.get(key) : null);
}
function defaultSetImpl(key: string, value: unknown, opts?: { nx?: boolean }) {
  if (opts?.nx && redisStore.has(key)) return Promise.resolve(null);
  redisStore.set(key, value);
  return Promise.resolve("OK");
}
function defaultDelImpl(key: string) {
  const existed = redisStore.has(key);
  redisStore.delete(key);
  return Promise.resolve(existed ? 1 : 0);
}
function defaultIncrImpl(key: string) {
  const atual = (redisStore.get(key) as number | undefined) ?? 0;
  const novo = atual + 1;
  redisStore.set(key, novo);
  return Promise.resolve(novo);
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
    del: vi.fn(defaultDelImpl),
    incr: vi.fn(defaultIncrImpl),
    expire: vi.fn(async () => 1),
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) =>
      token === "token-admin" ? { username: "kellyne", name: "Kellyne", role: "admin" } : null
    ),
  };
});

vi.mock("@/lib/evolutionApi", () => ({
  obterConfigEvolution: vi.fn(() => ({
    baseUrl: "https://evolution.test",
    apiKey: "key",
    instanceName: "chefebot",
    webhookUrl: "https://x.test/api/whatsapp",
  })),
}));

const fetchMock = vi.fn<(url: string, opts?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(
  async () => ({ ok: true, json: async () => ({}) })
);
vi.stubGlobal("fetch", fetchMock);

import { PATCH, POST } from "./route";

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: "auth-token=token-admin" },
    body: JSON.stringify(body),
  });
}

function postRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "auth-token=token-admin" },
    body: JSON.stringify(body),
  });
}

// Retorna todos os envios de sendText desta chamada, na ordem, como {numero, texto}.
function envios(): { numero: string; texto: string }[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/message/sendText/"))
    .map(([, opts]) => {
      const parsed = JSON.parse(String((opts as RequestInit).body));
      return { numero: parsed.number as string, texto: parsed.text as string };
    });
}

function seedPedidos(pedidos: Record<string, unknown>[]) {
  redisStore.set("pedidos", pedidos);
}

beforeEach(() => {
  redisStore.clear();
  fetchMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Isolamento correto quando os ids NÃO colidem (Casos 1-4 do roteiro de auditoria)", () => {
  test("Caso 1/2: duas trocas de status concorrentes para dois clientes distintos nunca se cruzam", async () => {
    seedPedidos([
      { id: "1001", numero: 1, cliente: "Fernanda Alves", telefone: "5511111111111", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua A", tipoEntrega: "delivery" },
      { id: "1002", numero: 2, cliente: "Ricardo Nunes", telefone: "5522222222222", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua B", tipoEntrega: "delivery" },
    ]);

    await Promise.all([
      PATCH(patchRequest({ id: "1001", status: "em_preparo" })),
      PATCH(patchRequest({ id: "1002", status: "em_preparo" })),
    ]);

    const mensagens = envios();
    const paraA = mensagens.filter(m => m.numero === "5511111111111");
    const paraB = mensagens.filter(m => m.numero === "5522222222222");

    expect(paraA.length).toBeGreaterThan(0);
    expect(paraB.length).toBeGreaterThan(0);
    for (const m of paraA) expect(m.texto).toContain("Fernanda");
    for (const m of paraB) expect(m.texto).toContain("Ricardo");
    // Nenhuma mensagem enviada ao número de A cita o nome de B, e vice-versa.
    for (const m of paraA) expect(m.texto).not.toContain("Ricardo");
    for (const m of paraB) expect(m.texto).not.toContain("Fernanda");
  });

  test("Caso 4: três ou mais pedidos concorrentes — cada telefone recebe só seu próprio pedido", async () => {
    seedPedidos([
      { id: "2001", numero: 1, cliente: "Ana", telefone: "5531111111111", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 1", tipoEntrega: "delivery" },
      { id: "2002", numero: 2, cliente: "Bruno", telefone: "5532222222222", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 2", tipoEntrega: "delivery" },
      { id: "2003", numero: 3, cliente: "Carla", telefone: "5533333333333", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 3", tipoEntrega: "delivery" },
    ]);

    await Promise.all([
      PATCH(patchRequest({ id: "2001", status: "em_preparo" })),
      PATCH(patchRequest({ id: "2002", status: "em_preparo" })),
      PATCH(patchRequest({ id: "2003", status: "em_preparo" })),
    ]);

    const mensagens = envios();
    expect(mensagens.find(m => m.numero === "5531111111111")?.texto).toContain("Ana");
    expect(mensagens.find(m => m.numero === "5532222222222")?.texto).toContain("Bruno");
    expect(mensagens.find(m => m.numero === "5533333333333")?.texto).toContain("Carla");
  });
});

describe("CAUSA RAIZ (corrigida): id de pedido não colide mais sob criação concorrente", () => {
  // Antes do patch, estes dois testes provavam a colisão (dois pedidos de
  // clientes diferentes, criados no mesmo Date.now() mockado, nasciam com o
  // MESMO `id` — e o PATCH por esse id só conseguia endereçar o primeiro,
  // nunca o segundo). Ver histórico do PR do incidente para a versão que
  // reproduzia o bug com `expect(pedidoA.id).toBe(pedidoB.id)`. Agora que
  // `gerarIdPedidoUnico` (src/lib/numeracao.ts) reivindica o id via SET NX
  // antes de usá-lo, estes testes verificam a garantia inversa: mesmo no
  // mesmo milissegundo, os dois pedidos ficam com ids diferentes e cada um
  // continua endereçável e notificável corretamente.
  test("dois pedidos de clientes diferentes criados no mesmo milissegundo recebem ids DIFERENTES", async () => {
    const FIXO_MS = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(FIXO_MS);

    const resA = await POST(postRequest({
      cliente: "Jessica Ramos", telefone: "5541111111111", itens: ["Pizza G"], total: 50, endereco: "Rua das Palmeiras, 1",
    }));
    const resB = await POST(postRequest({
      cliente: "Adriano Silva", telefone: "5542222222222", itens: ["Pizza M"], total: 40, endereco: "Rua das Acácias, 2",
    }));

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    const pedidoA = await resA.json();
    const pedidoB = await resB.json();

    // Mesmo com Date.now() travado no mesmo valor para as duas criações, os
    // ids não colidem mais — a reivindicação atômica força o desempate.
    expect(pedidoA.id).not.toBe(pedidoB.id);
    // Caso comum (primeira reivindicação): id continua EXATAMENTE
    // Date.now().toString(), sem mudar formato/tamanho usado no resto do
    // sistema (Pix txid, ordenação por timestampOrdenacaoPedido, etc.).
    expect(pedidoA.id).toBe(String(FIXO_MS));

    const persistidos = redisStore.get("pedidos") as Record<string, unknown>[];
    expect(persistidos.filter(p => p.id === pedidoA.id)).toHaveLength(1);
    expect(persistidos.filter(p => p.id === pedidoB.id)).toHaveLength(1);
  });

  test("cada pedido criado no mesmo milissegundo é notificado corretamente, sem cruzar nome/telefone", async () => {
    const FIXO_MS = 1_700_000_000_001;
    vi.spyOn(Date, "now").mockReturnValue(FIXO_MS);

    const resA = await POST(postRequest({
      cliente: "Jessica Ramos", telefone: "5541111111111", itens: ["Pizza G"], total: 50, endereco: "Rua das Palmeiras, 1", tipoEntrega: "delivery",
    }));
    const resB = await POST(postRequest({
      cliente: "Adriano Silva", telefone: "5542222222222", itens: ["Pizza M"], total: 40, endereco: "Rua das Acácias, 2", tipoEntrega: "delivery",
    }));
    const pedidoA = await resA.json();
    const pedidoB = await resB.json();
    expect(pedidoA.id).not.toBe(pedidoB.id); // pré-condição: sem colisão

    vi.restoreAllMocks(); // Date.now volta ao normal para as trocas de status.
    fetchMock.mockClear();

    await PATCH(patchRequest({ id: pedidoB.id, status: "em_preparo" }));
    await PATCH(patchRequest({ id: pedidoA.id, status: "em_preparo" }));
    await PATCH(patchRequest({ id: pedidoA.id, status: "saiu_entrega" }));

    const mensagens = envios();
    const paraJessica = mensagens.filter(m => m.numero === "5541111111111");
    const paraAdriano = mensagens.filter(m => m.numero === "5542222222222");

    // Adriano só recebe mensagens sobre o próprio pedido.
    expect(paraAdriano.length).toBe(1);
    expect(paraAdriano[0].texto).toContain("Adriano");
    expect(paraAdriano[0].texto).not.toContain("Jessica");

    // Jessica recebe as duas mensagens do próprio pedido (em_preparo e
    // saiu_entrega) — nunca nada endereçado ao Adriano.
    expect(paraJessica.length).toBe(2);
    for (const m of paraJessica) {
      expect(m.texto).toContain("Jessica");
      expect(m.texto).not.toContain("Adriano");
    }
  });
});

// BLOQUEIO 3 da revisão externa: os testes acima usam `await POST(A); await
// POST(B)` sequencial — prova a ausência de colisão com Date.now travado,
// mas não prova nada sob execução REALMENTE concorrente (as duas requisições
// disputando o mesmo instante, entrelaçadas pelo event loop). Os testes deste
// bloco usam Promise.all/Promise.allSettled — o mock de redis.set usado neste
// arquivo (defaultSetImpl) reproduz a semântica atômica real do SET NX:
// checa-e-grava de forma síncrona dentro do próprio corpo da função mockada,
// sem nenhum await antes da gravação, a mesma garantia que o Redis real dá
// por processar comandos de forma serializada no servidor.
//
// IMPORTANTE: estes testes verificam SÓ a propriedade de unicidade de id sob
// concorrência real (o que gerarIdPedidoUnico garante) — não que TODOS os
// pedidos concorrentes sobrevivam na lista persistida. Essa segunda
// propriedade depende da escrita read-modify-write de "pedidos" inteira ser
// atômica, o que ELA NÃO É (ver bloco "BLOQUEIO 4" abaixo — achado separado,
// pré-existente, não corrigido por este patch). Testar as duas propriedades
// juntas aqui esconderia qual delas eventualmente falha; por isso a
// verificação de notificação abaixo é feita só sobre os pedidos que
// REALMENTE persistiram, nunca assumindo que todos os 201 retornados
// corresponde a um pedido salvo.
describe("Concorrência REAL (Promise.all) — não apenas Date.now travado com chamadas sequenciais", () => {
  test("Promise.all([POST(A), POST(B)]) no mesmo milissegundo: as duas requisições concorrentes recebem ids DIFERENTES (nunca o mesmo id)", async () => {
    const FIXO_MS = 1_700_000_010_000;
    vi.spyOn(Date, "now").mockReturnValue(FIXO_MS);

    const [resA, resB] = await Promise.all([
      POST(postRequest({ cliente: "Fernanda Alves", telefone: "5591111111111", itens: ["Pizza G"], total: 50, endereco: "Rua 1", tipoEntrega: "delivery" })),
      POST(postRequest({ cliente: "Ricardo Nunes", telefone: "5592222222222", itens: ["Pizza M"], total: 40, endereco: "Rua 2", tipoEntrega: "delivery" })),
    ]);
    vi.restoreAllMocks();

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    const pedidoA = await resA.json();
    const pedidoB = await resB.json();
    // Garantia central do patch, sob concorrência real (não sequencial):
    // nunca o mesmo id, mesmo no mesmo milissegundo.
    expect(pedidoA.id).not.toBe(pedidoB.id);

    // Para o(s) pedido(s) que sobreviveram na persistência (ver nota acima
    // sobre o BLOQUEIO 4), a notificação continua correta e isolada por id —
    // nunca mistura nome/telefone entre A e B.
    const persistidos = (redisStore.get("pedidos") as Record<string, unknown>[]) ?? [];
    fetchMock.mockClear();
    await Promise.all([
      persistidos.some(p => p.id === pedidoA.id) ? PATCH(patchRequest({ id: pedidoA.id, status: "em_preparo" })) : Promise.resolve(),
      persistidos.some(p => p.id === pedidoB.id) ? PATCH(patchRequest({ id: pedidoB.id, status: "em_preparo" })) : Promise.resolve(),
    ]);
    const mensagens = envios();
    for (const m of mensagens) {
      if (m.numero === "5591111111111") { expect(m.texto).toContain("Fernanda"); expect(m.texto).not.toContain("Ricardo"); }
      if (m.numero === "5592222222222") { expect(m.texto).toContain("Ricardo"); expect(m.texto).not.toContain("Fernanda"); }
    }
  });

  test("20 criações GENUINAMENTE concorrentes (Promise.all) no mesmo milissegundo: 20 ids ÚNICOS devolvidos, sem nenhuma colisão", async () => {
    const FIXO_MS = 1_700_000_011_000;
    vi.spyOn(Date, "now").mockReturnValue(FIXO_MS);

    const clientes = Array.from({ length: 20 }, (_, i) => ({
      cliente: `ClienteConcorrente${i}`,
      telefone: `55900000${String(i).padStart(4, "0")}`,
      itens: ["Pizza G"],
      total: 30 + i,
      endereco: `Rua ${i}`,
      tipoEntrega: "delivery",
    }));

    const respostas = await Promise.all(clientes.map(c => POST(postRequest(c))));
    vi.restoreAllMocks();

    for (const r of respostas) expect(r.status).toBe(201);
    const pedidos = await Promise.all(respostas.map(r => r.json()));

    // Garantia central do patch: cada uma das 20 requisições concorrentes
    // recebeu um pedidoId ÚNICO de gerarIdPedidoUnico — nenhuma colisão,
    // mesmo com Date.now() travado no mesmo valor para as 20.
    const ids = pedidos.map(p => p.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    for (const id of ids) expect(/^\d+$/.test(id)).toBe(true);

    // Notificação correta e isolada por id para os que sobreviveram na
    // persistência (ver nota do BLOQUEIO 4 acima do describe) — nunca mistura
    // nome/telefone entre clientes concorrentes.
    const persistidos = (redisStore.get("pedidos") as Record<string, unknown>[]) ?? [];
    fetchMock.mockClear();
    await Promise.all(
      pedidos
        .filter(p => persistidos.some(persisted => persisted.id === p.id))
        .map(p => PATCH(patchRequest({ id: p.id, status: "em_preparo" })))
    );

    const mensagens = envios();
    for (let i = 0; i < 20; i++) {
      const minhasMensagens = mensagens.filter(m => m.numero === clientes[i].telefone);
      for (const m of minhasMensagens) {
        expect(m.texto).toContain(`ClienteConcorrente${i}`);
        for (let j = 0; j < 20; j++) {
          if (j === i) continue;
          expect(m.texto).not.toContain(`ClienteConcorrente${j}`);
        }
      }
    }
  });
});

// BLOQUEIO 4 da revisão externa: POST /api/orders faz um read-modify-write
// (getPedidos → redis.set('pedidos', [...pedidos, novoPedido])) sem lock
// nem CAS na chave "pedidos" inteira. Isto é DISTINTO da causa raiz (colisão
// de id) e NÃO foi corrigido por gerarIdPedidoUnico — ele só garante que o
// `id` escolhido é único, não que a escrita da lista inteira seja atômica.
// Este teste investigou (não assumiu) se duas criações concorrentes podem
// perder uma da outra (lost update) — CONFIRMADO: perdem. `test.fails`
// documenta isso como um gap CONHECIDO e JÁ REPORTADO (achado separado,
// fora do escopo deste patch — ver relatório do incidente), em vez de deixar
// a suíte permanentemente vermelha por um problema não corrigido aqui. Se
// algum patch futuro corrigir o lost update, ESTE teste passa a passar de
// verdade, e o `test.fails` vira ele mesmo uma falha (sinal para atualizar
// a expectativa) — nunca fica verde silenciosamente.
describe("BLOQUEIO 4 — lost update em POST /api/orders (achado separado, confirmado, NÃO corrigido por este patch)", () => {
  test.fails("duas criações concorrentes (Promise.all): SEM correção, uma das duas é perdida na lista persistida (lost update conhecido)", async () => {
    const FIXO_MS = 1_700_000_012_000;
    vi.spyOn(Date, "now").mockReturnValue(FIXO_MS);

    const [resA, resB] = await Promise.all([
      POST(postRequest({ cliente: "Lost Update A", telefone: "5581111111111", itens: ["Pizza G"], total: 50, endereco: "Rua 1" })),
      POST(postRequest({ cliente: "Lost Update B", telefone: "5582222222222", itens: ["Pizza M"], total: 40, endereco: "Rua 2" })),
    ]);
    vi.restoreAllMocks();

    // Ambas as requisições HTTP retornam sucesso — isto sozinho NÃO prova que
    // os dois pedidos foram persistidos (é exatamente o que este teste apura).
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    const pedidoA = await resA.json();
    const pedidoB = await resB.json();

    const persistidos = (redisStore.get("pedidos") as Record<string, unknown>[]) ?? [];
    const idsPersistidos = persistidos.map(p => p.id);

    console.log(
      "[BLOQUEIO 4] pedidos persistidos:", idsPersistidos.length,
      "esperado: 2 | pedidoA presente:", idsPersistidos.includes(pedidoA.id),
      "| pedidoB presente:", idsPersistidos.includes(pedidoB.id)
    );

    // Comportamento ESPERADO (sem lost update): os dois sobrevivem.
    expect(persistidos).toHaveLength(2);
    expect(idsPersistidos).toContain(pedidoA.id);
    expect(idsPersistidos).toContain(pedidoB.id);
  });
});

describe("Hipóteses alternativas descartadas pela auditoria", () => {
  test("Caso 6: nomes iguais em pedidos com ids diferentes NÃO são tratados como o mesmo cliente", async () => {
    seedPedidos([
      { id: "3001", numero: 1, cliente: "Amanda Reis", telefone: "5551111111111", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 1", tipoEntrega: "delivery" },
      { id: "3002", numero: 2, cliente: "Amanda Reis", telefone: "5552222222222", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 2", tipoEntrega: "delivery" },
    ]);

    await PATCH(patchRequest({ id: "3002", status: "em_preparo" }));

    const mensagens = envios();
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0].numero).toBe("5552222222222");
  });

  test("Caso 7: mesmo telefone em dois pedidos legítimos (ids diferentes) não é contaminação de estado", async () => {
    seedPedidos([
      { id: "4001", numero: 1, cliente: "Jessica Ramos", telefone: "5561111111111", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 1", tipoEntrega: "delivery" },
      { id: "4002", numero: 2, cliente: "Adriano Silva", telefone: "5561111111111", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 2", tipoEntrega: "delivery" },
    ]);

    await PATCH(patchRequest({ id: "4001", status: "em_preparo" }));
    fetchMock.mockClear();
    await PATCH(patchRequest({ id: "4002", status: "saiu_entrega" }));

    const mensagens = envios();
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0].numero).toBe("5561111111111");
    expect(mensagens[0].texto).toContain("Adriano");
    expect(mensagens[0].texto).not.toContain("Jessica");
  });

  test("Caso 8: telefone ausente nunca cai para o telefone de outro pedido do array", async () => {
    seedPedidos([
      { id: "5001", numero: 1, cliente: "Cliente Sem Telefone", telefone: "", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 1", tipoEntrega: "delivery" },
      { id: "5002", numero: 2, cliente: "Outro Cliente", telefone: "5571234567890", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 2", tipoEntrega: "delivery" },
    ]);

    await PATCH(patchRequest({ id: "5001", status: "em_preparo" }));

    const mensagens = envios();
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0].numero).not.toBe("5571234567890");
    expect(mensagens[0].numero).toBe("55"); // sanitizePhone("") -> só o prefixo do país
  });
});

describe("Achado secundário (não é a causa raiz, mas é duplicidade real e distinta da corrigida no PR #288)", () => {
  test("Caso 5: repetir o mesmo status no mesmo pedido reenvia a notificação (sem idempotência de notificação)", async () => {
    seedPedidos([
      { id: "6001", numero: 1, cliente: "Cliente Único", telefone: "5581111111111", itens: ["x"], total: 10, status: "em_preparo", horario: "10:00", endereco: "Rua 1", tipoEntrega: "delivery" },
    ]);

    await PATCH(patchRequest({ id: "6001", status: "saiu_entrega" }));
    await PATCH(patchRequest({ id: "6001", status: "saiu_entrega" }));

    const mensagens = envios().filter(m => m.numero === "5581111111111");
    // Documenta o comportamento atual: cada PATCH reenvia, mesmo sem mudança real de status.
    expect(mensagens.length).toBe(2);
  });
});
