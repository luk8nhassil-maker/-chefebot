import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { salvarStatusConexao } from "@/lib/conexaoWhatsapp";

const BASE = "https://evolution-api-production-8f99.up.railway.app";
const KEY = "6208711c1b6fdffcc30cb492a44d74601415c33ff717ef6032162f9c0056319e";

// Reset completo da conexão do WhatsApp — usado quando se troca de aparelho.
// 1) Desconecta a instância atual na Evolution API (logout da sessão antiga)
// 2) Marca o status como "disconnected" no Redis (pausa as respostas do bot)
// 3) Solicita um novo QR code para conectar o aparelho novo
export async function POST() {
  try {
    // 1) Logout da instância antiga
    await fetch(`${BASE}/instance/logout/chefe`, {
      method: "DELETE",
      headers: { apikey: KEY },
      cache: "no-store",
    }).catch(() => {}); // se já estiver desconectada, a Evolution pode retornar erro — ignoramos

    // 2) Marca status como desconectado (pausa o bot imediatamente, sem esperar o webhook)
    await salvarStatusConexao("disconnected");

    // 3) Solicita novo QR code para a próxima conexão
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
