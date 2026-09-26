// ============================================================================
// E2E HTTP REAL — Ranking/Gamificação do Chefe (smoke, item 13 da correção)
// ----------------------------------------------------------------------------
// Complementa (nunca substitui) a suíte Vitest existente
// (src/lib/rankingGamificacaoE2E.test.ts e as dezenas de outros testes desta
// PR), que já cobre exaustivamente a lógica de domínio com um Redis em
// memória. Este script prova a mesma jornada crítica contra:
//   - um Next.js REAL (next dev ou next build && next start), e
//   - um Redis REST LOCAL e descartável, real (nunca produção).
//
// Fluxo mínimo exigido: login isolado de dev → GET painel → ranking →
// missão → efeito seguro simulado → reload → score persistido.
//
// "Efeito seguro simulado" = fluxo real de pedido (POST /api/orders → PATCH
// status=entregue com silent:true), exatamente como a Kellyne usaria no
// painel, só que apontando para o Redis de teste e sem WhatsApp real
// (silent:true pula toda notificação). Nenhum Pix, WhatsApp ou Redis de
// produção é tocado — os guardas abaixo abortam antes de qualquer chamada
// se o ambiente não bater exatamente com o esperado.
//
// Não importa nenhum módulo de src/ — fala com a aplicação só por HTTP
// (fetch nativo) e com o Redis só pela mesma API REST que a aplicação usa em
// produção (mesma convenção de scripts/e2e-cliente-otp.mjs e
// scripts/e2e-entregador-auth.mjs).
//
// Uso local (nesta sessão, sem Docker): ver scripts/run-e2e-ranking-http.sh,
// que sobe redis-server + scripts/local-redis-http-shim.mjs (shim REST
// genérico, só para quando Docker não está disponível) + next dev, roda este
// script e derruba tudo. Em CI (com Docker), o mesmo script HTTP roda contra
// SRH real (serverless-redis-http) + Redis real, como já é feito em
// .github/workflows/entregador-auth-e2e.yml.
//
//   E2E_BASE_URL=http://127.0.0.1:3000 \
//   KV_REST_API_URL=http://127.0.0.1:8079 KV_REST_API_TOKEN=test \
//   node scripts/e2e-ranking-gamificacao-http.mjs
// ============================================================================
import { Redis } from "@upstash/redis";
import { SignJWT } from "jose";

function abortar(motivo) {
  console.error(`[e2e-ranking-http] ABORTADO ANTES DE QUALQUER OPERACAO: ${motivo}`);
  process.exit(1);
}

const PADROES_NUVEM_PROIBIDOS = [
  /upstash\.io/i,
  /upstash\.com/i,
  /vercel-storage\.com/i,
  /\.vercel\.app/i,
  /vercel\.com/i,
  /kv\.vercel/i,
];

function validarAmbiente() {
  const kvUrl = process.env.KV_REST_API_URL || "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(kvUrl)) {
    abortar('KV_REST_API_URL precisa ser um Redis REST LOCAL de teste (127.0.0.1/localhost). Abortando.');
  }
  const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";
  const baseHost = new URL(baseUrl).hostname;
  if (baseHost !== "127.0.0.1" && baseHost !== "localhost") {
    abortar("E2E_BASE_URL precisa apontar para 127.0.0.1/localhost.");
  }
  for (const [chave, valor] of Object.entries(process.env)) {
    if (typeof valor !== "string" || !valor) continue;
    if (PADROES_NUVEM_PROIBIDOS.some((padrao) => padrao.test(valor))) {
      abortar(`a variável de ambiente "${chave}" contém um endpoint de nuvem conhecido — suíte não pode correr contra Production/Preview reais`);
    }
  }
  return { baseUrl, kvUrl };
}

const { baseUrl: BASE, kvUrl: KV_URL } = validarAmbiente();
const redis = new Redis({ url: KV_URL, token: process.env.KV_REST_API_TOKEN || "test" });

