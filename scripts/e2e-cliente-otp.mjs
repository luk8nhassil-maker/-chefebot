// ============================================================================
// E2E — Perfil 3.0: OTP pelo vínculo do WhatsApp (fluxo real, sem mocks)
// ----------------------------------------------------------------------------
// Roda contra um Next.js REAL (npm run build && npm start) apontando para um
// Redis REST LOCAL descartável (SRH ou equivalente) via KV_REST_API_URL.
// Nunca aponte para um Redis de produção: o script se recusa a rodar se a URL
// não for localhost/127.0.0.1. O OTP é capturado direto do Redis de teste —
// possível somente porque o Redis é local e descartável.
//
// Uso:
//   KV_REST_API_URL=http://127.0.0.1:8079 KV_REST_API_TOKEN=test \
//   E2E_BASE_URL=http://localhost:3000 node scripts/e2e-cliente-otp.mjs
// ============================================================================
import { Redis } from "@upstash/redis";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const KV_URL = process.env.KV_REST_API_URL || "";

if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(KV_URL)) {
  console.error("[e2e-cliente-otp] KV_REST_API_URL precisa ser um Redis REST LOCAL de teste. Abortando.");
  process.exit(2);
}

const redis = new Redis({ url: KV_URL, token: process.env.KV_REST_API_TOKEN || "test" });

const PHONE = "5599974000691"; // fictício, mesmo padrão dos testes unitários
const PHONE_ADULTERADO = "11999990000";
const TOKEN = "ab".repeat(16);

function mascarar(valor) {
  return String(valor).replace(new RegExp(PHONE, "g"), `…${PHONE.slice(-4)}`);
}

let passo = 0;
let falhas = 0;
function check(nome, cond, detalhe = "") {
  passo++;
  const ok = !!cond;
  if (!ok) falhas++;
  console.log(`${ok ? "PASS" : "FAIL"} ${String(passo).padStart(2, "0")} ${nome}${ok ? "" : ` — ${mascarar(detalhe)}`}`);
}

function cookieDe(res) {
  const raw = res.headers.get("set-cookie") || "";
  const m = raw.match(/cliente-token=([^;]+)/);
  return m ? `cliente-token=${m[1]}` : "";
}

// limpeza de estado de execuções anteriores
await redis.del(`cliente:${PHONE}`, `cliente:otp:${PHONE}`, `cliente:otp_cooldown:${PHONE}`, `cliente:otp:${PHONE_ADULTERADO}`);

// 1. token válido do cardápio para um telefone
await redis.set(`cardapio:token:${TOKEN}`, { phone: PHONE, createdAt: Date.now() }, { ex: 3600 });

// 2. reconhecimento: só máscaras chegam ao navegador
const sessao = await (await fetch(`${BASE}/api/cardapio-whatsapp-session?t=${TOKEN}`)).json();
check("token valido reconhece o WhatsApp (mascarado)", sessao.ok && sessao.phoneMascarado && !JSON.stringify(sessao).includes(PHONE), JSON.stringify(sessao));

