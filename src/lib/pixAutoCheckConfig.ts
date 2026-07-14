// Configuração central da cadência de auto-verificação do Pix Mercado Pago
// (Guardião Pix — evolução do Nível 6.4). Único lugar que define os números
// de intervalo: nada de valor mágico espalhado pelo painel, pelo conciliador
// ou pelo Guardião — todos importam daqui.
//
// Janela adaptativa (a partir da criação do pagamento):
// - 0 a 2 minutos:  verifica a cada 10s (piso desta etapa, configurável)
// - 2 a 5 minutos:  verifica a cada 20s
// - após 5 minutos: verifica a cada 30s
//
// Rollback: setar PIX_AUTO_CHECK_INITIAL_INTERVAL_MS=20000 no ambiente volta
// a primeira janela ao comportamento anterior, sem tocar em nenhum código
// financeiro. Se a variável estiver ausente, usa o novo padrão seguro (10s).
// Se estiver presente mas inválida (não numérica ou abaixo do piso mínimo),
// cai para o valor historicamente validado em produção (20s) em vez de um
// número arbitrário.

const PIX_AUTO_CHECK_DEFAULT_INITIAL_INTERVAL_MS = 10_000;
export const PIX_AUTO_CHECK_FALLBACK_INITIAL_INTERVAL_MS = 20_000;
const PIX_AUTO_CHECK_INTERVAL_MIN_MS = 1_000;

function resolveInitialIntervalMs(): number {
  // NEXT_PUBLIC_* é a única forma de uma env var chegar ao bundle do
  // cliente (o painel /pedidos roda no navegador — Next.js só substitui
  // estaticamente variáveis com esse prefixo). Mantém a variável sem
  // prefixo como alias para uso em contexto server-side.
  const raw = process.env.NEXT_PUBLIC_PIX_AUTO_CHECK_INITIAL_INTERVAL_MS ?? process.env.PIX_AUTO_CHECK_INITIAL_INTERVAL_MS;
  if (raw === undefined || raw.trim() === "") return PIX_AUTO_CHECK_DEFAULT_INITIAL_INTERVAL_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < PIX_AUTO_CHECK_INTERVAL_MIN_MS) {
    return PIX_AUTO_CHECK_FALLBACK_INITIAL_INTERVAL_MS;
  }
  return parsed;
}

export const PIX_AUTO_CHECK_INITIAL_INTERVAL_MS = resolveInitialIntervalMs();

// Demais camadas da cadência (Nível 6.4 preservava só duas: rápida e lenta).
// Estas duas continuam fixas — só a primeira janela é configurável, como
// pedido: "altere somente a primeira janela e preserve os demais mecanismos".
export const PIX_AUTO_CHECK_INTERVAL_TIER2_MS = 20_000;
export const PIX_AUTO_CHECK_INTERVAL_TIER3_MS = 30_000;

// Sem nenhum Pix Mercado Pago pendente na lista: volta ao intervalo leve
// (mesmo valor do Nível 6.4 — fora do escopo desta mudança).
export const PIX_AUTO_CHECK_INTERVAL_SEM_PENDENTE_MS = 120_000;

export const PIX_AUTO_CHECK_WINDOW_2MIN_MS = 2 * 60 * 1000;
export const PIX_AUTO_CHECK_WINDOW_5MIN_MS = 5 * 60 * 1000;

// Jitter pequeno para múltiplas instâncias/abas não baterem no Mercado Pago
// no mesmo milissegundo. Deliberadamente pequeno para não empurrar a
// primeira janela de forma relevante para além dos 10s desejados.
export const PIX_AUTO_CHECK_JITTER_MAX_MS = 800;

/**
 * Intervalo até a próxima verificação para um pagamento Mercado Pago ainda
 * pendente, dado há quanto tempo (ms) ele foi criado. Determinístico, sem
 * qualquer heurística probabilística.
 */
export function calcularIntervaloPorIdade(idadeMs: number): number {
  const idade = Number.isFinite(idadeMs) && idadeMs > 0 ? idadeMs : 0;
  if (idade < PIX_AUTO_CHECK_WINDOW_2MIN_MS) return PIX_AUTO_CHECK_INITIAL_INTERVAL_MS;
  if (idade < PIX_AUTO_CHECK_WINDOW_5MIN_MS) return PIX_AUTO_CHECK_INTERVAL_TIER2_MS;
  return PIX_AUTO_CHECK_INTERVAL_TIER3_MS;
}

export function aplicarJitter(intervaloMs: number, maxJitterMs: number = PIX_AUTO_CHECK_JITTER_MAX_MS): number {
  if (maxJitterMs <= 0) return intervaloMs;
  return intervaloMs + Math.floor(Math.random() * maxJitterMs);
}

// Guardião Pix — limites de recuperação e janelas de saúde operacional
// (não financeiras). Também centralizados aqui para evitar números mágicos
// no módulo do Guardião.
export const PIX_GUARDIAO_MAX_RECUPERACOES = 5;
export const PIX_GUARDIAO_COOLDOWN_RECUPERACAO_SEGUNDOS = 30;
// Considerado "atrasado" quando a última tentativa/última resposta válida é
// mais antiga que N vezes o intervalo esperado para a idade atual do pagamento.
export const PIX_GUARDIAO_MULTIPLICADOR_ATRASO = 2;
export const PIX_GUARDIAO_FALHAS_CONSECUTIVAS_LIMITE = 3;
// Idade a partir da qual o Guardião para de tentar recuperar e só classifica
// como "expired" (operacional) para observabilidade — não é a expiração
// financeira do Pix (essa continua sendo decidida pelo status oficial).
export const PIX_GUARDIAO_IDADE_MAXIMA_MS = 45 * 60 * 1000;
