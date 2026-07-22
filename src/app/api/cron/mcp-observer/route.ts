// cron/mcp-observer — consome a fila mcp:fila:eventos em lotes e processa
// cada lote no Modo Observador. Só ativo quando MCP_MODE=observador.
// Lê e escreve exclusivamente em chaves mcp:*.
// Chamado pelo scheduler Vercel (vercel.json, 1x/dia — fallback) e pelo
// workflow do GitHub Actions a cada 10min nos horários de pico de
// sexta/sábado/domingo (.github/workflows/mcp-observer-cron.yml). Também
// aceita chamada manual (workflow_dispatch ou curl com o mesmo Bearer).
//
// Capacidade (evolução Fase 1 — noites movimentadas, ver
// docs/architecture/MCP_OBSERVADOR_CAPACIDADE.md):
// - Até 500 eventos por execução, em chunks de 100, respeitando um
//   orçamento de tempo interno (deixa folga antes de maxDuration).
// - Cada chunk é persistido em bloco (processarLoteObservador — 3 comandos
//   Redis para o chunk inteiro, não 3 por evento). Só é removido da fila o
//   PREFIXO cuja persistência foi confirmada; se um chunk falhar, ele e
//   todo o resto da fila ficam intactos para a próxima execução.
// - Registra histórico de execuções (para agregados de 24h no painel),
//   pico da fila, e marca fins de semana com volume "movimentado" (proxy
//   para o critério de elegibilidade de fase).

import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { processarLoteObservador } from '@/mcp/modes/observador';
import { logErroMcp } from '@/mcp/logger/mcpLogger';
import { idFimDeSemana } from '@/mcp/lib/janelaPico';
import type { McpEventoFila } from '@/mcp/types';

export const maxDuration = 30;

const CHAVE_FILA = 'mcp:fila:eventos';
const CHAVE_PICO = 'mcp:meta:fila:pico';
const CHAVE_HISTORICO = 'mcp:meta:cron:historico';
const CHAVE_FDS_HISTORICO = 'mcp:meta:fds:historico';

const MAX_EVENTOS_POR_EXECUCAO = 500;
const TAMANHO_CHUNK = 100;
const ORCAMENTO_TEMPO_MS = 25_000; // maxDuration=30s — deixa ~5s de folga para os writes finais
const LIMITE_HISTORICO_EXECUCOES = 300; // cobre ~2 dias a 1 execução/10min
const TTL_HISTORICO_S = 3 * 24 * 60 * 60;
const TTL_PICO_S = 30 * 24 * 60 * 60;
const LIMIAR_FDS_MOVIMENTADO = 80; // proxy de "noite com 80+ pizzas": eventos processados no fds
const TTL_FDS_HISTORICO_S = 200 * 24 * 60 * 60;
const CHAVE_TOTAL_PROCESSADOS = 'mcp:meta:processados:total';
const TTL_TOTAL_PROCESSADOS_S = 400 * 24 * 60 * 60;

type RegistroHistorico = { ts: number; processed: number; errors: number };

function parseJsonSeguro<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function atualizarPicoSeMaior(tamanhoAtual: number): Promise<void> {
  try {
    const picoAtual = (await redis.get<number>(CHAVE_PICO)) ?? 0;
    if (tamanhoAtual > picoAtual) {
      await redis.set(CHAVE_PICO, tamanhoAtual, { ex: TTL_PICO_S });
    }
  } catch {
    // pico é só observabilidade — nunca pode impedir o processamento real
  }
}

async function registrarExecucaoHistorico(registro: RegistroHistorico): Promise<void> {
  try {
    await redis.rpush(CHAVE_HISTORICO, JSON.stringify(registro));
    await redis.ltrim(CHAVE_HISTORICO, -LIMITE_HISTORICO_EXECUCOES, -1);
    await redis.expire(CHAVE_HISTORICO, TTL_HISTORICO_S);
  } catch {
    // histórico é observabilidade — nunca pode derrubar o cron
  }
}

