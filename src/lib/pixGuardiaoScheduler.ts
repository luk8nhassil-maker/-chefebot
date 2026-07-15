import { Client } from "@upstash/qstash";
import { redis } from "./redis";
import {
  PIX_AUTO_CHECK_INITIAL_INTERVAL_MS,
  PIX_GUARDIAO_IDADE_MAXIMA_MS,
  PIX_GUARDIAO_QSTASH_FLOW_CONTROL_PARALLELISM,
  PIX_GUARDIAO_QSTASH_FLOW_CONTROL_KEY,
  PIX_GUARDIAO_QSTASH_RETRIES,
} from "./pixAutoCheckConfig";
import { iniciarEstadoSentinela } from "./pixSentinela";
import { incrementarContadorPix } from "./pixMetricas";

// Guardião Pix server-side — agendamento atrasado via QStash (Nível 6.8),
// coordenado pelo Sentinela Pix (Nível 6.9). Anteriormente o Guardião só
// rodava quando o painel /pedidos estava aberto (chamado pelo timer do
// navegador). Este módulo inicia uma CADEIA de verificações agendadas assim
// que o Pix Mercado Pago é criado, independente de qualquer aba aberta — o
// painel continua chamando o mesmo endpoint admin como REDUNDÂNCIA, nunca
// como único caminho.
//
// O QStash é só o "despertador": cada "tick" é uma mensagem com delay
// (cadência de `pixAutoCheckConfig.ts`) entregue em
// `/api/interno/pix-guardiao/verificar`, que NUNCA consulta o Mercado Pago
// diretamente — sempre passa pelo Sentinela Pix (pixSentinela.ts) primeiro,
// que decide se a consulta é realmente necessária e, se sim, agenda o
// próximo tick com o intervalo certo — até confirmar, cancelar, expirar
// (idade máxima) ou esgotar tentativas.
//
// Sem QSTASH_TOKEN configurado: agenda vira no-op seguro (loga uma vez) e o
// sistema cai de volta ao comportamento anterior (webhook + polling do
// painel) — nunca lança exceção nem impede a criação do Pix.

const QSTASH_CHAIN_LOCK_PREFIXO = "pix:guardiao:cadeia:lock:";
// Chave de dedupe do QSTASH: se `agendarProximaVerificacaoPixGuardiao` for
// chamada duas vezes para o mesmo pedidoId+geração+tentativa (ex.: retry de
// rede no nosso lado), o QStash aceita a segunda mas não enfileira de novo.
// O QStash também aplica sua própria janela de dedupe (~10min) por cima
// disso — usada aqui só como proteção complementar; o controle principal
// continua sendo o estado do Sentinela no Redis.
const QSTASH_MAX_TENTATIVAS_CADEIA = 400; // rede de segurança adicional além da idade máxima

// Tamanho máximo do trecho sanitizado do pedidoId dentro do deduplicationId —
// generoso o bastante para qualquer id real (timestamp/uuid), só evita um
// valor sem limite se algo inesperado for passado como pedidoId.
const DEDUPLICATION_ID_PEDIDO_MAX_LEN = 100;

// Gera o deduplicationId enviado ao QStash — NUNCA usa o pedidoId cru: o
// QStash rejeita ":" (retorno real em produção: "DeduplicationId não pode
// conter ':'"), então qualquer caractere fora de [A-Za-z0-9_-] é substituído
// por "_". Inclui pedidoId + geração da cadeia + janela agendada (tentativa)
// — determinístico (mesma combinação => mesmo id), tentativas OU gerações
// diferentes => ids diferentes. Nunca inclui dado sensível (o pedidoId já é
// só um identificador interno, não dado financeiro). Isso NUNCA afeta o
// `pedidoId` usado para localizar o pedido no Redis — só o rótulo enviado ao
// QStash para deduplicação.
export function gerarDeduplicationIdGuardiaoPix(pedidoId: string, geracao: number, tentativa: number): string {
  const pedidoIdSeguro = pedidoId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, DEDUPLICATION_ID_PEDIDO_MAX_LEN);
  const geracaoSegura = Number.isFinite(geracao) ? Math.trunc(geracao) : 0;
  const tentativaSegura = Number.isFinite(tentativa) ? Math.trunc(tentativa) : 0;
  return `pix-guardiao-${pedidoIdSeguro}-g${geracaoSegura}-${tentativaSegura}`;
}

let avisoSemTokenEmitido = false;

function resolveBaseUrl(): string {
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://chefebot-pjif.vercel.app";
}

function endpointVerificacaoUrl(): string {
  const override = process.env.PIX_GUARDIAO_QSTASH_CALLBACK_URL?.trim();
  if (override) return override;
  return `${resolveBaseUrl()}/api/interno/pix-guardiao/verificar`;
}

let clienteQstash: Client | null | undefined;

