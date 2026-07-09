// cron/mcp-copiloto — executa o agregador determinístico da Fase 2A.
// Lê mcp:log:obs, gera sugestões candidatas e persiste em mcp:sugestoes:candidatas.
// Só ativo quando MCP_COPILOTO_MODE=deterministico ou MCP_MODE=copiloto.
// Protegido por Bearer CRON_SECRET (mesmo padrão dos outros crons).

import { NextResponse } from 'next/server';
import { processarCopilotoDeterministico } from '@/mcp/modes/copiloto';
import { logErroMcp } from '@/mcp/logger/mcpLogger';

export const maxDuration = 30;

export async function GET(req: Request): Promise<NextResponse> {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const modoAtivo =
    process.env.MCP_COPILOTO_MODE === 'deterministico' ||
    process.env.MCP_MODE === 'copiloto';

  if (!modoAtivo) {
    return NextResponse.json({ ok: true, motivo: 'mcp copiloto inativo' });
  }

  try {
    const sugestoes = await processarCopilotoDeterministico();
    return NextResponse.json({ ok: true, sugestoes: sugestoes.length });
  } catch (err) {
    await logErroMcp('cron:mcp-copiloto', err);
    return NextResponse.json({ ok: true, erro: 'capturado' });
  }
}
