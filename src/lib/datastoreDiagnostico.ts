// Diagnóstico seguro de falha do datastore (Upstash/Vercel KV via REST).
//
// Existe por causa do incidente de /pedidos: a tela ficava em "Carregando..."
// porque GET /api/orders devolvia 500, e o 500 do Next não carrega NENHUMA
// pista do erro real do provedor. Sem acesso ao painel da Vercel, o operador
// ficava sem saber se o problema era credencial, cota, cobrança ou rede.
//
// Este módulo transforma o erro bruto do provedor numa CLASSE curta e numa
// mensagem já higienizada. Nunca devolve URL do datastore, token, senha,
// header Authorization, telefone ou qualquer dado de cliente.

export type ClasseFalhaDatastore =
  /** As variáveis de ambiente do datastore não estão presentes no runtime. */
  | "configuracao_ausente"
  /** O provedor recusou a credencial (401/403, WRONGPASS, invalid token). */
  | "credencial_rejeitada"
  /** Cota de requisições do plano estourada. */
  | "cota_excedida"
  /** Conta/banco suspenso, desabilitado ou com cobrança pendente. */
  | "pagamento_ou_suspensao"
  /** Rate limit momentâneo (429). */
  | "limite_de_taxa"
  /** A requisição ao provedor estourou o tempo. */
  | "timeout"
  /** Rede/DNS/TLS: não foi possível sequer falar com o provedor. */
  | "indisponivel"
  /** Nada acima bateu — a mensagem higienizada é a única pista. */
  | "desconhecido";

const VARIAVEIS_DATASTORE = ["KV_REST_API_URL", "KV_REST_API_TOKEN"] as const;

/** true quando as duas variáveis do datastore existem e não estão vazias. */
export function datastoreConfigurado(env: Record<string, string | undefined> = process.env): boolean {
  return VARIAVEIS_DATASTORE.every((nome) => (env[nome] ?? "").trim().length > 0);
}

/** Quais variáveis do datastore estão faltando — só os NOMES, nunca os valores. */
export function variaveisDatastoreAusentes(
  env: Record<string, string | undefined> = process.env
): string[] {
  return VARIAVEIS_DATASTORE.filter((nome) => (env[nome] ?? "").trim().length === 0);
}

/**
 * Remove do texto qualquer coisa que possa ser segredo ou PII: os valores das
 * variáveis do datastore, endpoints do provedor, tokens em header, sequências
 * longas que pareçam credencial e números longos (telefone/documento).
 */
export function higienizarMensagemDatastore(
  entrada: unknown,
  env: Record<string, string | undefined> = process.env
): string {
  const bruto = entrada instanceof Error ? entrada.message : String(entrada ?? "");
  let texto = bruto;

  for (const nome of VARIAVEIS_DATASTORE) {
    const valor = (env[nome] ?? "").trim();
    if (valor.length >= 8) texto = texto.split(valor).join("[oculto]");
  }

  return texto
    .replace(/https?:\/\/[^\s"')]+/gi, "[endpoint]")
    .replace(/bearer\s+\S+/gi, "bearer [oculto]")
    .replace(/[A-Za-z0-9_-]{28,}/g, "[oculto]")
    .replace(/\d{8,}/g, "[numero]")
    .trim()
    .slice(0, 200);
}

/** Status HTTP do provedor, quando o erro carrega um. */
function statusDoErro(erro: unknown): number | null {
  const candidato = erro as { status?: unknown; statusCode?: unknown } | null;
  for (const valor of [candidato?.status, candidato?.statusCode]) {
    if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  }
  const match = /\b(4\d{2}|5\d{2})\b/.exec(erro instanceof Error ? erro.message : String(erro ?? ""));
  return match ? Number(match[1]) : null;
}

/**
 * Classifica a falha. A ordem importa: sinais específicos (cota, cobrança)
 * vencem sinais genéricos (401), porque a Upstash devolve 401 tanto para
 * token inválido quanto para banco desabilitado por cobrança — a palavra na
 * mensagem é o que distingue os dois, e distinguir muda a ação do operador.
 */
export function classificarFalhaDatastore(
  erro: unknown,
  env: Record<string, string | undefined> = process.env
): { classe: ClasseFalhaDatastore; statusProvedor: number | null; mensagem: string } {
  const mensagem = higienizarMensagemDatastore(erro, env);
  const statusProvedor = statusDoErro(erro);

  if (!datastoreConfigurado(env)) {
    return { classe: "configuracao_ausente", statusProvedor, mensagem };
  }

  const t = (erro instanceof Error ? erro.message : String(erro ?? "")).toLowerCase();

  const contem = (...termos: string[]) => termos.some((termo) => t.includes(termo));

  if (contem("max requests limit", "monthly request limit", "quota", "daily request limit", "exceeded the")) {
    return { classe: "cota_excedida", statusProvedor, mensagem };
  }
  if (contem("payment required", "billing", "suspend", "disabled", "deactivated", "past due")) {
    return { classe: "pagamento_ou_suspensao", statusProvedor, mensagem };
  }
  if (statusProvedor === 402) return { classe: "pagamento_ou_suspensao", statusProvedor, mensagem };
  if (statusProvedor === 429 || contem("rate limit", "too many requests")) {
    return { classe: "limite_de_taxa", statusProvedor, mensagem };
  }
  if (contem("unauthorized", "wrongpass", "noauth", "invalid token", "forbidden", "authentication")) {
    return { classe: "credencial_rejeitada", statusProvedor, mensagem };
  }
  if (statusProvedor === 401 || statusProvedor === 403) {
    return { classe: "credencial_rejeitada", statusProvedor, mensagem };
  }
  if (contem("timeout", "timed out", "etimedout", "aborted")) {
    return { classe: "timeout", statusProvedor, mensagem };
  }
  if (contem("fetch failed", "econnrefused", "econnreset", "enotfound", "eai_again", "network", "socket", "tls", "certificate", "dns")) {
    return { classe: "indisponivel", statusProvedor, mensagem };
  }

  return { classe: "desconhecido", statusProvedor, mensagem };
}

/** O que o operador precisa fazer para cada classe. Texto curto e acionável. */
export const ACAO_SUGERIDA: Record<ClasseFalhaDatastore, string> = {
  configuracao_ausente:
    "KV_REST_API_URL e/ou KV_REST_API_TOKEN não chegaram ao runtime de Production. Reconectar a integração do datastore no projeto Vercel e refazer o deploy.",
  credencial_rejeitada:
    "O provedor recusou a credencial. Gerar/copiar novamente o token REST no painel do datastore e atualizar as variáveis em Production.",
  cota_excedida:
    "A cota de requisições do plano do datastore acabou. Conferir o uso no painel do provedor; só volta ao normal com a virada do ciclo ou upgrade de plano.",
  pagamento_ou_suspensao:
    "O datastore está suspenso ou com cobrança pendente. Regularizar no painel do provedor — nenhuma mudança de código resolve.",
  limite_de_taxa: "Rate limit momentâneo do datastore. Costuma normalizar sozinho; se persistir, conferir o plano.",
  timeout: "O datastore não respondeu a tempo. Conferir status/região do provedor.",
  indisponivel: "Não foi possível falar com o datastore (rede/DNS/TLS). Conferir status do provedor.",
  desconhecido: "Falha não catalogada. A mensagem higienizada do provedor é a pista inicial.",
};
