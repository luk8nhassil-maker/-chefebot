import { NextRequest, NextResponse } from "next/server";
import { lerSessaoAdministrativa } from "@/lib/sessaoAdministrativa";
import { definirWhatsappAtendimentoSalao, obterConfigSalao } from "@/lib/salaoAuth";
import { normalizarTelefoneBrasil } from "@/lib/telefone";
import { enviarTextoWhatsApp } from "@/lib/whatsappMensagem";

export const dynamic = "force-dynamic";

const SALAO_LOGIN_URL = "https://chefedapizza.com.br/salao/login";

// Configuração do WhatsApp do atendimento do Salão — só admin/dev (mesmo
// nível de acesso restrito de /setup e /configuracoes sensíveis). Não é um
// segredo (é um número de contato), então pode voltar em texto claro no GET.
function autorizado(role: string | undefined): boolean {
  return role === "admin" || role === "dev";
}

export async function GET(req: NextRequest) {
  const sessao = await lerSessaoAdministrativa(req);
  if (!sessao || !autorizado(sessao.role)) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  const config = await obterConfigSalao();
  return NextResponse.json({
    ok: true,
    configurado: !!config.whatsappAtendimento,
    whatsappAtendimento: config.whatsappAtendimento ?? "",
    atualizadoEm: config.atualizadoEm,
  });
}

export async function POST(req: NextRequest) {
  const sessao = await lerSessaoAdministrativa(req);
  if (!sessao || !autorizado(sessao.role)) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  let body: { whatsappAtendimento?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }

  const numero = normalizarTelefoneBrasil(body.whatsappAtendimento);
  if (!numero) {
    return NextResponse.json({ ok: false, error: "Informe um número de WhatsApp válido, com DDD" }, { status: 400 });
  }

  await definirWhatsappAtendimentoSalao(numero.nacional);

  // Manda o link do terminal direto pro WhatsApp recém-cadastrado — falha de
  // envio não desfaz o cadastro (o número já está salvo), só é reportada
  // para o admin tentar reenviar.
  const envio = await enviarTextoWhatsApp(
    `55${numero.nacional}`,
    `Este é o WhatsApp de atendimento cadastrado para o salão.\n\nAcesse o terminal aqui: ${SALAO_LOGIN_URL}`
  );

  return NextResponse.json({ ok: true, linkEnviado: envio.ok });
}
