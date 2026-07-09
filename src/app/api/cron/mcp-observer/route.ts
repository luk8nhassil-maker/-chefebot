// cron/mcp-observer — consome a fila mcp:fila:eventos em batches e processa
// cada evento no Modo Observador. Só ativo quando MCP_MODE=observador.
// Lê e escreve exclusivamente em chaves mcp:*.
// Chamado pelo scheduler Vercel (vercel.json) ou manualmente via GET.

import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { processarEventoObservador } from '@/mcp/modes/observador';
import { logErroMcp } from '@/mcp/logger/mcpLogger';
import type { McpEventoFila } from '@/mcp/types';

export const maxDuration = 30;

const CHAVE_FILA = 'mcp:fila:eventos';
const BATCH_SIZE = 50;

export async function GET(req: Request): Promise<NextResponse> {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (process.env.MCP_MODE !== 'observador') {
    return NextResponse.json({ ok: true, motivo: 'mcp inativo' });
  }

  const startedAt = Date.now();

  const persistirMeta = async (processados: number, erros: number, reason?: string) => {
    const finishedAt = Date.now();
    await redis.set(
      'mcp:meta:cron:ultima',
      JSON.stringify({
        startedAt,
        finishedAt,
        processed: processados,
        errors: erros,
        mode: 'observador',
        durationMs: finishedAt - startedAt,
        ...(reason ? { reason } : {}),
      }),
      { ex: 172800 },
    );
  };

  try {
    const itens = await redis.lrange<string>(CHAVE_FILA, 0, BATCH_SIZE - 1);

    if (itens.length === 0) {
      await persistirMeta(0, 0, 'fila_vazia');
      return NextResponse.json({ ok: true, processados: 0 });
    }

    let processados = 0;
    let errosLote = 0;
    for (const item of itens) {
      try {
        const evento = (typeof item === 'string' ? JSON.parse(item) : item) as McpEventoFila;
        await processarEventoObservador(evento);
        processados++;
      } catch (err) {
        errosLote++;
        await logErroMcp('cron:processar-item', err);
      }
    }

    // Remove apenas os itens processados neste batch
    await redis.ltrim(CHAVE_FILA, itens.length, -1);
    await persistirMeta(processados, errosLote);

    return NextResponse.json({ ok: true, processados });
  } catch (err) {
    await logErroMcp('cron:mcp-observer', err);
    return NextResponse.json({ ok: true, erro: 'capturado' });
  }
}
