import { NextResponse } from "next/server";
import { salvarStatusConexao } from "@/lib/conexaoWhatsapp";

const BASE = process.env.EVOLUTION_API_URL ?? "https://evolution-api-production-8f99.up.railway.app";
const KEY  = process.env.EVOLUTION_API_KEY  ?? "6208711c1b6fdffcc30cb492a44d74601415c33ff717ef6032162f9c0056319e";

// Reset completo da conexão do WhatsApp — usado quando se troca de aparelho.
// 1) Logout da sessão ativa na Evolution API
// 2) Reinicia a instância para limpar estado interno pendente
// 3) Pausa o bot no Redis
// 4) Gera QR novo e limpo
export async function POST() {
  try {
    // 1) Logout — encerra sessão ativa; erro ignorado (pode já estar desconectada)
    await fetch(`${BASE}/instance/logout/chefe`, {
      method: "DELETE",
      headers: { apikey: KEY },
      cache: "no-store",
    }).catch(() => {});

    // 2) Restart — limpa qualquer estado "connecting" pendente na Evolution API,
    //    garantindo que o próximo /connect gere um QR completamente novo.
    await fetch(`${BASE}/instance/restart/chefe`, {
      method: "PUT",
      headers: { apikey: KEY },
      cache: "no-store",
    }).catch(() => {});

    // 3) Pausa o bot imediatamente (sem esperar o webhook de desconexão)
    await salvarStatusConexao("disconnected");

    // 4) Solicita QR novo para o aparelho novo
    const resQr = await fetch(`${BASE}/instance/connect/chefe`, {
      headers: { apikey: KEY },
      cache: "no-store",
    });
    const qrData = await resQr.json();

    await salvarStatusConexao("connecting");

    return NextResponse.json({ ok: true, qrcode: qrData });
  } catch {
    return NextResponse.json({ ok: false, error: "Falha ao resetar conexão" }, { status: 502 });
  }
}
