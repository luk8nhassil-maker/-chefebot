// E2E real da Gamificação V2 do Ranking do Chefe — correção do ponto 17 da
// auditoria de hardening do #446: "Playwright visual QA do Preview NÃO
// substitui uma E2E de feature". Este arquivo NÃO é uma prova visual — é uma
// jornada completa de um cliente real através de uma temporada inteira,
// usando as implementações REAIS de negócio (fidelidade.ts, temporadas.ts,
// rankingClientes.ts, rankingScoreTemporada[Sync].ts, rankingGamificacao*.ts,
// estrelasIndicacao.ts, rankingBonusTemporada.ts, a rota real do painel) —
// só o Redis é um mock em memória, seguro e descartável, NUNCA um Redis de
// produção nem sequer uma URL real.
//
// Os testes deste arquivo são INTENCIONALMENTE sequenciais e dependentes uns
// dos outros (cada um continua o estado do anterior, como uma jornada real) —
// diferente do resto da suíte, aqui o estado do Redis mock NÃO é resetado a
// cada teste. A ordem de declaração é a ordem de execução.
import { beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  type ZEntry = { score: number; member: string };
  const zsets = new Map<string, ZEntry[]>();

  function zaddImpl(key: string, opts: { score: number; member: string }) {
    let arr = zsets.get(key) ?? [];
    arr = arr.filter((e) => e.member !== opts.member);
    arr.push({ score: opts.score, member: opts.member });
    zsets.set(key, arr);
    return 1;
  }
  function zrangeImpl(key: string, start: number, stop: number, opts?: { rev?: boolean }) {
    let arr = [...(zsets.get(key) ?? [])].sort((a, b) => a.score - b.score);
    if (opts?.rev) arr = arr.reverse();
    const len = arr.length;
    const s = start < 0 ? Math.max(0, len + start) : start;
    const e = stop < 0 ? len + stop + 1 : Math.min(len, stop + 1);
    return arr.slice(s, e).map((x) => x.member);
  }
  function zscoreImpl(key: string, member: string) {
    const arr = zsets.get(key) ?? [];
    const found = arr.find((e) => e.member === member);
    return found ? found.score : null;
  }
  function zrevrankImpl(key: string, member: string) {
    const arr = [...(zsets.get(key) ?? [])].sort((a, b) => b.score - a.score);
    const idx = arr.findIndex((e) => e.member === member);
    return idx === -1 ? null : idx;
  }

  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    }),
    zadd: vi.fn(async (key: string, opts: { score: number; member: string }) => zaddImpl(key, opts)),
    zrange: vi.fn(async (key: string, start: number, stop: number, opts?: { rev?: boolean }) => zrangeImpl(key, start, stop, opts)),
    zscore: vi.fn(async (key: string, member: string) => zscoreImpl(key, member)),
    zrevrank: vi.fn(async (key: string, member: string) => zrevrankImpl(key, member)),
    zrem: vi.fn(async (key: string, member: string) => {
      const arr = zsets.get(key) ?? [];
      const filtrado = arr.filter((e) => e.member !== member);
      zsets.set(key, filtrado);
      return arr.length - filtrado.length;
    }),
    // Cobre os TRÊS formatos de script Lua usados pelos locks: 1 key
    // (compare-and-delete pra liberar); 2 keys + 2 args (fidelidade.ts /
    // rankingIndicacaoConversao.ts persiste-se-dono); 2 keys + 1 arg
    // (rankingIndicacaoConversao.ts apaga-se-dono — BLOCKER 8).
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (store.get(keys[0]) !== args[0]) return 0;
      if (keys.length >= 2 && args.length >= 2) {
        store.set(keys[1], JSON.parse(args[1]));
        for (let i = 2; i < keys.length && i < args.length; i++) {
          store.set(keys[i], i === 2 ? JSON.parse(args[i]) : args[i]);
        }
        return 1;
      }
      if (keys.length >= 2) {
        return store.delete(keys[1]) ? 1 : 0;
      }
      store.delete(keys[0]);
      return 1;
    }),
  };

  return { store, zsets, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

// Autenticação do cliente é a única camada mockada além do Redis — a rota
// real do painel (src/app/api/cliente/fidelidade/painel/route.ts) chama
// lerSessaoCliente/buscarClientePorId antes de qualquer lógica de negócio, e
// simular login/OTP de verdade aqui só adicionaria ruído não relacionado ao
// Ranking. `derivarClienteIdPorTelefone` continua a implementação REAL.
const TELEFONE_A = "11900000001";
const TELEFONE_B = "11900000002";
vi.mock("@/lib/clienteAuth", () => ({
  lerSessaoCliente: vi.fn(async (req: { cookies: { get(n: string): { value: string } | undefined } }) => {
    const token = req.cookies.get("cliente-token")?.value ?? "";
    if (token === "token-a") return { clienteId: "cli_a_login", telefone: TELEFONE_A };
    if (token === "token-b") return { clienteId: "cli_b_login", telefone: TELEFONE_B };
    return null;
  }),
}));
vi.mock("@/lib/clientes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clientes")>();
  return {
    ...actual,
    buscarClientePorId: vi.fn(async (id: string) => {
      if (id === "cli_a_login") return { clienteId: id, telefone: TELEFONE_A, nome: "Cliente A" };
      if (id === "cli_b_login") return { clienteId: id, telefone: TELEFONE_B, nome: "Cliente B" };
      return null;
    }),
  };
});

