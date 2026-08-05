import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { redis } from "@/lib/redis";
import type { BotSession } from "@/lib/bot";
import { mensagemCancelamentoPorInatividade } from "@/lib/bot";
import { geracaoAtualCronometroInatividade, STEPS_SEM_CRONOMETRO_INATIVIDADE } from "@/lib/inatividadeConversa";
import { registrarMensagem, ultimasMensagensRelevantes } from "@/lib/conversa";
import { enviarTextoWhatsApp } from "@/lib/whatsappMensagem";

// Endpoint interno de cada tick do cronômetro de inatividade (chamado
// exclusivamente pelo QStash — nunca pelo navegador nem pelo painel).
// Autenticação por ASSINATURA (upstash-signature), não por sessão de admin
// — ver src/lib/inatividadeConversa.ts para o desenho completo da cadeia.
//
// Um tick só cancela a conversa se, no momento em que chega, TUDO isto
// ainda for verdade:
//  1. a geração no corpo bate com a geração atual (ninguém mandou mensagem
//     depois que este tick foi agendado);
//  2. a sessão ainda existe e está numa etapa elegível (não é "done" nem
//     "aguardando_pix");
//  3. a última mensagem da conversa ainda é nossa (bot ou atendente) — se o
//     cliente já respondeu, mesmo que por uma corrida de eventos o tick
//     antigo ainda chegue, isto barra o envio errado.
// Qualquer uma falhando: 200 "ignorado", sem efeito nenhum.

type CorpoTick = { phone?: unknown; geracao?: unknown };

const TICK_DEDUPE_PREFIXO = "inatividade:tick:dedupe:";
const TICK_DEDUPE_TTL_SEGUNDOS = 55;

function receiver(): Receiver | null {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) return null;
  return new Receiver({ currentSigningKey, nextSigningKey });
}

export async function POST(req: NextRequest) {
  const corpoTexto = await req.text();

  const verificador = receiver();
  if (!verificador) {
    return NextResponse.json({ ok: false, motivo: "assinatura_nao_configurada" }, { status: 503 });
  }

  const assinatura = req.headers.get("upstash-signature");
  if (!assinatura) {
    return NextResponse.json({ ok: false, motivo: "assinatura_ausente" }, { status: 401 });
  }

  try {
    const valida = await verificador.verify({ signature: assinatura, body: corpoTexto });
    if (!valida) return NextResponse.json({ ok: false, motivo: "assinatura_invalida" }, { status: 401 });
  } catch {
    return NextResponse.json({ ok: false, motivo: "assinatura_invalida" }, { status: 401 });
  }

  let corpo: CorpoTick;
  try {
    corpo = JSON.parse(corpoTexto) as CorpoTick;
  } catch {
    // Payload permanentemente malformado — reenviar nunca vai funcionar, 200 evita retries inúteis.
    return NextResponse.json({ ok: false, ignorado: true, motivo: "corpo_invalido" });
  }

  const phone = typeof corpo.phone === "string" ? corpo.phone.trim() : "";
  const geracaoTick = typeof corpo.geracao === "number" && Number.isFinite(corpo.geracao) ? corpo.geracao : undefined;
  if (!phone || geracaoTick === undefined) {
    return NextResponse.json({ ok: false, ignorado: true, motivo: "payload_invalido" });
  }

  // Dedupe do tick: o QStash garante entrega "at-least-once" — evita agir
  // duas vezes sobre o mesmo (phone, geração) por retry de rede.
  const chaveDedupe = `${TICK_DEDUPE_PREFIXO}${phone}:${geracaoTick}`;
  const primeiraEntrega = await redis.set(chaveDedupe, "1", { nx: true, ex: TICK_DEDUPE_TTL_SEGUNDOS });
  if (!primeiraEntrega) {
    return NextResponse.json({ ok: true, duplicado: true, ignorado: true });
  }

  const geracaoAtual = await geracaoAtualCronometroInatividade(phone);
  if (geracaoTick !== geracaoAtual) {
    return NextResponse.json({ ok: true, ignorado: true, motivo: "geracao_antiga" });
  }

  const session = await redis.get<BotSession>(`session:${phone}`);
  if (!session || STEPS_SEM_CRONOMETRO_INATIVIDADE.has(session.step)) {
    return NextResponse.json({ ok: true, ignorado: true, motivo: "etapa_nao_elegivel" });
  }

  const ultimas = await ultimasMensagensRelevantes(phone, 1);
  const ultima = ultimas[0];
  if (!ultima || ultima.autor === "cliente") {
    return NextResponse.json({ ok: true, ignorado: true, motivo: "cliente_ja_respondeu" });
  }

  // Encerra a conversa: 10 min de silêncio depois da nossa última mensagem.
  // Nunca mexe em pedidos já criados — nas etapas elegíveis ainda não existe
  // um pedido de verdade (ele só nasce quando a sessão chega em "done").
  await redis.del(`session:${phone}`);
  await redis.del(`manual:${phone}`);

  const texto = mensagemCancelamentoPorInatividade();
  const resultado = await enviarTextoWhatsApp(phone, texto);
  if (resultado.ok) {
    await registrarMensagem(phone, "bot", texto);
  }

  return NextResponse.json({ ok: true, cancelado: resultado.ok });
}
