import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { obterConfigEvolution, extrairQrBase64 } from '@/lib/evolutionApi'
import { garantirWebhookEvolution } from '@/lib/evolutionWebhook'
import { adquirirLockGeracaoQr, lerQrAtual, persistirQrAtual, type WhatsappQrRecord } from '@/lib/whatsappQrCache'

// Sem cookie ou token invalido/expirado -> 401 (sem sessao).
// Sessao valida mas papel sem permissao -> 403.
// Papel autorizado -> segue normalmente.
async function checkAuth(req: NextRequest): Promise<{ status: 401 | 403 } | { status: 200 }> {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return { status: 401 }
  const payload = await verifyToken(token)
  if (!payload) return { status: 401 }
  if (!['admin', 'dev'].includes(payload.role as string)) return { status: 403 }
  return { status: 200 }
}

function serializarQr(record: WhatsappQrRecord) {
  return {
    base64: record.base64,
    generatedAt: record.generatedAt,
    expiresAt: record.expiresAt,
    generationId: record.generationId,
  }
}

// Endpoint leve: obtém o QR atualmente válido da instância existente.
// Reaproveita uma geração já em cache (Redis, TTL curto acompanhando a
// rotação real do Baileys) sempre que possível — só chama /instance/connect
// na Evolution quando não há QR válido em cache, e usa um lock curto para
// impedir que duas chamadas quase simultâneas (duplo clique, duas abas)
// disparem dois /instance/connect e rotacionem o QR na cara do usuário.
// Não depende de Redis para funcionar (best-effort: cache indisponível só
// volta ao comportamento de sempre chamar a Evolution).
// Para reset completo (delete + create), usar POST /api/whatsapp/reset.
// Restrito a admin/dev — QR code dá acesso a conectar o WhatsApp da pizzaria.
export async function POST(req: NextRequest) {
  const auth = await checkAuth(req)
  if (auth.status === 401) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  if (auth.status === 403) return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })

  const config = obterConfigEvolution()
  if (!config) {
    return NextResponse.json(
      { error: 'EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados.', estado: 'provider_not_configured' },
      { status: 503 }
    )
  }

  const existente = await lerQrAtual(config.instanceName)
  if (existente) {
    return NextResponse.json({ ok: true, ...serializarQr(existente) })
  }

  const lockOk = await adquirirLockGeracaoQr(config.instanceName)
  if (!lockOk) {
    const retry = await lerQrAtual(config.instanceName)
    if (retry) return NextResponse.json({ ok: true, ...serializarQr(retry) })
    return NextResponse.json(
      { ok: false, estado: 'gerando', error: 'Geração em andamento, tente novamente em instantes.' },
      { status: 429 }
    )
  }

  try {
    // Melhor esforço: garante que a instância avisa o ChefeBot de QR/conexão
    // novos antes de abrir uma tentativa de pareamento. Nunca bloqueia a
    // exibição do QR se essa checagem falhar.
    await garantirWebhookEvolution(config).catch((e) => {
      console.error('[QR] falha ao confirmar webhook (ignorada):', e instanceof Error ? e.name : 'erro desconhecido')
    })

    const res = await fetch(`${config.baseUrl}/instance/connect/${config.instanceName}`, {
      headers: { apikey: config.apiKey },
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    const base64Bruto = extrairQrBase64(data)
    console.log('[QR] connect status:', res.status, 'has qr:', !!base64Bruto)

    if (!res.ok) {
      console.error('[QR] connect error, status:', res.status)
      // Repassa só a mensagem da Evolution API (ex.: "Application not found"
      // quando a instância foi perdida/apagada) — o admin precisa saber que
      // precisa resetar a conexão, não só que "deu erro". Nunca repassa o
      // corpo bruto da Evolution API (pode conter URL/infra interna) nem a
      // apikey usada na chamada.
      const detalhe = typeof data?.message === 'string' ? data.message : null
      return NextResponse.json(
        { error: detalhe ? `Evolution API: ${detalhe}` : 'Evolution API retornou erro', status: res.status },
        { status: res.status }
      )
    }

    if (!base64Bruto) {
      // Instância pode já estar conectada / sem QR direto — repassa como veio.
      return NextResponse.json(data)
    }

    const registro = await persistirQrAtual(config.instanceName, base64Bruto)
    console.log('[QR] novo QR persistido — hash:', registro.hash, 'tamanho:', registro.size, 'geracao:', registro.generationId)

    return NextResponse.json({ ...data, ...serializarQr(registro) })
  } catch (e) {
    console.error('[QR] erro inesperado:', e instanceof Error ? e.name : 'erro desconhecido')
    return NextResponse.json({ error: 'Falha ao conectar à Evolution API' }, { status: 502 })
  }
}