// Consentimento/privacidade é um subsistema PRÓPRIO, com testes extensos
// dedicados (consentimentoRanking.test.ts, rankingPrivacidade.test.ts) —
// exigir aprovação de texto de consentimento aqui só adicionaria ruído não
// relacionado ao Ranking/Gamificação, que é o que esta E2E prova. Todo
// cliente é tratado como participante autorizado ("Vale prêmio").
vi.mock("./rankingPrivacidade", () => ({
  projetarIdentidadesPublicasRanking: vi.fn(async (ids: string[]) =>
    new Map(ids.map((id) => [id, { participaCampanha: true, nomePublico: null, telefoneMascarado: null, fotoPerfilUrl: null }])),
  ),
  projetarIdentidadePublicaRanking: vi.fn(async () => ({ participaCampanha: true, nomePublico: null, telefoneMascarado: null, fotoPerfilUrl: null })),
}));

import {
  derivarClienteIdPorTelefone,
  registrarMovimentoPontosIdempotente,
  salvarConfigFidelidadePontos,
  obterExtratoPontos,
  calcularSaldoEstrelas,
} from "./fidelidade";
import { REGRA_ESTRELAS_V1 } from "./estrelas";
import { criarTemporada, ativarTemporada, encerrarTemporada } from "./temporadas";
import { garantirResultadoTemporada } from "./temporadaResultado";
import { posicaoClienteRanking } from "./rankingClientes";
import { salvarConfigGamificacao, CONFIG_GAMIFICACAO_PADRAO } from "./rankingGamificacaoConfig";
import { sincronizarMissaoSemanalCliente, consumirMissaoSemanalNoPedido, reverterMissaoSemanalDoPedido, obterEstadoMissaoSemanal } from "./rankingMissaoSemanalEstado";
import { concluirMissaoIndicacaoNoPedido, obterEstadoMissaoIndicacao } from "./rankingMissaoIndicacaoEstado";
import { creditarEstrelasIndicacaoValida } from "./estrelasIndicacao";
import { registrarConversaoIndicacao } from "./rankingIndicacaoConversao";
import { obterBonusCompeticaoDaTemporada } from "./rankingBonusTemporada";
import { obterStatusSocialVigente } from "./rankingTransicaoTemporada";

const TENANT = "default";
const TEMP1 = "temp_e2e_1";
const TEMP2 = "temp_e2e_2";