// 3. OTP solicitado via waToken; telefone adulterado do body é ignorado
const login = await fetch(`${BASE}/api/cliente/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ waToken: TOKEN, telefone: PHONE_ADULTERADO }),
});
check("login via waToken responde 200", login.status === 200, String(login.status));
const registroOtp = await redis.get(`cliente:otp:${PHONE}`);
check("OTP gravado para o phone do token", !!registroOtp?.codigo);
check("nenhum OTP para o telefone adulterado", (await redis.get(`cliente:otp:${PHONE_ADULTERADO}`)) === null);

// 4. captura do OTP — somente possível no Redis local de teste
const codigo = String(registroOtp.codigo);

// 5. verificação via waToken (telefone adulterado continua ignorado)
const verificar = await fetch(`${BASE}/api/cliente/verificar`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ waToken: TOKEN, telefone: PHONE_ADULTERADO, codigo }),
});
const verificarBody = await verificar.json();
const cookieFetch = cookieDe(verificar);
check("codigo valido responde 200", verificar.status === 200, String(verificar.status));
check("resposta traz cookie de sessao HttpOnly", cookieFetch && (verificar.headers.get("set-cookie") || "").includes("HttpOnly"));
check("cliente novo vem sem nome (etapa do nome no front)", verificarBody?.cliente?.nome === null, JSON.stringify(verificarBody));
check("resposta nao expoe o telefone completo", !JSON.stringify(verificarBody).includes(PHONE));
check("resposta traz ticket de ativacao por navegacao", /^[a-f0-9]{32}$/.test(verificarBody?.ticket || ""));
check("resposta traz sessao opaca (fallback Bearer), sem dado do cliente", /^[a-f0-9]{32}$/.test(verificarBody?.sessao || "") && !String(verificarBody?.sessao).includes(PHONE.slice(-8)));

// 6. sessao criada via cookie do fetch funciona (navegadores normais)
const perfil = await fetch(`${BASE}/api/cliente/perfil`, { headers: { cookie: cookieFetch } });
check("perfil abre com a sessao do cookie de fetch", perfil.status === 200, String(perfil.status));

// 6b. fallback Bearer: perfil abre SEM cookie nenhum, so com a sessao opaca
const perfilBearer = await fetch(`${BASE}/api/cliente/perfil`, { headers: { authorization: `Bearer ${verificarBody.sessao}` } });
check("perfil abre via Authorization Bearer (navegador sem cookie)", perfilBearer.status === 200, String(perfilBearer.status));
// 7. replay: o mesmo codigo nao pode ser reutilizado
const replay = await fetch(`${BASE}/api/cliente/verificar`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ waToken: TOKEN, codigo }),
});
check("codigo usado e recusado (401)", replay.status === 401, String(replay.status));

// 8. fallback WKWebView: ativacao por navegacao com o ticket (uso unico)
const ativar = await fetch(`${BASE}/api/cliente/sessao?tk=${verificarBody.ticket}`, { redirect: "manual" });
const cookieNav = cookieDe(ativar);
check("ticket ativa sessao em resposta de navegacao (303 + cookie)", ativar.status === 303 && !!cookieNav, `${ativar.status}`);
check("cliente novo redireciona para o cadastro do nome", (ativar.headers.get("location") || "").includes("/cliente?cadastro=nome"), String(ativar.headers.get("location")));
const reuso = await fetch(`${BASE}/api/cliente/sessao?tk=${verificarBody.ticket}`, { redirect: "manual" });
check("ticket reusado nao emite cookie", !cookieDe(reuso));

// 9. nome via PATCH com a sessao da navegacao
const patch = await fetch(`${BASE}/api/cliente/perfil`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", cookie: cookieNav },
  body: JSON.stringify({ nome: "Cliente E2E" }),
});
check("PATCH do nome funciona com a sessao da navegacao", patch.status === 200, String(patch.status));
const perfil2 = await (await fetch(`${BASE}/api/cliente/perfil`, { headers: { cookie: cookieNav } })).json();
check("nome salvo aparece no perfil", perfil2?.cliente?.nome === "Cliente E2E", JSON.stringify(perfil2?.cliente?.nome));

// 9b. nome e logout via Bearer (depois do passo do cadastro, para nao
// poluir o teste de "cliente novo" acima)
const patchBearer = await fetch(`${BASE}/api/cliente/perfil`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", authorization: `Bearer ${verificarBody.sessao}` },
  body: JSON.stringify({ nome: "Cliente Bearer" }),
});
check("PATCH do nome funciona via Bearer", patchBearer.status === 200, String(patchBearer.status));
const logoutBearer = await fetch(`${BASE}/api/cliente/logout`, { method: "POST", headers: { authorization: `Bearer ${verificarBody.sessao}` } });
check("logout revoga a sessao opaca", logoutBearer.status === 200);
const posLogout = await fetch(`${BASE}/api/cliente/perfil`, { headers: { authorization: `Bearer ${verificarBody.sessao}` } });
check("sessao opaca revogada nao autentica mais", posLogout.status === 401, String(posLogout.status));

// 10. cooldown de reenvio
const reenvio = await fetch(`${BASE}/api/cliente/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ waToken: TOKEN }),
});
check("cooldown de reenvio responde 429", reenvio.status === 429, String(reenvio.status));

// 11. fluxo manual continua funcionando (outro telefone, sem token)
const TEL_MANUAL = "86988887777";
await redis.del(`cliente:${TEL_MANUAL}`, `cliente:otp:${TEL_MANUAL}`, `cliente:otp_cooldown:${TEL_MANUAL}`);
await fetch(`${BASE}/api/cliente/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ telefone: TEL_MANUAL }),
});
const otpManual = await redis.get(`cliente:otp:${TEL_MANUAL}`);
const verManual = await fetch(`${BASE}/api/cliente/verificar`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ telefone: TEL_MANUAL, codigo: String(otpManual?.codigo || "") }),
});
check("fluxo manual autentica normalmente", verManual.status === 200, String(verManual.status));

console.log(falhas === 0 ? "\nE2E cliente-otp: TODOS OS PASSOS PASSARAM" : `\nE2E cliente-otp: ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
