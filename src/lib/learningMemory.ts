// ============================================================================
// MEMÓRIA DE CONVERSÃO (Conversion Memory)
// ----------------------------------------------------------------------------
// Banco SEGURO de casos resolvidos pela IA do Guardião de Venda (BECO / SAIDA).
// Guarda RESUMOS estruturados (não a conversa bruta) para, no futuro, orientar a
// ABORDAGEM da IA em situações parecidas.
//
// Primeira versão: apenas COLETA dados e cria a estrutura. NÃO influencia ainda a
// resposta automática e NÃO chama IA para nada.
//
// Garantias de segurança:
//   • Nunca define preço, taxa, bairro, cardápio ou pagamento — o fluxo rígido
//     continua sendo a fonte da verdade.
//   • Não guarda comprovante Pix, endereço completo nem dados pessoais além do
//     necessário (telefone é anonimizado; valores em R$ e sequências longas de
//     dígitos são redigidos).
//   • Todas as operações são best-effort (try/catch) e nunca alteram a sessão.
// ============================================================================

import { redis } from "./redis";

export type ConversionPath = "BECO" | "SAIDA";

export type ResultadoRetomada =
  | "PENDENTE"
  | "RECUPEROU_VENDA"
  | "CLIENTE_CONTINUOU"
  | "CLIENTE_ABANDONOU"
  | "PRECISOU_HUMANO";

export interface CasoResolvido {
  id: string;
  conversaId: string;        // telefone anonimizado ou id de conversa
  restauranteId?: string;
  path: ConversionPath;
  step: string;
  mensagemCliente: string;   // resumida e redigida
  ultimasMensagens: string[]; // duas últimas relevantes, resumidas
  carrinhoResumo: string;    // só nomes/sabor/tamanho — sem preços
  respostaIA: string;        // redigida (sem valores)
  respostaFinal: string;     // o que foi realmente enviado (redigido)
  resultado: ResultadoRetomada;
  tags: string[];
  timestamp: number;
}

export interface ResumirCasoInput {
  conversaId: string;
  restauranteId?: string;
  path: ConversionPath;
  step: string;
  mensagemCliente: string;
  ultimasMensagens?: Array<{ autor?: string; texto: string } | string>;
  carrinho?: Array<{ name: string; size?: string; flavor?: string }>;
  respostaIA: string;
  respostaFinal?: string;
  deliveryType?: string;
  faltas?: string[];
  tagsExtra?: string[];
  resultado?: ResultadoRetomada;
}

const CHAVE_BANCO = "memoria_conversao:casos";
const MAX_CASOS = 200;
const TTL_BANCO = 90 * 24 * 60 * 60; // 90 dias
const TTL_PENDENTE = 1800; // 30 min, alinhado com a sessão
const MAX_TEXTO = 200;

function chavePendente(phone: string): string {
  return `caso_pendente:${phone}`;
}

// Redige valores monetários e sequências longas de dígitos (telefone/CPF/etc.) e
// trunca o texto. A memória NUNCA deve carregar preço como "regra" nem PII.
export function redigirTexto(texto: string, maxLen = MAX_TEXTO): string {
  if (!texto) return "";
  let t = texto
    .replace(/r\$\s*\d[\d.,]*/gi, "[valor]")        // R$ 50, R$ 50,00
    .replace(/\b\d+[.,]?\d*\s*(reais|real)\b/gi, "[valor]") // 50 reais
    .replace(/\d[\d\s.\-()]{5,}\d/g, "[numero]")    // sequências longas (telefone/cpf)
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > maxLen) t = t.slice(0, maxLen).trimEnd() + "…";
  return t;
}

// Anonimiza o identificador da conversa: telefone vira "***" + 4 últimos dígitos.
export function anonimizarConversaId(idOuTelefone: string): string {
  const apenasDigitos = (idOuTelefone || "").replace(/\D/g, "");
  if (apenasDigitos.length >= 4) return "***" + apenasDigitos.slice(-4);
  return idOuTelefone ? "conv-" + idOuTelefone.slice(-6) : "conv-anon";
}

function resumirCarrinho(carrinho?: Array<{ name: string; size?: string; flavor?: string }>): string {
  if (!carrinho || carrinho.length === 0) return "(carrinho vazio)";
  return carrinho
    .map(i => [i.name, i.size, i.flavor].filter(Boolean).join(" "))
    .join(", ")
    .slice(0, MAX_TEXTO);
}