const CLI_A = derivarClienteIdPorTelefone(TELEFONE_A) as string;
const CLI_B = derivarClienteIdPorTelefone(TELEFONE_B) as string;

async function scoreAtual(tenantId: string, temporadaId: string, clienteId: string): Promise<number> {
  const pos = await posicaoClienteRanking(tenantId, temporadaId, clienteId);
  return pos?.score ?? 0;
}

function abrirPainel(token: string): NextRequest {
  const req = new NextRequest("http://localhost/api/cliente/fidelidade/painel");
  Object.defineProperty(req, "cookies", {
    value: { get: (name: string) => (name === "cliente-token" ? { value: token } : undefined) },
  });
  return req;
}

beforeAll(async () => {
  await salvarConfigFidelidadePontos({
    ativo: true,
    regraVersao: REGRA_ESTRELAS_V1,
    coberturaEconomicaAprovada: true,
    metaEstrelas: 720,
    descricaoRecompensa: "Pizza grátis",
  });
  await salvarConfigGamificacao({
    ...CONFIG_GAMIFICACAO_PADRAO,
    missaoSemanalAtiva: true,
    missaoSemanalMultiplicador: 2,
    missaoSemanalCooldownDias: 7,
    missaoIndicacaoAtiva: true,
    missaoIndicacaoBonus: 8,
    carryoverAtivo: true,
    carryoverTabela: [{ posicao: 1, bonus: 15 }, { posicao: 2, bonus: 8 }],
  });
  await criarTemporada(TENANT, TEMP1, { nome: "Temporada E2E 1" });
  await ativarTemporada(TENANT, TEMP1);
});