function obterClienteQstash(): Client | null {
  if (clienteQstash !== undefined) return clienteQstash;

  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    if (!avisoSemTokenEmitido) {
      avisoSemTokenEmitido = true;
      console.warn("[Guardiao Pix] QSTASH_TOKEN ausente — cadeia server-side desativada, usando apenas polling do painel/webhook.");
    }
    clienteQstash = null;
    return clienteQstash;
  }

  clienteQstash = new Client({ token });
  return clienteQstash;
}

export type AgendarTickInput = {
  pedidoId: string;
  geracao: number;
  tentativa: number;
  delayMs: number;
};

// Publica um único tick futuro. Nunca lança — falha de agendamento não pode
// derrubar a criação do Pix nem a reconciliação em andamento; o polling do
// painel continua como rede de segurança se a cadeia parar de avançar.
export async function agendarProximaVerificacaoPixGuardiao(input: AgendarTickInput): Promise<boolean> {
  const client = obterClienteQstash();
  if (!client) return false;
  if (input.tentativa > QSTASH_MAX_TENTATIVAS_CADEIA) return false;

  const delaySegundos = Math.max(1, Math.round(input.delayMs / 1000));
  try {
    await client.publishJSON({
      url: endpointVerificacaoUrl(),
      body: { pedidoId: input.pedidoId, geracao: input.geracao, tentativa: input.tentativa },
      delay: delaySegundos,
      deduplicationId: gerarDeduplicationIdGuardiaoPix(input.pedidoId, input.geracao, input.tentativa),
      retries: PIX_GUARDIAO_QSTASH_RETRIES,
      // FlowControl é uma segunda camada de proteção contra picos de
      // invocação da função — quem decide de fato se uma consulta ao
      // Mercado Pago acontece continua sendo o Sentinela via Redis, não
      // isto. Parallelism 0 (ou variável ausente/inválida) usa o padrão
      // central; ver PIX_GUARDIAO_QSTASH_FLOW_CONTROL_PARALLELISM.
      ...(PIX_GUARDIAO_QSTASH_FLOW_CONTROL_PARALLELISM > 0
        ? { flowControl: { key: PIX_GUARDIAO_QSTASH_FLOW_CONTROL_KEY, parallelism: PIX_GUARDIAO_QSTASH_FLOW_CONTROL_PARALLELISM } }
        : {}),
    });
    await incrementarContadorPix("qstash_mensagens_publicadas");
    return true;
  } catch (error) {
    console.error("[Guardiao Pix] Falha ao agendar tick via QStash", {
      pedidoId: input.pedidoId,
      geracao: input.geracao,
      tentativa: input.tentativa,
      motivo: error instanceof Error ? error.message : "erro_desconhecido",
    });
    return false;
  }
}

// Chamada exatamente uma vez, logo após o Mercado Pago aceitar a cobrança
// Pix (prepararPixProviderMercadoPago). Lock NX no Redis evita iniciar duas
// cadeias para o mesmo pedido caso a criação seja repetida por qualquer
// motivo — a segunda chamada é um no-op silencioso. Também cria o estado
// operacional inicial do Sentinela (geração 1) antes de publicar o primeiro
// tick, para o endpoint já encontrar um estado consistente na primeira
// entrega do QStash.
export async function iniciarCadeiaGuardiaoPix(pedidoId: string): Promise<void> {
  if (!pedidoId) return;
  const client = obterClienteQstash();
  if (!client) return;

  try {
    const ttlSegundos = Math.ceil(PIX_GUARDIAO_IDADE_MAXIMA_MS / 1000) + 60;
    const lockAdquirido = await redis.set(`${QSTASH_CHAIN_LOCK_PREFIXO}${pedidoId}`, "1", {
      nx: true,
      ex: ttlSegundos,
    });
    if (!lockAdquirido) return;

    const agora = Date.now();
    const estado = await iniciarEstadoSentinela({ pedidoId, agora });

    const publicado = await agendarProximaVerificacaoPixGuardiao({
      pedidoId,
      geracao: estado.geracao,
      tentativa: 1,
      delayMs: PIX_AUTO_CHECK_INITIAL_INTERVAL_MS,
    });

    // Publicação falhou (rede, QStash indisponível, payload rejeitado etc.):
    // libera o lock imediatamente em vez de deixar o pedido bloqueado até o
    // TTL expirar — sem isso, nenhuma nova tentativa de iniciar a cadeia
    // seria possível por até PIX_GUARDIAO_IDADE_MAXIMA_MS + 60s. Quando a
    // publicação tem sucesso, o lock é preservado normalmente (cadeia já
    // está em andamento; uma segunda chamada deve continuar sendo no-op).
    if (!publicado) {
      await redis.del(`${QSTASH_CHAIN_LOCK_PREFIXO}${pedidoId}`).catch(() => {});
    }
  } catch (error) {
    console.error("[Guardiao Pix] Falha ao iniciar cadeia server-side", {
      pedidoId,
      motivo: error instanceof Error ? error.message : "erro_desconhecido",
    });
  }
}