// Contador vitalício (não afetado pelo cap de 500 do mcp:log:obs) — usado
// só pelo critério de elegibilidade "pelo menos 500 eventos reais
// processados". TTL longo, renovado a cada execução ativa.
async function incrementarTotalProcessados(processados: number): Promise<void> {
  if (processados <= 0) return;
  try {
    await redis.incrby(CHAVE_TOTAL_PROCESSADOS, processados);
    await redis.expire(CHAVE_TOTAL_PROCESSADOS, TTL_TOTAL_PROCESSADOS_S);
  } catch {
    // contador é só para o painel de elegibilidade — best-effort
  }
}


async function marcarFimDeSemanaSeMovimentado(): Promise<void> {
  try {
    const id = idFimDeSemana(new Date());
    if (!id) return;

    const historico = (await redis.get<string[]>(CHAVE_FDS_HISTORICO)) ?? [];
    if (historico.includes(id)) return;

    const inicioSextaMs = Date.parse(`${id}T00:00:00Z`) - 86_400_000;
    const fimMs = inicioSextaMs + 3 * 86_400_000;
    const execucoes = (await redis.lrange<string>(CHAVE_HISTORICO, 0, -1)) ?? [];
    const totalFds = execucoes.reduce((soma, raw) => {
      const registro = parseJsonSeguro<RegistroHistorico>(raw);
      if (!registro || registro.ts < inicioSextaMs || registro.ts >= fimMs) return soma;
      return soma + (registro.processed ?? 0);
    }, 0);
    if (totalFds < LIMIAR_FDS_MOVIMENTADO) return;

    const atualizado = [...historico, id].slice(-52);
    await redis.set(CHAVE_FDS_HISTORICO, atualizado, { ex: TTL_FDS_HISTORICO_S });
  } catch {
    // marcação de fim de semana é só para o painel de elegibilidade — best-effort
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (process.env.MCP_MODE !== 'observador') {
    return NextResponse.json({ ok: true, motivo: 'mcp inativo' });
  }

  const startedAt = Date.now();
  const prazoFinal = startedAt + ORCAMENTO_TEMPO_MS;

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
    await registrarExecucaoHistorico({ ts: finishedAt, processed: processados, errors: erros });
  };

  try {
    try {
      const tamanhoAtual = await redis.llen(CHAVE_FILA);
      await atualizarPicoSeMaior(tamanhoAtual);
    } catch {
      // pico é cosmético — segue o processamento normalmente
    }

    let processados = 0;
    let erros = 0;
    let restante = MAX_EVENTOS_POR_EXECUCAO;
    let motivoParada: string | undefined;

    while (restante > 0) {
      if (Date.now() >= prazoFinal) {
        motivoParada = 'orcamento_tempo';
        break;
      }

      const tamanhoChunk = Math.min(TAMANHO_CHUNK, restante);
      const itensBrutos = await redis.lrange<string>(CHAVE_FILA, 0, tamanhoChunk - 1);
      if (itensBrutos.length === 0) break;

      const eventos: McpEventoFila[] = [];
      let malformados = 0;
      for (const item of itensBrutos) {
        const evento = typeof item === 'string' ? parseJsonSeguro<McpEventoFila>(item) : (item as McpEventoFila);
        if (evento) eventos.push(evento);
        else malformados++;
      }
      if (malformados > 0) {
        erros += malformados;
        await logErroMcp('cron:item-malformado', `descartados=${malformados}`);
      }

      const resultado = await processarLoteObservador(eventos);
      if (!resultado.sucesso) {
        erros++;
        motivoParada = 'falha_persistencia_lote';
        break; // nada deste chunk é removido — tenta de novo na próxima execução
      }

      // Só remove da fila depois de confirmar que o chunk foi persistido.
      await redis.ltrim(CHAVE_FILA, itensBrutos.length, -1);
      processados += eventos.length;
      restante -= itensBrutos.length;

      if (itensBrutos.length < tamanhoChunk) break; // fila esvaziou no meio do chunk
    }

    const reason = processados === 0 && erros === 0 ? 'fila_vazia' : motivoParada;
    await persistirMeta(processados, erros, reason);
    await incrementarTotalProcessados(processados);
    await marcarFimDeSemanaSeMovimentado();

    return NextResponse.json({ ok: true, processados, erros, ...(motivoParada ? { motivoParada } : {}) });
  } catch (err) {
    await logErroMcp('cron:mcp-observer', err);
    await persistirMeta(0, 1, 'erro_inesperado').catch(() => {});
    return NextResponse.json({ ok: true, erro: 'capturado' });
  }
}
