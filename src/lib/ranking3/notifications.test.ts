import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Premio } from "./domain";
import type { JobOutboxWhatsapp } from "../whatsappOutbox";

const m = vi.hoisted(() => ({ dados: new Map<string, unknown>(), premios: new Map<string, Premio>(), jobs: new Map<string, Partial<JobOutboxWhatsapp>>(), enfileirar: vi.fn(), optOut: false, telefone: "5511900000000" }));
vi.mock("../redis", () => {
  const conjunto = (k: string) => { const valor = m.dados.get(k); return valor instanceof Set ? valor as Set<string> : new Set<string>(); };
  function multi() {
    const ops: (() => void)[] = [];
    const tx = {
      set(k: string, v: unknown, opts?: { nx?: boolean }) { ops.push(() => { if (!opts?.nx || !m.dados.has(k)) m.dados.set(k, v); }); return tx; },
      sadd(k: string, v: string) { ops.push(() => { const s = conjunto(k); s.add(v); m.dados.set(k, s); }); return tx; },
      srem(k: string, v: string) { ops.push(() => { const s = conjunto(k); s.delete(v); m.dados.set(k, s); }); return tx; },
      async exec() { for (const op of ops) op(); return []; },
    }; return tx;
  }
  return { redis: {
  multi,
  smembers: async (k: string) => [...conjunto(k)],
  srem: async (k: string, v: string) => conjunto(k).delete(v),
  get: async (k: string) => m.dados.get(k) ?? null,
  set: async (k: string, v: unknown, opts?: { nx?: boolean }) => { if (opts?.nx && m.dados.has(k)) return null; m.dados.set(k, v); return "OK"; },
  zrange: async (_k: string, _inicio: number, _fim: number, opts: { offset: number; count: number }) => [...m.premios.keys()].slice(opts.offset, opts.offset + opts.count),
  eval: async (script: string, keys: string[], args: (string | number)[]) => {
    if (keys.length === 5) { m.dados.set(keys[0], JSON.parse(String(args[0]))); conjunto(keys[4]).delete(keys[0]); return 1; }
    if (script.includes("local atual")) {
      const p = [...m.premios.values()].find((p) => keys[0].endsWith(p.id));
      if (!p || p.revisao !== args[0]) return 0;
      m.premios.set(p.id, JSON.parse(String(args[1]))); return 1;
    }
    if (m.dados.get(keys[0]) === args[0]) m.dados.delete(keys[0]);
    return 1;
  },
} }; });
vi.mock("./server", () => ({ ranking3Ativo: () => true, ranking3: () => ({ chave: (s: string) => `r3:${s}`, premio: async (id: string) => m.premios.get(id) ?? null }) }));
vi.mock("../rankingConviteWhatsapp", () => ({ clienteTemOptOutConviteRankingWhatsapp: async () => m.optOut }));
vi.mock("../clientes", () => ({ buscarClientePorId: async () => ({ telefone: m.telefone, nome: "Cliente sintético" }) }));
vi.mock("../whatsappOutbox", () => ({
  configuracaoOutboxWhatsapp: () => ({ ready: true }), agendarDrenoWhatsapp: vi.fn(async () => true),
  enfileirarMensagemWhatsapp: m.enfileirar, obterJobWhatsapp: async (id: string) => m.jobs.get(id) ?? null,
}));
import { agendarAvisoExcepcionalPrimeiraTemporada, autorizarJobPremio, processarAvisosRanking3 } from "./notifications";
import { VERCEL_PROJECT_CHEFEBOT_OFICIAL } from "../vercelProjeto";

const agora = Date.parse("2026-11-19T21:00:00Z");
const inicial: Premio = { id: "r3-2026-10-20-0-liga-1", temporadaId: "r3-2026-10-20-0", clienteId: "sintetico", liga: 1, tetoCents: 4700, concedidoEm: new Date(agora).toISOString(), estado: "disponivel", proximoAvisoEm: agora, revisao: 0 };
const chaveAviso = () => `r3:aviso:${inicial.id}:${agora}`;
beforeEach(() => {
  vi.unstubAllEnvs(); vi.clearAllMocks(); m.dados.clear(); m.jobs.clear(); m.premios.clear(); m.optOut = false; m.telefone = "5511900000000";
  vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("VERCEL_PROJECT_ID", VERCEL_PROJECT_CHEFEBOT_OFICIAL);
  vi.stubEnv("RANKING3_PRIZE_NOTIFICATIONS_ENABLED", "true"); vi.stubEnv("RANKING3_PROACTIVE_POLICY_APPROVED", "true");
  m.dados.set("config:pizzaria", { horaAbertura: 18, horaFechamento: 23 });
  m.premios.set(inicial.id, { ...inicial });
  m.enfileirar.mockResolvedValue({ jobId: "job-sintetico" });
});