function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function gerarId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// Monta um CasoResolvido estruturado e SANITIZADO a partir do contexto. Função
// pura: não persiste nada, não chama IA e não toca na sessão.
export function resumirCasoParaAprendizado(input: ResumirCasoInput): CasoResolvido {
  const ultimas = (input.ultimasMensagens ?? [])
    .map(m => (typeof m === "string" ? m : `${m.autor ? m.autor + ": " : ""}${m.texto}`))
    .map(t => redigirTexto(t, 140))
    .slice(-2);

  const faltas = input.faltas ?? [];
  const tags = Array.from(new Set([
    `path:${input.path}`,
    `step:${input.step}`,
    input.carrinho && input.carrinho.length > 0 ? "tem_carrinho" : "carrinho_vazio",
    ...(input.deliveryType ? [`entrega:${slug(input.deliveryType)}`] : []),
    ...faltas.map(f => `falta:${slug(f)}`),
    ...(input.tagsExtra ?? []).map(t => slug(t)),
  ].filter(Boolean)));

  const respostaIA = redigirTexto(input.respostaIA, MAX_TEXTO);

  // Em etapas de endereço, a mensagem do cliente costuma SER o endereço completo —
  // não guardamos o texto bruto (só o fato de estar nessa etapa).
  const stepEndereco = ["address", "confirm_address"].includes(input.step);
  const mensagemCliente = stepEndereco
    ? "[mensagem omitida — etapa de endereço]"
    : redigirTexto(input.mensagemCliente, MAX_TEXTO);

  return {
    id: gerarId(),
    conversaId: anonimizarConversaId(input.conversaId),
    ...(input.restauranteId ? { restauranteId: input.restauranteId } : {}),
    path: input.path,
    step: input.step,
    mensagemCliente,
    ultimasMensagens: ultimas,
    carrinhoResumo: resumirCarrinho(input.carrinho),
    respostaIA,
    respostaFinal: redigirTexto(input.respostaFinal ?? input.respostaIA, MAX_TEXTO),
    resultado: input.resultado ?? "PENDENTE",
    tags,
    timestamp: Date.now(),
  };
}

// Persiste um caso FINALIZADO no banco (lista rotativa, limitada). Best-effort.
export async function salvarCasoResolvido(caso: CasoResolvido): Promise<void> {
  try {
    const banco = (await redis.get<CasoResolvido[]>(CHAVE_BANCO)) || [];
    banco.push(caso);
    await redis.set(CHAVE_BANCO, banco.slice(-MAX_CASOS), { ex: TTL_BANCO });
  } catch {
    // memória é best-effort; nunca propaga erro para o fluxo do bot
  }
}

// Classifica o RESULTADO de uma retomada a partir de sinais determinísticos
// (sem IA). Função pura.
export function avaliarResultadoDaRetomada(sinais: {
  pedidoFechado?: boolean;
  precisouHumano?: boolean;
  abandonou?: boolean;
  continuou?: boolean;
  stepAntes?: string;
  stepDepois?: string;
}): ResultadoRetomada {
  if (sinais.pedidoFechado) return "RECUPEROU_VENDA";
  if (sinais.precisouHumano) return "PRECISOU_HUMANO";
  if (sinais.abandonou) return "CLIENTE_ABANDONOU";
  if (sinais.continuou) return "CLIENTE_CONTINUOU";
  if (sinais.stepAntes && sinais.stepDepois && sinais.stepAntes !== sinais.stepDepois) {
    return "CLIENTE_CONTINUOU";
  }
  return "CLIENTE_CONTINUOU";
}

// Busca casos parecidos por path, step e tags. Prioriza abordagens que deram
// certo (RECUPEROU_VENDA / CLIENTE_CONTINUOU). Apenas LEITURA — não influencia
// ainda nenhuma resposta (reservado para a 2ª etapa).
export async function buscarCasosParecidos(query: {
  path?: ConversionPath;
  step?: string;
  tags?: string[];
  limite?: number;
}): Promise<CasoResolvido[]> {
  try {
    const banco = (await redis.get<CasoResolvido[]>(CHAVE_BANCO)) || [];
    const qtags = new Set(query.tags ?? []);
    const pontuados = banco
      .filter(c => c.resultado !== "PENDENTE")
      .map(c => {
        let score = 0;
        if (query.path && c.path === query.path) score += 3;
        if (query.step && c.step === query.step) score += 2;
        score += (c.tags || []).filter(t => qtags.has(t)).length;
        if (c.resultado === "RECUPEROU_VENDA") score += 2;
        else if (c.resultado === "CLIENTE_CONTINUOU") score += 1;
        return { c, score };
      })
      .filter(p => p.score > 0)
      .sort((a, b) => b.score - a.score || b.c.timestamp - a.c.timestamp);
    return pontuados.slice(0, query.limite ?? 3).map(p => p.c);
  } catch {
    return [];
  }
}

// ── Ciclo de vida do caso PENDENTE (suporte à integração no webhook) ──────────
// O caso é registrado como PENDENTE quando o Guardião usa IA, e finalizado na
// próxima interação do cliente. Pendentes ficam num key efêmero (não no banco).

export async function registrarCasoPendente(phone: string, caso: CasoResolvido): Promise<void> {
  try {
    await redis.set(chavePendente(phone), caso, { ex: TTL_PENDENTE });
  } catch {
    // best-effort
  }
}

// Lê e REMOVE o caso pendente (consumo único).
export async function consumirCasoPendente(phone: string): Promise<CasoResolvido | null> {
  try {
    const caso = await redis.get<CasoResolvido>(chavePendente(phone));
    if (caso) await redis.del(chavePendente(phone));
    return caso ?? null;
  } catch {
    return null;
  }
}
