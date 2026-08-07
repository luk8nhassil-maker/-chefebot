import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { mutarPedidos } from "@/lib/pedidosConcorrencia";
import { obterConfigEvolution } from "@/lib/evolutionApi";

async function enviarMensagem(phone: string, text: string) {
  const config = obterConfigEvolution();
  if (!config) { console.error("[cron pix-pendente] Provider de WhatsApp não configurado — mensagem não enviada."); return; }
  try {
    await fetch(`${config.baseUrl}/message/sendText/${config.instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.apiKey },
      body: JSON.stringify({ number: phone, text }),
    });
  } catch {}
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Busca todas as sessões ativas com step aguardando_pix
    const keys = await redis.keys("session:*");
    let escalados = 0;
    let cobrados = 0;

    for (const key of keys) {
      const session = await redis.get<any>(key);
      if (!session || session.step !== "aguardando_pix") continue;

      const phone = key.replace("session:", "");
      const pixIniciadoEm = session.pixIniciadoEm || Date.now();
      const minutos = Math.floor((Date.now() - pixIniciadoEm) / 60000);
      const cobrancas = session.pixCobrancas || 0;

      if (minutos >= 6 && cobrancas < 3) {
        // 6+ minutos sem comprovante — escala para Kellyne. Protegido pelo
        // lock GLOBAL de "pedidos" (ver src/lib/pedidosConcorrencia.ts):
        // leitura+decisão+escrita sobre um snapshot fresco, dentro do lock
        // — a mensagem WhatsApp continua fora, depois da persistência.
        await mutarPedidos<any, void>((pedidosFrescos) => {
          const pedidoAtivo = pedidosFrescos.find(p => p.telefone === phone && p.status === "novo" && !p.escalonado);
          if (!pedidoAtivo) return { persistir: false, resultado: undefined };
          return {
            persistir: true,
            pedidos: pedidosFrescos.map(p =>
              p.id === pedidoAtivo.id ? { ...p, escalonado: true, cancelamentoSolicitado: false } : p
            ),
            resultado: undefined,
          };
        });

        await enviarMensagem(phone, `⏰ Ei! Seu pedido está aguardando o comprovante do Pix.\n\nNossa equipe vai entrar em contato para te ajudar. 😊`);
        await redis.set(key, { ...session, pixCobrancas: 3 }, { ex: 1800 });
        escalados++;

      } else if (minutos >= 4 && cobrancas < 2) {
        // 4 minutos — 2a cobrança
        await enviarMensagem(phone, `⚠️ Seu pedido ainda está aguardando o comprovante do Pix.\n\nEnvie a imagem ou PDF do comprovante para confirmarmos! 📄`);
        await redis.set(key, { ...session, pixCobrancas: 2 }, { ex: 1800 });
        cobrados++;

      } else if (minutos >= 2 && cobrancas < 1) {
        // 2 minutos — 1a cobrança
        await enviarMensagem(phone, `Lembrete: para confirmar seu pedido, envie o comprovante do Pix! 📄\n\nÉ rapidinho, só enviar a imagem aqui. 😊`);
        await redis.set(key, { ...session, pixCobrancas: 1 }, { ex: 1800 });
        cobrados++;
      }
    }

    return NextResponse.json({ ok: true, cobrados, escalados });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