let passo = 0;
let falhas = 0;
function check(nome, cond, detalhe = "") {
  passo++;
  const ok = !!cond;
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${String(passo).padStart(2, "0")} ${nome}${ok ? "" : ` — ${String(detalhe).slice(0, 300)}`}`);
}

function cookieDe(res) {
  const raw = res.headers.get("set-cookie") || "";
  const m = raw.match(/cliente-token=([^;]+)/);
  return m ? `cliente-token=${m[1]}` : "";
}

async function mintarTokenAdmin() {
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "chefebot-dev-secret-troque-em-producao");
  return new SignJWT({ username: "e2e-ranking-http", name: "E2E Ranking HTTP", role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(secret);
}

// ---------------------------------------------------------------------------
// Dados de teste — fictícios, isolados por sufixo desta suíte.
// ---------------------------------------------------------------------------
const PHONE = "5599974000692"; // fictício, mesmo padrão de e2e-cliente-otp.mjs
const TOKEN = "cd".repeat(16);
const TEMPORADA_ID = "e2e-ranking-http-temporada";
// R$40 (4000 centavos) cai na faixa [4000,7000) de calcularEstrelasPorValorElegivel
// (src/lib/estrelas.ts) → 5 Estrelas. O valor esperado vem da regra real de
// negócio, nunca de "R$1 = 1 ponto" (essa é a regra do modelo legado).
const TOTAL_PEDIDO = 40;
const ESTRELAS_ESPERADAS = 5;

async function main() {
  const authAdmin = `auth-token=${await mintarTokenAdmin()}`;

  // limpeza de estado de execuções anteriores
  await redis.del(`cliente:${PHONE}`, `cliente:otp:${PHONE}`, `cliente:otp_cooldown:${PHONE}`);

  // -------------------------------------------------------------------------
  // 1) Config real via HTTP admin (equivalente ao que a Kellyne configuraria
  //    no painel): ativa Estrelas (R$1=1 ponto) e cria+ativa uma temporada.
  // -------------------------------------------------------------------------
  const pontosConfig = await fetch(`${BASE}/api/admin/fidelidade/pontos-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: authAdmin },
    body: JSON.stringify({ ativo: true, regraVersao: "estrelas-faixas-v1", metaEstrelas: 50 }),
  });
  check("admin ativa Estrelas (pontos-config) responde 200", pontosConfig.status === 200, String(pontosConfig.status));

  const criarTemporada = await fetch(`${BASE}/api/admin/fidelidade/temporadas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: authAdmin },
    body: JSON.stringify({ acao: "criar", temporadaId: TEMPORADA_ID, nome: "E2E HTTP", duracaoDias: 30 }),
  });
  check("admin cria temporada responde 200/422 (422 se já existe de execução anterior)", [200, 422].includes(criarTemporada.status), String(criarTemporada.status));

  const ativarTemporadaResp = await fetch(`${BASE}/api/admin/fidelidade/temporadas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: authAdmin },
    body: JSON.stringify({ acao: "ativar", temporadaId: TEMPORADA_ID }),
  });
  check("admin ativa a temporada responde 200", ativarTemporadaResp.status === 200, String(ativarTemporadaResp.status));

  // Ativa a missão semanal (Caçada ao Pódio) para que o painel devolva o
  // objeto de missão — sem isto o campo fica null por desenho (fail-closed:
  // ver src/app/api/cliente/fidelidade/painel/route.ts).
  const configGamificacaoResp = await fetch(`${BASE}/api/admin/ranking/gamificacao`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: authAdmin },
    body: JSON.stringify({ missaoSemanalAtiva: true, missaoSemanalMultiplicador: 2, missaoSemanalCooldownDias: 7 }),
  });
  check("admin ativa a missão semanal (2x) responde 200", configGamificacaoResp.status === 200, String(configGamificacaoResp.status));

  // -------------------------------------------------------------------------
  // 2) Login isolado de dev — reaproveita exatamente o fluxo OTP real via
  //    vínculo do WhatsApp (mesma técnica de scripts/e2e-cliente-otp.mjs).
  // -------------------------------------------------------------------------
  await redis.set(`cardapio:token:${TOKEN}`, { phone: PHONE, createdAt: Date.now() }, { ex: 3600 });
  const login = await fetch(`${BASE}/api/cliente/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ waToken: TOKEN }),
  });
  check("login via waToken responde 200", login.status === 200, String(login.status));
  const registroOtp = await redis.get(`cliente:otp:${PHONE}`);
  check("OTP gravado para o cliente de teste", !!registroOtp?.codigo);

  const verificar = await fetch(`${BASE}/api/cliente/verificar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ waToken: TOKEN, codigo: String(registroOtp.codigo) }),
  });
  const cookieCliente = cookieDe(verificar);
  check("verificação do OTP responde 200 com cookie de sessão", verificar.status === 200 && !!cookieCliente, String(verificar.status));

  // -------------------------------------------------------------------------
  // 3) GET painel (antes) — ranking + missão presentes na mesma resposta.
  // -------------------------------------------------------------------------
  const painelAntesResp = await fetch(`${BASE}/api/cliente/fidelidade/painel`, { headers: { cookie: cookieCliente } });
  check("GET painel (antes) responde 200", painelAntesResp.status === 200, String(painelAntesResp.status));
  const painelAntes = await painelAntesResp.json();
  check("painel traz temporada ativa", painelAntes?.temporada?.estado === "ativa", JSON.stringify(painelAntes?.temporada));
  check("painel traz objeto de ranking", "ranking" in painelAntes);
  check("painel traz objeto de gamificação (missão semanal incluída)", !!painelAntes?.gamificacao?.missaoSemanal);

  const saldoAntes = await (await fetch(`${BASE}/api/cliente/fidelidade`, { headers: { cookie: cookieCliente } })).json();
  check("saldo inicial é zero (cliente novo)", saldoAntes?.saldoPontos === 0, JSON.stringify(saldoAntes?.saldoPontos));

  // -------------------------------------------------------------------------
  // 4) Efeito seguro simulado: pedido REAL criado e marcado como entregue via
  //    HTTP admin, com silent:true (nunca dispara WhatsApp real).
  // -------------------------------------------------------------------------
  const criarPedido = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: authAdmin },
    body: JSON.stringify({
      cliente: "Cliente E2E Ranking HTTP",
      telefone: PHONE,
      itens: ["1x Pizza Família (E2E)"],
      total: TOTAL_PEDIDO,
      tipoEntrega: "retirada",
    }),
  });
  check("criação do pedido (admin) responde 201", criarPedido.status === 201, String(criarPedido.status));
  const pedido = await criarPedido.json();
  check("pedido criado tem id", typeof pedido?.id === "string" && pedido.id.length > 0);
  // Nenhum "pagamento" foi enviado no body → criarPixMetadata nunca gera
  // metadata de Pix para este pedido (prova de que a jornada não cria Pix
  // real; ver src/lib/pix.ts:criarPixMetadata/temPixNoPagamento).
  check("pedido criado NÃO tem metadata de Pix (nenhum pagamento foi informado)", pedido?.pix === undefined, JSON.stringify(pedido?.pix));

  const entregarPedido = await fetch(`${BASE}/api/orders`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: authAdmin },
    body: JSON.stringify({ id: pedido.id, status: "entregue", silent: true }),
  });
  check("marcar pedido como entregue (silent) responde 200", entregarPedido.status === 200, String(entregarPedido.status));
  const entregueBody = await entregarPedido.json();
  // silent:true pula toda notificação ao cliente (WhatsApp) e a impressão
  // automática só dispara na transição novo→em_preparo (nunca novo→entregue,
  // que é o que este E2E faz) — nenhum aviso operacional de falha de envio
  // é esperado aqui, o que corrobora que nenhuma tentativa de envio ocorreu.
  check("PATCH silent:true não reporta nenhum aviso operacional de WhatsApp/impressão", !entregueBody?.avisoOperacional, JSON.stringify(entregueBody?.avisoOperacional));

  // -------------------------------------------------------------------------
  // 5) Reload — score persistido no Redis real, lido de volta por HTTP real.
  // -------------------------------------------------------------------------
  const saldoDepoisResp = await fetch(`${BASE}/api/cliente/fidelidade`, { headers: { cookie: cookieCliente } });
  check("GET saldo (reload 1) responde 200", saldoDepoisResp.status === 200, String(saldoDepoisResp.status));
  const saldoDepois = await saldoDepoisResp.json();
  check(`saldo refletiu o pedido entregue (esperado ${ESTRELAS_ESPERADAS} Estrelas p/ R$${TOTAL_PEDIDO})`, saldoDepois?.saldoPontos === ESTRELAS_ESPERADAS, JSON.stringify(saldoDepois?.saldoPontos));

  const painelDepoisResp = await fetch(`${BASE}/api/cliente/fidelidade/painel`, { headers: { cookie: cookieCliente } });
  const painelDepois = await painelDepoisResp.json();
  check("painel (reload 1) reflete o mesmo saldo/score no ranking", painelDepois?.ranking?.score === ESTRELAS_ESPERADAS, JSON.stringify(painelDepois?.ranking?.score));

  // segundo reload — prova que é persistência real, não um efeito de memória
  // de uma única resposta.
  const saldoReload2 = await (await fetch(`${BASE}/api/cliente/fidelidade`, { headers: { cookie: cookieCliente } })).json();
  check("saldo permanece igual num segundo reload (persistido, não transiente)", saldoReload2?.saldoPontos === ESTRELAS_ESPERADAS, JSON.stringify(saldoReload2?.saldoPontos));

  console.log(falhas === 0 ? "\nE2E ranking-gamificacao-http: TODOS OS PASSOS PASSARAM" : `\nE2E ranking-gamificacao-http: ${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[e2e-ranking-http] ERRO INESPERADO:", err);
  process.exit(1);
});
