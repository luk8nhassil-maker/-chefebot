import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { request } from "node:http";
import { Ranking3Store, FECHAR_LUA, chaveClientes, chaveFonte, type BancoRanking3 } from "./store";
import { janelaTemporada, QUINZE_DIAS } from "./domain";
import { REGRA_ESTRELAS_V1 } from "../estrelas";
import { INVALIDAR_FONTE_LUA } from "./source";
import { VERCEL_PROJECT_CHEFEBOT_OFICIAL } from "../vercelProjeto";

const url = process.env.RANKING3_TEST_REDIS_URL;
if (url && !["chefebot-ranking3-srh", "127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Teste requer Redis local descartável, nunca produção");
const redis = url ? new Redis({ url, token: "ranking3-isolated", retry: false }) : null;
const suite = describe.runIf(Boolean(redis));

async function fixture(n = 20) {
  const tenant = `teste-${randomUUID()}`;
  const store = new Ranking3Store(redis!, tenant);
  await redis!.set(store.chave("config"), { versao: 3, ancora: "2026-10-20", auditoriaHistoricaRef: "fixture-sintetica-sem-migracao-real" });
  const ids = Array.from({ length: n }, (_, i) => `${tenant}-cliente-${i}`);
  const janela = janelaTemporada("2026-10-20", 0);
  for (const [indice, clienteId] of ids.entries()) {
    await redis!.sadd(chaveClientes(tenant), clienteId);
    await redis!.set(`fidelidade:pontos:estado:${clienteId}`, { extrato: [0, 1].map((ciclo) => ({ movimentoId: `sintetico-${ciclo}`, tipo: "confirmado", pontos: 30 - indice, regraVersao: REGRA_ESTRELAS_V1, createdAt: janelaTemporada("2026-10-20", ciclo).inicio })), recompensas: [], reservas: [] });
  }
  return { tenant, store, ids, janela };
}

suite("Ranking3 — Redis real isolado, scripts e recuperação", () => {
  beforeAll(() => {
    // Transporte explícito restrito a loopback; mantém bloqueio de rede externa.
    if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Redis de teste deve estar em loopback isolado");
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const destino = new URL(String(input));
      if (destino.origin !== new URL(url).origin) throw new Error("Destino não autorizado no teste");
      return new Promise<Response>((resolve, reject) => {
        const req = request(destino, { method: init?.method, headers: Object.fromEntries(new Headers(init?.headers).entries()) }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode })));
        });
        req.on("error", reject); req.end(init?.body as string | undefined);
      });
    });
  });
  afterAll(() => vi.unstubAllGlobals());
  it("fecha duas temporadas, preserva ligas, meta, direitos e índices sem TTL", async () => {
    const { store, ids } = await fixture();
    const fim = Date.parse(janelaTemporada("2026-10-20", 1).fim);
    expect(await store.recuperar(fim, async () => true)).toEqual({ fechados: 2, pendentes: false });
    const primeiro = await store.resultado(0), segundo = await store.resultado(1);
    expect(primeiro?.proximo.meta).toBe(25);
    expect(segundo?.normal).toHaveLength(10); expect(segundo?.top10).toHaveLength(10);
    expect(segundo?.proximo.nivel3).toHaveLength(6);
    const carteira = await store.carteira(ids[0]);
    expect(carteira).toHaveLength(2);
    expect(new Set(carteira.map((p) => p.id)).size).toBe(2);
    for (const p of carteira) expect(await redis!.ttl(store.chave(`premio:${p.id}`))).toBe(-1);
    expect(await redis!.zcard(store.chave("avisos"))).toBe(3);
    expect(await store.recuperar(fim, async () => true)).toEqual({ fechados: 0, pendentes: false });
  });
  it("dois fechamentos concorrentes não duplicam snapshots, direitos ou promoções", async () => {
    const { store, ids, janela } = await fixture(10);
    await Promise.all([store.recuperar(Date.parse(janela.fim), async () => true), store.recuperar(Date.parse(janela.fim), async () => true)]);
    expect(await store.carteira(ids[0])).toHaveLength(1);
    expect(await redis!.get(store.chave("checkpoint"))).toBe(0);
    expect(await redis!.zcard(store.chave("avisos"))).toBe(1);
  });
  it("queda depois do commit Redis não deixa resultado sem direito nem duplica no retry", async () => {
    const { tenant, store, ids, janela } = await fixture(10);
    let falhar = true;
    const banco: BancoRanking3 = {
      get: redis!.get.bind(redis!), smembers: redis!.smembers.bind(redis!),
      eval: async (script: string, keys: string[], args: (string | number)[]) => {
        const resultado = await redis!.eval(script, keys, args);
        if (script === FECHAR_LUA && falhar) { falhar = false; throw new Error("resposta perdida após commit"); }
        return resultado;
      },
    };
    await expect(new Ranking3Store(banco, tenant).recuperar(Date.parse(janela.fim), async () => true)).rejects.toThrow("resposta perdida");
    expect(await store.resultado(0)).not.toBeNull();
    expect(await store.carteira(ids[0])).toHaveLength(1);
    await store.recuperar(Date.parse(janela.fim), async () => true);
    expect(await store.carteira(ids[0])).toHaveLength(1);
  });
  it("fonte alterada durante apuração aborta atomicamente e pode ser recuperada", async () => {
    const { tenant, store, ids, janela } = await fixture(10);
    const banco: BancoRanking3 = {
      get: redis!.get.bind(redis!), smembers: redis!.smembers.bind(redis!),
      eval: async (script: string, keys: string[], args: (string | number)[]) => {
        if (script === FECHAR_LUA) await redis!.incr(chaveFonte(tenant));
        return redis!.eval(script, keys, args);
      },
    };
    await expect(new Ranking3Store(banco, tenant).recuperar(Date.parse(janela.fim), async () => true)).rejects.toThrow("fonte_alterada");
    expect(await store.resultado(0)).toBeNull(); expect(await store.carteira(ids[0])).toEqual([]);
    await store.recuperar(Date.parse(janela.fim), async () => true);
    expect(await store.carteira(ids[0])).toHaveLength(1);
  });
  it("índice Redis inválido não deixa resultado ou direito parcialmente gravado", async () => {
    const { store, ids, janela } = await fixture(10);
    await redis!.set(store.chave(`carteira:${ids[0]}`), "tipo-invalido-sintetico");
    await expect(store.recuperar(Date.parse(janela.fim), async () => true)).rejects.toThrow("carteira_inconsistente");
    expect(await store.resultado(0)).toBeNull();
    expect(await store.premio(`${janela.id}-liga-1`)).toBeNull();
    expect(await redis!.get(store.chave("checkpoint"))).toBeNull();
  });
  it("falha de índice durante resgate não muda o estado do direito", async () => {
    const { store, ids, janela } = await fixture(10);
    await store.recuperar(Date.parse(janela.fim), async () => true);
    const [premio] = await store.carteira(ids[0]);
    await redis!.set(store.chave("vinculos"), "tipo-invalido-sintetico");
    await expect(store.transicionar(premio.id, ids[0], "pedido-sintetico", "associado")).rejects.toThrow("concorrencia");
    expect((await store.premio(premio.id))?.estado).toBe("disponivel");
  });
  it("100 alterações do novo ciclo não bloqueiam o fechamento anterior", async () => {
    const { tenant, store, janela } = await fixture(10);
    const banco: BancoRanking3 = {
      get: redis!.get.bind(redis!), smembers: redis!.smembers.bind(redis!),
      eval: async (script, keys, args) => {
        if (script === FECHAR_LUA) {
          await Promise.all(Array.from({ length: 100 }, () => redis!.eval(INVALIDAR_FONTE_LUA, [chaveFonte(tenant), store.chave("fechando")], [Date.parse(janela.fim) + 1])));
        }
        return redis!.eval(script, keys, args);
      },
    };
    expect((await new Ranking3Store(banco, tenant).recuperar(Date.parse(janela.fim), async () => true)).fechados).toBe(1);
    expect((await store.resultado(0))?.campeoes).toHaveLength(1);
  });
  it("lease perdido não autoriza snapshot e não apaga o dono mais novo", async () => {
    const { tenant, store, janela } = await fixture(10);
    const banco: BancoRanking3 = {
      get: redis!.get.bind(redis!), smembers: redis!.smembers.bind(redis!),
      eval: async (script, keys, args) => {
        if (script === FECHAR_LUA) await redis!.set(store.chave("fechando"), "outro-dono-sintetico");
        return redis!.eval(script, keys, args);
      },
    };
    await expect(new Ranking3Store(banco, tenant).recuperar(Date.parse(janela.fim), async () => true)).rejects.toThrow("lease_perdido");
    expect(await store.resultado(0)).toBeNull();
    expect(await redis!.get(store.chave("fechando"))).toBe("outro-dono-sintetico");
    await redis!.del(store.chave("fechando")); // Só a fixture descartável.
    expect((await store.recuperar(Date.parse(janela.fim), async () => true)).fechados).toBe(1);
  });
  it.each([50, 100, 200])("%i solicitações simultâneas: um único pedido pode usar o prêmio", async (total) => {
    const { store, ids, janela } = await fixture(10);
    await store.recuperar(Date.parse(janela.fim), async () => true);
    const [premio] = await store.carteira(ids[0]);
    const inicio = performance.now();
    const tempos: number[] = [];
    const resultados = await Promise.allSettled(Array.from({ length: total }, async (_, i) => {
      const t = performance.now();
      try { return await store.transicionar(premio.id, ids[0], `pedido-${i}`, "associado", Date.parse(janela.fim)); }
      finally { tempos.push(performance.now() - t); }
    }));
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const salvo = await store.premio(premio.id);
    expect(salvo?.estado).toBe("associado");
    expect(await redis!.sismember(store.chave("vinculos"), premio.id)).toBe(1);
    expect(await redis!.zscore(store.chave("avisos"), premio.id)).toBeNull();
    const pedido = salvo!.pedidoId!;
    // Repetir o mesmo pedido é idempotente, mesmo em outra instância.
    await Promise.all(Array.from({ length: 20 }, () => store.transicionar(premio.id, ids[0], pedido, "associado")));
    await store.transicionar(premio.id, ids[0], pedido, "em_preparo");
    await store.transicionar(premio.id, ids[0], pedido, "cancelado", 1000);
    expect((await store.premio(premio.id))?.proximoAvisoEm).toBe(1000 + QUINZE_DIAS);
    expect(await redis!.sismember(store.chave("vinculos"), premio.id)).toBe(0);
    tempos.sort((a, b) => a - b);
    console.info(JSON.stringify({ operacoes: total, pedidosAssociados: 1, duplicados: 0, msTotal: Math.round(performance.now() - inicio), mediaMs: Math.round(tempos.reduce((a, b) => a + b, 0) / total), p95Ms: Math.round(tempos[Math.ceil(total * .95) - 1]) }));
  });
  it("sem elegíveis não inventa prêmio; leitura não fecha nem migra o legado", async () => {
    const { store, janela } = await fixture(5);
    await redis!.set("temporada:resultado:fixture-legado", { campeao: "preservado" });
    expect(await store.atual(Date.parse(janela.fim))).toMatchObject({ indice: 1 });
    expect(await store.resultado(0)).toBeNull();
    await store.recuperar(Date.parse(janela.fim), async () => false);
    expect((await store.resultado(0))?.campeoes).toEqual([]);
    expect(await redis!.get("temporada:resultado:fixture-legado")).toEqual({ campeao: "preservado" });
  });
  it("ledger aceito registra participante e versão na MESMA Lua; lock expirado não grava", async () => {
    vi.stubEnv("RANKING3_ENABLED", "true");
    try {
      const { persistirEstadoPontosSeDono, chaveLockPontos } = await import("../fidelidade");
      const clienteId = `sintetico-${randomUUID()}`;
      const estado = { extrato: [], reservas: [], recompensas: [] };
      expect(await persistirEstadoPontosSeDono(clienteId, "expirado", estado)).toBe(false);
      expect(await redis!.get(`fidelidade:pontos:estado:${clienteId}`)).toBeNull();
      await redis!.set(chaveLockPontos(clienteId), "dono", { ex: 10 });
      expect(await persistirEstadoPontosSeDono(clienteId, "dono", estado)).toBe(true);
      expect(await redis!.sismember(chaveClientes("default"), clienteId)).toBe(1);
      expect(Number(await redis!.get(chaveFonte("default")))).toBeGreaterThan(0);
    } finally { vi.unstubAllEnvs(); }
  });
  it("worker real não chama transporte quando aviso de prêmio perde autorização", async () => {
    vi.stubEnv("RANKING3_ENABLED", "false");
    try {
      const { enfileirarMensagemWhatsapp, processarFilaWhatsapp, obterJobWhatsapp } = await import("../whatsappOutbox");
      const transporte = vi.fn(async () => ({ ok: true, latenciaMs: 0, tentativas: 1 }));
      const { jobId } = await enfileirarMensagemWhatsapp({ phone: "5511900000000", text: "Mensagem sintética", priority: "promocional", rankingPrize: { id: "r3-2026-10-20-0-liga-1", revisao: 0 } });
      await processarFilaWhatsapp(transporte, 1, 1);
      expect(transporte).not.toHaveBeenCalled();
      expect((await obterJobWhatsapp(jobId))?.state).toBe("suppressed");
    } finally { vi.unstubAllEnvs(); }
  });
  it("falha no índice de revisão não apaga controle da notificação ambígua", async () => {
    vi.stubEnv("RANKING3_ENABLED", "true"); vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("VERCEL_PROJECT_ID", VERCEL_PROJECT_CHEFEBOT_OFICIAL);
    try {
      const { reconciliarAvisosPendentes } = await import("./notifications");
      const s = new Ranking3Store(redis!);
      const id = "r3-2099-01-01-0-liga-1", chave = s.chave(`aviso:${id}:1000`);
      await redis!.set(s.chave(`premio:${id}`), { id, clienteId: "sintetico", revisao: 0, proximoAvisoEm: 1000, estado: "disponivel" });
      await redis!.set(chave, { estado: "enfileirado", criadoEm: 1000, jobId: "job-sintetico-ausente", premioId: id, revisao: 0, devidoEm: 1000 });
      await redis!.sadd(s.chave("avisos-reconciliar"), chave);
      await redis!.zadd(s.chave("avisos"), { member: id, score: 1000 });
      await redis!.set(s.chave("avisos-revisao"), "indice-corrompido-sintetico");
      await expect(reconciliarAvisosPendentes(2000)).rejects.toThrow("indice_revisao_indisponivel");
      expect(await redis!.sismember(s.chave("avisos-reconciliar"), chave)).toBe(1);
      expect(await redis!.get(chave)).toMatchObject({ estado: "enfileirado" });
      await redis!.del(s.chave("avisos-revisao")); // Reparação só da fixture.
      await reconciliarAvisosPendentes(2000);
      expect(await redis!.sismember(s.chave("avisos-revisao"), chave)).toBe(1);
      expect(await redis!.sismember(s.chave("avisos-reconciliar"), chave)).toBe(0);
      expect(await redis!.get(chave)).toMatchObject({ estado: "ambiguo" });
    } finally { vi.unstubAllEnvs(); }
  });
  it("checkout integrado ao Redis real: dois retries, um pedido persistido, cancelamento restaura o mesmo direito", async () => {
    vi.stubEnv("RANKING3_ENABLED", "true"); vi.stubEnv("CHEFEBOT_E2E", "1");
    try {
      const { POST } = await import("../../app/api/pedido-app/route");
      const { NextRequest } = await import("next/server");
      const { criarTokenCliente } = await import("../clienteAuth");
      const { mutarPedidos } = await import("../pedidosConcorrencia");
      const { sincronizarPremioDoPedido } = await import("./pedido");
      const s = new Ranking3Store(redis!);
      const telefone = "11900000000", clienteId = `cli_${telefone}`, id = "r3-2098-01-01-0-liga-2";
      await redis!.set(`perfil-cliente:${telefone}`, { clienteId, telefone, nome: "Cliente sintético" });
      await redis!.set(s.chave(`premio:${id}`), { id, temporadaId: "r3-2098-01-01-0", clienteId, liga: 2, tetoCents: 5000, concedidoEm: "2098-01-31T06:00:00Z", estado: "disponivel", revisao: 0, proximoAvisoEm: 1000 });
      await redis!.set("pedidos", []);
      const cookie = await criarTokenCliente({ clienteId, telefone });
      const body = { cliente: "Cliente sintético", telefone, itens: [], tipoEntrega: "retirada", pagamento: "Prêmio (sem cobrança)", clientRequestId: randomUUID(), premioRanking: { id, selecao: { sizeId: "size-f", flavorIds: ["flavor-presunto", "flavor-calabresa"] } } };
      const solicitar = async () => {
        const req = new NextRequest("http://localhost/api/pedido-app", { method: "POST", body: JSON.stringify(body) });
        req.cookies.set("cliente-token", cookie);
        const res = await POST(req);
        expect(res.status).toBe(200); return res.json();
      };
      const a = await solicitar(), b = await solicitar();
      expect(a.pedidoId).toBe(b.pedidoId);
      const pedidos = await redis!.get<Array<{ id: string; premioRankingId: string; telefone: string; total: number; status: string }>>("pedidos");
      expect(pedidos).toHaveLength(1); expect(pedidos![0].total).toBe(0);
      expect((await s.premio(id))?.estado).toBe("associado");
      await mutarPedidos<NonNullable<typeof pedidos>[number], void>((atuais) => ({ persistir: true, pedidos: atuais.map((p) => ({ ...p, status: "cancelado" })), resultado: undefined }));
      await sincronizarPremioDoPedido({ ...pedidos![0], status: "cancelado" });
      expect((await s.premio(id))?.estado).toBe("disponivel");
      expect((await s.premio(id))?.ultimoCancelamentoPedidoId).toBe(a.pedidoId);
    } finally { vi.unstubAllEnvs(); }
  });
});