describe("E2E real da Gamificação V2 do Ranking (Redis mock descartável, nunca produção)", () => {
  test("1. abrir o ranking pela primeira vez: cliente aparece após o primeiro pedido confirmado", async () => {
    const credito1 = await registrarMovimentoPontosIdempotente(CLI_A, {
      pedidoId: "pedido-e2e-1",
      tipo: "confirmado",
      pontos: 10,
      motivo: "pedido entregue",
      regraVersao: REGRA_ESTRELAS_V1,
      unidade: "estrelas",
    });
    expect(credito1).not.toBeNull();

    const res = await GET_PAINEL("token-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ranking?.posicao).toBe(1);
    expect(body.ranking?.score).toBe(10);
  });

  test("2. missão semanal desbloqueia para cliente fora do pódio com cooldown vencido", async () => {
    // CLI_B entra na frente pra tirar CLI_A do pódio (posição >= 4 é
    // pré-condição real de avaliarDesbloqueioMissaoSemanal).
    for (const [id, pts] of [[CLI_B, 50], ["cli_c", 40], ["cli_d", 30], ["cli_e", 20]] as const) {
      await registrarMovimentoPontosIdempotente(id, {
        pedidoId: `pedido-enche-podio-${id}`,
        tipo: "confirmado",
        pontos: pts,
        motivo: "pedido entregue",
        regraVersao: REGRA_ESTRELAS_V1,
        unidade: "estrelas",
      });
    }
    const posAtual = await posicaoClienteRanking(TENANT, TEMP1, CLI_A);
    expect(posAtual?.posicao).toBeGreaterThanOrEqual(4);

    // O passo 1 (abrir o painel) já batizou (backdating) o "último pedido
    // elegível" de CLI_A com o horário REAL do pedido de lá — o registro
    // nunca é sobrescrito depois disso (regra do próprio produto: nunca
    // inventa nem reescreve uma data já registrada). Simulamos a passagem de
    // tempo avançando `agora` em vez de tentar retroceder essa data.
    const dezDiasDepois = new Date(Date.now() + 10 * 86400000);
    const estado = await sincronizarMissaoSemanalCliente({
      tenantId: TENANT,
      temporadaId: TEMP1,
      clienteId: CLI_A,
      participaCampanha: true,
      posicaoAtual: posAtual?.posicao ?? null,
      agora: dezDiasDepois,
    });
    expect(estado.status).toBe("desbloqueada");
  });

  test("3. um pedido elegível consome a missão e credita o bônus 2x", async () => {
    const resultado = await consumirMissaoSemanalNoPedido({
      tenantId: TENANT,
      temporadaId: TEMP1,
      clienteId: CLI_A,
      pedidoId: "pedido-e2e-missao",
      estrelasBaseDoPedido: 12,
      agora: new Date(),
    });
    // calcularBonusMissaoSemanal = base * (multiplicador - 1) — o bônus é o
    // EXTRA sobre a base (2x total = 1x base + 1x bônus), nunca base*2.
    expect(resultado).toEqual({ consumida: true, bonusCreditado: 12 }); // 12 * (2 - 1)

    // O crédito BASE do pedido é um evento separado (fidelidade.ts) — a
    // missão só decide o bônus, nunca inventa a estrela base sozinha.
    await registrarMovimentoPontosIdempotente(CLI_A, {
      pedidoId: "pedido-e2e-missao",
      tipo: "confirmado",
      pontos: 12,
      motivo: "pedido entregue",
      regraVersao: REGRA_ESTRELAS_V1,
      unidade: "estrelas",
    });

    const estadoMissao = await obterEstadoMissaoSemanal(TENANT, TEMP1, CLI_A);
    expect(estadoMissao.status).toBe("consumida");
  });

  test("4. score da temporada = base + bônus, nunca só um dos dois", async () => {
    const score = await scoreAtual(TENANT, TEMP1, CLI_A);
    expect(score).toBe(34); // 10 (passo 1) + 12 (passo 3, base) + 12 (bônus da missão)
  });

  test("5. o saldo de Estrelas da Fidelidade recebe SÓ a base — nunca o bônus de competição", async () => {
    const extrato = await obterExtratoPontos(CLI_A);
    const saldoFidelidade = calcularSaldoEstrelas(extrato);
    const bonusDaTemporada = await obterBonusCompeticaoDaTemporada(TENANT, TEMP1, CLI_A);
    expect(saldoFidelidade).toBe(22); // 10 + 12, sem o bônus de 12
    expect(bonusDaTemporada).toBe(12);
    expect(saldoFidelidade + bonusDaTemporada).toBe(await scoreAtual(TENANT, TEMP1, CLI_A));
  });

  test("6. reabrir o painel (reload) mantém o bônus — nunca reseta ao reler", async () => {
    const res = await GET_PAINEL("token-a");
    const body = await res.json();
    expect(body.ranking?.score).toBe(34);
    expect(body.gamificacao?.bonusCompeticao).toBe(12);
  });

  test("7. um novo pedido NORMAL (sem consumir missão) nunca apaga o bônus já creditado", async () => {
    await registrarMovimentoPontosIdempotente(CLI_A, {
      pedidoId: "pedido-e2e-normal",
      tipo: "confirmado",
      pontos: 5,
      motivo: "pedido entregue",
      regraVersao: REGRA_ESTRELAS_V1,
      unidade: "estrelas",
    });
    expect(await scoreAtual(TENANT, TEMP1, CLI_A)).toBe(39); // 34 + 5, bônus intacto
  });

  test("8. cancelar o pedido que consumiu a missão estorna a base E o bônus corretamente", async () => {
    await registrarMovimentoPontosIdempotente(CLI_A, {
      pedidoId: "pedido-e2e-missao",
      tipo: "estornado",
      pontos: 12,
      motivo: "pedido cancelado",
      regraVersao: REGRA_ESTRELAS_V1,
      unidade: "estrelas",
    });
    await reverterMissaoSemanalDoPedido("pedido-e2e-missao", "pedido cancelado");

    expect(await scoreAtual(TENANT, TEMP1, CLI_A)).toBe(15); // 39 - 12 (base) - 12 (bônus)
    const estadoMissao = await obterEstadoMissaoSemanal(TENANT, TEMP1, CLI_A);
    expect(estadoMissao.status).toBe("desbloqueada"); // a missão volta a ficar disponível, nunca perdida
  });

  test("9. indicação válida do CLI_A conclui a missão da temporada e credita o bônus de indicação", async () => {
    const credito = await creditarEstrelasIndicacaoValida({
      indicadorId: CLI_A,
      indicadoId: "cli_indicado_1",
      pedidoId: "pedido-e2e-indicacao",
      primeiraCompraComercialValida: true,
    });
    expect(credito).toBe("creditado");
    await registrarConversaoIndicacao({ indicadorId: CLI_A, indicadoId: "cli_indicado_1", pedidoId: "pedido-e2e-indicacao" });

    const resultado = await concluirMissaoIndicacaoNoPedido({
      tenantId: TENANT,
      temporadaId: TEMP1,
      clienteId: CLI_A,
      pedidoId: "pedido-e2e-indicacao",
      agora: new Date(),
    });
    expect(resultado).toEqual({ concluida: true, bonusCreditado: 8 });

    const estado = await obterEstadoMissaoIndicacao(TENANT, TEMP1, CLI_A);
    expect(estado.concluida).toBe(true);
  });

  test("10. retry do mesmo pedido de indicação (efeito reprocessado) nunca duplica o bônus", async () => {
    const scoreAntes = await scoreAtual(TENANT, TEMP1, CLI_A);
    const retryCredito = await creditarEstrelasIndicacaoValida({
      indicadorId: CLI_A,
      indicadoId: "cli_indicado_1",
      pedidoId: "pedido-e2e-indicacao",
      primeiraCompraComercialValida: true,
    });
    expect(retryCredito).toBe("ja_creditado");
    const retryMissao = await concluirMissaoIndicacaoNoPedido({
      tenantId: TENANT,
      temporadaId: TEMP1,
      clienteId: CLI_A,
      pedidoId: "pedido-e2e-indicacao",
      agora: new Date(),
    });
    expect(retryMissao.bonusCreditado).toBe(0); // já estava concluída — retry não credita de novo
    expect(await scoreAtual(TENANT, TEMP1, CLI_A)).toBe(scoreAntes); // score não mudou
  });

  test("11. Top 10 e carryover chegam na nova temporada mesmo sem o vencedor logar (reconciliação disparada por OUTRO cliente)", async () => {
    // Placar final da temporada 1: CLI_B (50) é o #1 real — CLI_A nunca
    // chegou a ser campeão nesta jornada (score final 29, atrás de CLI_B e
    // cli_c). O ponto do teste é justamente esse: o VENCEDOR de verdade
    // (CLI_B) nunca abre o painel dele — é a leitura de OUTRO cliente
    // (CLI_A) que dispara a reconciliação em lote que aplica o carryover e o
    // selo social do CLI_B mesmo assim.
    await encerrarTemporada(TENANT, TEMP1);
    await garantirResultadoTemporada(TENANT, TEMP1);

    await criarTemporada(TENANT, TEMP2, { nome: "Temporada E2E 2" });
    await ativarTemporada(TENANT, TEMP2);

    const resA = await GET_PAINEL("token-a");
    expect(resA.status).toBe(200);

    const statusB = await obterStatusSocialVigente(TENANT, CLI_B);
    expect(statusB?.status).toBe("campeao");
    const bonusCarryoverB = await obterBonusCompeticaoDaTemporada(TENANT, TEMP2, CLI_B);
    expect(bonusCarryoverB).toBe(15); // posição 1 na tabela de carryover configurada
  });
});

async function GET_PAINEL(token: string) {
  const { GET } = await import("@/app/api/cliente/fidelidade/painel/route");
  return GET(abrirPainel(token));
}