describe("Ranking3 — aviso da concessão excepcional antiga", () => {
  const premioId = "r3-legado-t-1789830947840-liga-1";
  const temporadaId = "t-1789830947840";
  const chaveMarcador = `r3:concessao-excepcional:${temporadaId}`;
  function premioHistorico(estado: Premio["estado"] = "disponivel"): Premio {
    return {
      ...inicial, id: premioId, temporadaId, origem: "excecao_historica",
      estado, proximoAvisoEm: Number.MAX_SAFE_INTEGER,
    };
  }
  function configurar(premio = premioHistorico()) {
    m.premios.clear();
    m.premios.set(premioId, premio);
    m.dados.set(chaveMarcador, {
      versao: 1, motivo: "concessao_excepcional_primeira_temporada",
      temporadaId, clienteId: "sintetico",
    });
  }
  it("agenda e enfileira exatamente uma vez sem reatribuir o prêmio", async () => {
    configurar();
    expect((await processarAvisosRanking3(agora)).enfileirados).toBe(1);
    expect(m.premios.get(premioId)).toMatchObject({ estado: "disponivel", revisao: 1, proximoAvisoEm: agora });
    expect(m.enfileirar).toHaveBeenCalledWith(expect.objectContaining({
      rankingPrize: { id: premioId, revisao: 1 },
    }));
    await processarAvisosRanking3(agora);
    expect(m.enfileirar).toHaveBeenCalledTimes(1);
  });
  it("bloqueia sem marcador legítimo, em pedido ativo ou flag desligada", async () => {
    configurar();
    m.dados.delete(chaveMarcador);
    expect(await agendarAvisoExcepcionalPrimeiraTemporada(agora)).toBe(false);
    expect(m.premios.get(premioId)?.proximoAvisoEm).toBe(Number.MAX_SAFE_INTEGER);
    configurar(premioHistorico("em_preparo"));
    expect(await agendarAvisoExcepcionalPrimeiraTemporada(agora)).toBe(false);
    configurar();
    vi.stubEnv("RANKING3_PRIZE_NOTIFICATIONS_ENABLED", "");
    expect(await agendarAvisoExcepcionalPrimeiraTemporada(agora)).toBe(false);
    expect(m.enfileirar).not.toHaveBeenCalled();
    expect(m.premios.get(premioId)?.proximoAvisoEm).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("não reabre aviso com marcador associado ao cliente errado", async () => {
    configurar();
    m.dados.set(chaveMarcador, {
      versao: 1, motivo: "concessao_excepcional_primeira_temporada",
      temporadaId, clienteId: "outro-cliente",
    });
    expect(await agendarAvisoExcepcionalPrimeiraTemporada(agora)).toBe(false);
    expect(m.enfileirar).not.toHaveBeenCalled();
  });
});

describe("Ranking3 — avisos na outbox, sem transporte real", () => {
  it.each(["preview", "development"])("bloqueia completamente o ambiente %s", async (ambiente) => {
    vi.stubEnv("VERCEL_ENV", ambiente);
    expect((await processarAvisosRanking3(agora)).desativado).toBe(true); expect(m.enfileirar).not.toHaveBeenCalled();
  });
  it("padrão desligado, nunca habilita público geral", async () => {
    vi.stubEnv("RANKING3_PRIZE_NOTIFICATIONS_ENABLED", "");
    await processarAvisosRanking3(agora); expect(m.enfileirar).not.toHaveBeenCalled();
  });
  it("enfileira o vencedor já apurado, com copy e guard de negócio", async () => {
    expect((await processarAvisosRanking3(agora)).enfileirados).toBe(1);
    expect(m.enfileirar).toHaveBeenCalledWith(expect.objectContaining({ priority: "normal", rankingPrize: { id: inicial.id, revisao: 0 }, expiresAt: agora + 120000 }));
    await processarAvisosRanking3(agora); expect(m.enfileirar).toHaveBeenCalledTimes(1);
  });
  it.each(["optout", "pausa", "numero_invalido", "sem_politica", "sem_expediente"])("suprime %s sem consumir direito", async (caso) => {
    if (caso === "optout") m.optOut = true;
    if (caso === "pausa") m.dados.set("bot_ativo", false);
    if (caso === "numero_invalido") m.telefone = "numero-invalido";
    if (caso === "sem_politica") vi.stubEnv("RANKING3_PROACTIVE_POLICY_APPROVED", "");
    if (caso === "sem_expediente") m.dados.delete("config:pizzaria");
    await processarAvisosRanking3(agora); expect(m.enfileirar).not.toHaveBeenCalled(); expect(m.premios.get(inicial.id)?.estado).toBe("disponivel");
  });
  it.each(["2026-11-19T20:59:59Z", "2026-11-20T02:00:00Z"])("não envia fora do expediente %s", async (hora) => {
    await processarAvisosRanking3(Date.parse(hora)); expect(m.enfileirar).not.toHaveBeenCalled();
  });
  it("aceitação da fila não é envio; confirmação real encerra o aviso", async () => {
    await processarAvisosRanking3(agora);
    expect(m.premios.get(inicial.id)?.proximoAvisoEm).toBe(agora);
    m.jobs.set("job-sintetico", { state: "delivered", updatedAt: agora + 100 });
    expect((await processarAvisosRanking3(agora + 200)).enviados).toBe(1);
    expect(m.premios.get(inicial.id)?.proximoAvisoEm).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each(["ambiguous", "missing"])("resultado %s entra em revisão e não é reenviado", async (estado) => {
    await processarAvisosRanking3(agora);
    if (estado !== "missing") m.jobs.set("job-sintetico", { state: "ambiguous" });
    await processarAvisosRanking3(agora + 1); await processarAvisosRanking3(agora + 2);
    expect(m.enfileirar).toHaveBeenCalledTimes(1); expect(m.dados.get(chaveAviso())).toMatchObject({ estado: "ambiguo" });
  });
  it("crash entre enqueue e vínculo não repete depois da janela segura de dedupe", async () => {
    m.dados.set(chaveAviso(), { estado: "preparado", criadoEm: agora - 86400001 });
    await processarAvisosRanking3(agora); expect(m.enfileirar).not.toHaveBeenCalled(); expect(m.dados.get(chaveAviso())).toMatchObject({ estado: "ambiguo" });
  });
  it("worker suprime tarefa antiga depois do checkout, preparo, opt-out ou pausa", async () => {
    const job = { phone: "5511900000000", rankingPrize: { id: inicial.id, revisao: 0 } } as JobOutboxWhatsapp;
    expect(await autorizarJobPremio(job, agora)).toBe(true);
    m.premios.set(inicial.id, { ...inicial, estado: "em_preparo", revisao: 1 });
    expect(await autorizarJobPremio(job, agora)).toBe(false);
    m.premios.set(inicial.id, { ...inicial }); m.optOut = true;
    expect(await autorizarJobPremio(job, agora)).toBe(false);
    m.optOut = false; m.dados.set("bot_ativo", false);
    expect(await autorizarJobPremio(job, agora)).toBe(false);
  });
  it("vários prêmios do mesmo cliente não geram bombardeio", async () => {
    m.premios.set("r3-2026-10-20-1-liga-2", { ...inicial, id: "r3-2026-10-20-1-liga-2", liga: 2 });
    await processarAvisosRanking3(agora); expect(m.enfileirar).toHaveBeenCalledTimes(1);
  });
  it("expiração comprovada ANTES do provider é recuperada no próximo expediente", async () => {
    await processarAvisosRanking3(agora);
    m.jobs.set("job-sintetico", { state: "expired", result: { motivo: "expired_before_provider_send" } });
    await processarAvisosRanking3(agora + 1);
    expect(m.premios.get(inicial.id)?.proximoAvisoEm).toBe(agora + 1 + 86400000);
    expect(m.enfileirar).toHaveBeenCalledTimes(1);
  });
  it("reconcilia envio depois do checkout sem reativar lembrete incompatível", async () => {
    await processarAvisosRanking3(agora);
    m.premios.set(inicial.id, { ...inicial, estado: "associado", pedidoId: "pedido-sintetico", revisao: 1 });
    m.jobs.set("job-sintetico", { state: "delivered", updatedAt: agora + 100 });
    expect((await processarAvisosRanking3(agora + 200)).enviados).toBe(1);
    expect(m.premios.get(inicial.id)?.estado).toBe("associado");
    expect(m.dados.get(chaveAviso())).toMatchObject({ estado: "enviado" });
  });
  it("página de 50 devidos não deixa outros prêmios esquecidos indefinidamente", async () => {
    for (let i = 1; i <= 51; i++) m.premios.set(`sintetico-${i}`, { ...inicial, id: `sintetico-${i}` });
    m.optOut = true;
    await processarAvisosRanking3(agora);
    expect(m.dados.get("r3:avisos-cursor")).toBe(50);
    await processarAvisosRanking3(agora + 1);
    expect(m.dados.get("r3:avisos-cursor")).toBe(0);
    expect(m.enfileirar).not.toHaveBeenCalled();
  });
});
