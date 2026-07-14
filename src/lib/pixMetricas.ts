import { redis } from "./redis";
import type { PixConfirmadoPor } from "./pix";

// Observabilidade e métricas do Guardião Pix. Nunca cria uma nova fonte de
// verdade financeira: as funções "snapshot" só leem o array de pedidos já
// existente (mesma leitura que o conciliador já faz) e agregam o que já está
// gravado (pix.confirmadoPor, pix.criadoEm, pix.confirmadoEm). Os contadores
// cumulativos (timeout, rate limit, locks recuperados, duplicidades
// impedidas) vivem em chaves Redis simples, incrementadas pelo conciliador e
// pelo Guardião — nunca pelo webhook nem pela confirmação manual (não
// alterados por esta mudança).

type PedidoParaMetricas = {
  id?: string;
  pix?: {
    provider?: string;
    status?: string;
    confirmadoPor?: PixConfirmadoPor;
    confirmadoEm?: string;
    criadoEm?: string;
  };
  pixConfirmado?: boolean;
};

export type LatenciasConfirmacaoPix = {
  amostras: number;
  mediaMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
};

function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 1) return ordenados[0];
  const indice = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[Math.max(0, indice)];
}

// Só considera Pix Mercado Pago confirmados com os dois carimbos de tempo
// (criadoEm é aditivo — pedidos antigos sem ele não entram na amostra, nunca
// geram latência negativa ou inventada).
export function calcularLatenciasConfirmacaoPix(pedidos: PedidoParaMetricas[]): LatenciasConfirmacaoPix {
  const latencias: number[] = [];
  for (const p of pedidos) {
    if (p.pix?.provider !== "mercadopago") continue;
    if (p.pix?.status !== "confirmado") continue;
    if (!p.pix.criadoEm || !p.pix.confirmadoEm) continue;
    const criado = new Date(p.pix.criadoEm).getTime();
    const confirmado = new Date(p.pix.confirmadoEm).getTime();
    if (!Number.isFinite(criado) || !Number.isFinite(confirmado)) continue;
    const latencia = confirmado - criado;
    if (latencia < 0) continue;
    latencias.push(latencia);
  }

  if (latencias.length === 0) {
    return { amostras: 0, mediaMs: null, p50Ms: null, p95Ms: null, p99Ms: null };
  }

  const ordenados = [...latencias].sort((a, b) => a - b);
  const soma = ordenados.reduce((acc, v) => acc + v, 0);

  return {
    amostras: ordenados.length,
    mediaMs: Math.round(soma / ordenados.length),
    p50Ms: percentil(ordenados, 50),
    p95Ms: percentil(ordenados, 95),
    p99Ms: percentil(ordenados, 99),
  };
}

export type ConfirmacoesPorOrigemPix = Record<string, number>;

export function contarConfirmacoesPorOrigemPix(pedidos: PedidoParaMetricas[]): ConfirmacoesPorOrigemPix {
  const contagem: ConfirmacoesPorOrigemPix = {};
  for (const p of pedidos) {
    if (p.pix?.provider !== "mercadopago") continue;
    if (p.pix?.status !== "confirmado") continue;
    const origem = p.pix.confirmadoPor || "desconhecida";
    contagem[origem] = (contagem[origem] || 0) + 1;
  }
  return contagem;
}

export type PendentesPorJanelaPix = {
  acimaDe1Min: number;
  acimaDe2Min: number;
  acimaDe5Min: number;
};

export function contarPendentesPorJanelaPix(pedidos: PedidoParaMetricas[], agora: number = Date.now()): PendentesPorJanelaPix {
  let acimaDe1Min = 0;
  let acimaDe2Min = 0;
  let acimaDe5Min = 0;

  for (const p of pedidos) {
    if (p.pix?.provider !== "mercadopago") continue;
    if (p.pix?.status === "confirmado" || p.pixConfirmado === true) continue;
    if (!p.pix?.criadoEm) continue;
    const criado = new Date(p.pix.criadoEm).getTime();
    if (!Number.isFinite(criado)) continue;
    const idadeMs = agora - criado;
    if (idadeMs >= 60_000) acimaDe1Min++;
    if (idadeMs >= 120_000) acimaDe2Min++;
    if (idadeMs >= 300_000) acimaDe5Min++;
  }

  return { acimaDe1Min, acimaDe2Min, acimaDe5Min };
}

// Contadores cumulativos — best-effort, nunca sensíveis, nunca bloqueiam o
// fluxo principal (qualquer falha de Redis aqui é engolida). Usa get+set em
// vez de INCR para não depender de um comando extra no mock/cliente Redis já
// usado pelo restante do projeto.
export type ContadorPixMetrica =
  | "timeout"
  | "rate_limited"
  | "locks_recuperados"
  | "duplicidade_evitada"
  | "guardiao_recuperado"
  | "guardiao_failed"
  | "guardiao_cadeia_tick"
  | "guardiao_cadeia_finalizada";

const PREFIXO_CONTADOR = "pix:metricas:contador:";

export async function incrementarContadorPix(nome: ContadorPixMetrica, quantidade: number = 1): Promise<void> {
  try {
    const chave = `${PREFIXO_CONTADOR}${nome}`;
    const atual = (await redis.get<number>(chave)) || 0;
    await redis.set(chave, atual + quantidade);
  } catch {
    // Observabilidade nunca pode derrubar o fluxo de confirmação.
  }
}

export async function obterContadoresPix(): Promise<Record<ContadorPixMetrica, number>> {
  const nomes: ContadorPixMetrica[] = [
    "timeout",
    "rate_limited",
    "locks_recuperados",
    "duplicidade_evitada",
    "guardiao_recuperado",
    "guardiao_failed",
    "guardiao_cadeia_tick",
    "guardiao_cadeia_finalizada",
  ];
  const valores = await Promise.all(
    nomes.map(async (nome) => {
      try {
        return (await redis.get<number>(`${PREFIXO_CONTADOR}${nome}`)) || 0;
      } catch {
        return 0;
      }
    })
  );
  const resultado = {} as Record<ContadorPixMetrica, number>;
  nomes.forEach((nome, i) => { resultado[nome] = valores[i]; });
  return resultado;
}

// Mascaramento de identificadores para log (Nível Guardião Pix) — nunca loga
// o paymentId completo, access token, senha, hash, código Pix completo ou
// dados bancários. Mantém só um sufixo curto para correlação manual.
export function mascararIdentificador(valor: string | undefined | null): string {
  if (!valor) return "—";
  const limpo = String(valor).trim();
  if (limpo.length <= 4) return "***";
  return `***${limpo.slice(-4)}`;
}
