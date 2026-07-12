import { NextRequest, NextResponse } from "next/server";
import { salvarStatusConexao } from "@/lib/conexaoWhatsapp";
import { verifyToken } from "@/lib/auth";
import { extrairQrBase64, ehErroPlataformaIndisponivel, mensagemErroEvolution } from "@/lib/evolutionApi";

const _baseUrl    = process.env.EVOLUTION_API_URL ?? "evolution-api-production-8f99.up.railway.app";
const BASE        = _baseUrl.startsWith("http") ? _baseUrl : `https://${_baseUrl}`;
const KEY         = process.env.EVOLUTION_API_KEY!;
const INSTANCE    = "chefebot";
const WEBHOOK_URL = "https://chefebot-pjif.vercel.app/api/whatsapp";

const CONNECT_MAX_TENTATIVAS = 10;
const CONNECT_INTERVALO_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sem cookie ou token invalido/expirado -> 401 (sem sessao).
// Sessao valida mas papel sem permissao -> 403.
// Papel autorizado -> segue normalmente.
async function checkAuth(req: NextRequest): Promise<{ status: 401 | 403 } | { status: 200; role: string }> {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return { status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { status: 401 };
  if (!["admin", "dev"].includes(payload.role as string)) return { status: 403 };
  return { status: 200, role: payload.role as string };
}

/**
 * Tenta obter o QR chamando /instance/connect/{instance}, com retry
 * limitado: a instância recém-criada pode levar um instante para ficar
 * pronta para gerar QR. Para no primeiro QR encontrado; nunca tenta de
 * novo em 401/403 (erro de credencial, retry não resolve); tenta de novo
 * em 404/409 transitório ou resposta sem QR ainda.
 */
async function conectarComRetry(): Promise<
  { ok: true; base64: string; qrData: Record<string, unknown> } | { ok: false; status: number; data: unknown }
> {
  let ultimoStatus = 0;
  let ultimoData: unknown = {};

  for (let tentativa = 1; tentativa <= CONNECT_MAX_TENTATIVAS; tentativa++) {
    const connRes = await fetch(`${BASE}/instance/connect/${INSTANCE}`, {
      headers: { apikey: KEY },
      cache: "no-store",
    });
    const qrData = await connRes.json().catch(() => ({}));
    const base64 = extrairQrBase64(qrData);
    console.log(
      "[RESET] connect tentativa",
      tentativa,
      "status:",
      connRes.status,
      "has base64:",
      !!base64,
      "keys:",
      Object.keys(qrData || {}).join(",")
    );

    if (base64) return { ok: true, base64, qrData };

    ultimoStatus = connRes.status;
    ultimoData = qrData;

    // Credencial/permissão errada — repetir não muda o resultado.
    if (connRes.status === 401 || connRes.status === 403) break;

    if (tentativa < CONNECT_MAX_TENTATIVAS) await sleep(CONNECT_INTERVALO_MS);
  }

  return { ok: false, status: ultimoStatus, data: ultimoData };
}

// Reseta a instância inteira (logout+delete+create) — mais destrutivo que o
// simples "escanear QR", por isso restrito a admin/dev (nunca atendente).
export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (auth.status === 401) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.status === 403) return NextResponse.json({ error: "Sem permissao" }, { status: 403 });

  try {
    // 1) Logout (ignora erro — pode já estar desconectada; instância pode
    // nem existir ainda, o que também é normal aqui)
    const logoutRes = await fetch(`${BASE}/instance/logout/${INSTANCE}`, {
      method: "DELETE",
      headers: { apikey: KEY },
      cache: "no-store",
    }).catch(() => null);
    console.log("[RESET] logout:", logoutRes?.status ?? "network-error");

    // 2) Deletar instância completamente (404 aqui é esperado quando a
    // instância já não existe — segue normalmente para o create)
    const deleteRes = await fetch(`${BASE}/instance/delete/${INSTANCE}`, {
      method: "DELETE",
      headers: { apikey: KEY },
      cache: "no-store",
    }).catch(() => null);
    const deleteData = await deleteRes?.json().catch(() => ({}));
    console.log("[RESET] delete:", deleteRes?.status ?? "network-error", JSON.stringify(deleteData ?? {}).slice(0, 200));

    // 401/403 no delete é erro de credencial — nunca um estado normal do
    // fluxo (diferente de "instância não existe"). Não faz sentido
    // continuar tentando criar/conectar com a mesma credencial inválida.
    if (deleteRes && (deleteRes.status === 401 || deleteRes.status === 403)) {
      console.error("[RESET] delete falhou por credencial/permissão:", deleteRes.status);
      return NextResponse.json(
        { ok: false, error: "Falha de autenticação com a Evolution API (verifique EVOLUTION_API_KEY)", step: "delete" },
        { status: 502 }
      );
    }

    // Host inteiro fora do ar (EVOLUTION_API_URL aponta pra um serviço que não
    // responde) — todas as chamadas dão o mesmo 404 genérico da borda do
    // Railway, não importa o caminho. Encerra aqui em vez de insistir em
    // create/connect contra o mesmo host inacessível.
    if (deleteRes && ehErroPlataformaIndisponivel(deleteRes.status, deleteData)) {
      console.error("[RESET] host da Evolution API inacessível (detectado no delete)");
      return NextResponse.json(
        { ok: false, error: mensagemErroEvolution(deleteRes.status, deleteData), step: "delete" },
        { status: 502 }
      );
    }

    // 3) Pausa o bot imediatamente
    await salvarStatusConexao("disconnected");

    // 4) Criar nova instância limpa
    const createRes = await fetch(`${BASE}/instance/create`, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ instanceName: INSTANCE, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
      cache: "no-store",
    });
    const createData = await createRes.json().catch(() => ({}));
    console.log("[RESET] create:", createRes.status, JSON.stringify(createData).slice(0, 200));

    // A própria resposta do create já pode trazer o QR (algumas versões da
    // Evolution API retornam o QR direto na criação quando qrcode:true).
    const base64DoCreate = createRes.ok ? extrairQrBase64(createData) : null;

    if (!createRes.ok) {
      // "Já existe" (nome em uso) não é uma falha real — a instância existe,
      // só não foi recriada agora. Em vez de falhar, tenta conectar na que
      // já está lá (sem loop: uma única tentativa alternativa, depois segue
      // pro fluxo normal de connect-com-retry mais abaixo).
      const jaExiste = (createRes.status === 403 || createRes.status === 409) && !ehErroPlataformaIndisponivel(createRes.status, createData);
      if (!jaExiste) {
        console.error("[RESET] create failed:", JSON.stringify(createData));
        const mensagem = mensagemErroEvolution(createRes.status, createData);
        return NextResponse.json({ ok: false, error: mensagem, step: "create" }, { status: 502 });
      }
      console.log("[RESET] create: instância já existe, seguindo para conectar na existente");
    }

    // 5) Configurar webhook na nova instância (best-effort — se falhar, o QR
    // ainda pode ser obtido; o admin resolve o webhook depois se precisar)
    const webhookRes = await fetch(`${BASE}/webhook/set/${INSTANCE}`, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: WEBHOOK_URL,
          webhookByEvents: false,
          webhookBase64: false,
          events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED", "SEND_MESSAGE", "CALL"],
        },
      }),
      cache: "no-store",
    }).catch(() => null);
    console.log("[RESET] webhook:", webhookRes?.status ?? "network-error");

    // 6) QR: usa o que já veio do create, ou tenta conectar com retry limitado
    let base64 = base64DoCreate;
    let qrDataFinal: Record<string, unknown> = createData;
    if (!base64) {
      const resultado = await conectarComRetry();
      if (!resultado.ok) {
        console.error("[RESET] QR não gerado após", CONNECT_MAX_TENTATIVAS, "tentativas:", JSON.stringify(resultado.data).slice(0, 300));
        const mensagem = mensagemErroEvolution(resultado.status, resultado.data);
        return NextResponse.json({ ok: false, error: mensagem, step: "connect" }, { status: 502 });
      }
      base64 = resultado.base64;
      qrDataFinal = resultado.qrData;
    }

    await salvarStatusConexao("connecting");

    return NextResponse.json({
      ok: true,
      qrcode: { base64, code: (qrDataFinal?.code as string | undefined) ?? null, pairingCode: (qrDataFinal?.pairingCode as string | undefined) ?? null },
    });
  } catch (e) {
    console.error("[RESET] Erro inesperado:", e);
    return NextResponse.json({ ok: false, error: "Falha ao resetar conexão" }, { status: 502 });
  }
}
