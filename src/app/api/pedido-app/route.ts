import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { redis } from "@/lib/redis";
import { proximoNumeroPedido } from "@/lib/numeracao";
import { getMENUDinamico } from "@/lib/menu";
import { computeTaxaApp, buildEnderecoApp } from "@/lib/pedidoAppLogic";
import { criarPixMetadata, prepararPixProviderMercadoPago, serializarPixCliente, gerarTxidPixInterno, type PixMetadata } from "@/lib/pix";
import { PROMOS_KEY, catalogoDoMenu, dentroDaJanela, precoFinalPromocao, promocaoIndisponivel, type Promocao } from "@/lib/promocoes";
import { validarTokenCardapio } from "@/lib/cardapioToken";
import { temDinheiroNoPagamento, valorDinheiroEsperado, temPixNoPagamento, valorPixEsperado } from "@/lib/bot";
import { verificarTokenCliente, CLIENTE_COOKIE } from "@/lib/clienteAuth";
import { buscarClientePorId, sanitizeTelefoneCliente } from "@/lib/clientes";
import { calcularPontosElegiveisPedido, registrarMovimentoPontosIdempotente, construirEventoIdPontos, derivarClienteIdPorTelefone, obterReservasResgatePontos, confirmarResgatePontos } from "@/lib/fidelidade";
import { type ItemApp, type MenuPedidoApp, formatItem, officialUnitPrice, makePromoUnitPrice, contarPizzasPagasParaFidelidade } from "@/lib/pedidoAppItens";
import { prepararResgateParaPedido, confirmarReservaNoPedido, liberarVinculoRecompensaPedidoNaoCriado, type EscolhaRecompensaJornada } from "@/lib/jornadaChef";
import { survivalModeEnabled, survivalClientRequestIdEnforcementEnabled } from "@/survival/flags";
import { hashClientRequestId, sanitizeClientRequestId } from "@/survival/clientRequestId";
import { calcularRequestFingerprint } from "@/survival/requestFingerprint";
import { logSurvivalErro } from "@/survival/logging";
import {
  ATTEMPT_TTL_SEGUNDOS,
  CLAIM_TTL_SEGUNDOS,
  GRAVAR_RESULTADO_E_TOKEN_SCRIPT,
  INVALIDAR_RESULTADO_SE_TOKEN_SCRIPT,
  LIBERAR_CLAIM_SE_DONO_SCRIPT,
  POLL_INTERVALO_MS,
  POLL_TENTATIVAS,
  RESULT_TTL_SEGUNDOS,
  calcularPricingFingerprint,
  chaveAttemptPedido,
  chaveClaimPedido,
  chaveResultadoPedido,
  chaveResultadoTokenPedido,
  ehAttemptValido,
  ehResultadoIdempotenciaValido,
  extrairFingerprintDoClaim,
  montarValorClaim,
  type RegistroAttemptPedido,
  type ResultadoIdempotenciaPedido,
  type SnapshotFinanceiroAttempt,
} from "@/survival/pedidoIdempotencia";

export const maxDuration = 20;

type PedidoApp = {
  cliente: string;
  telefone?: string;
  whatsappToken?: string;
  usarOutroWhatsapp?: boolean;
  itens: ItemApp[];
  tipoEntrega: "delivery" | "retirada" | "dine_in";
  bairro?: string;
  rua?: string;
  numero?: string;
  referencia?: string;
  pagamento: string;
  troco?: string;
  observacao?: string;
  email?: string;
  /** resgateId de uma reserva de fidelidade (POST /api/cliente/fidelidade/resgate) aplicada neste pedido. */
  resgateId?: string;
  /** Presente da Jornada do Chef aplicado neste pedido — campo dedicado,
   * nunca um item arbitrário do carrinho. O frontend só pode informar QUAL
   * recompensa reservada usar e (quando aplicável) o sabor da pizza; tudo o
   * mais (produto, preço, quantidade, tamanho, composição) é reconstruído no
   * servidor a partir do snapshot da própria recompensa — nunca confiado do
   * cliente (ver `materializarItensRecompensa` em @/lib/jornadaChef). */
  recompensaJornada?: { recompensaId: string; escolha?: EscolhaRecompensaJornada };
  /** Modo Sobrevivência (Etapa 1): identificador gerado uma vez pelo
   * navegador por tentativa de checkout, reaproveitado em retries. Só tem
   * efeito quando SURVIVAL_MODE_ENABLED=true; ausente/ignorado do
   * contrário. Nunca contém PII (ver src/survival/clientRequestId.ts). */
  clientRequestId?: string;
};

type ConfigPizzariaPix = {
  nomePizzaria?: string;
  chavePix?: string;
  nomeTitularPix?: string;
  whatsappPizzaria?: string;
};

/** Resposta pública de sucesso — `pix`/`degradado` são opcionais; `degradado`
 * sinaliza que o pedido foi confirmado de verdade mas algum dado secundário
 * (ex.: serialização do Pix) não pôde ser recuperado nesta resposta. */
type PedidoAppRespostaSucesso = {
  ok: true;
  pedidoId: string;
  numero: number;
  total: number;
  statusToken: string;
  pix?: unknown;
  degradado?: true;
};

/**
 * Estado interno de consistência do pedido — nunca exposto ao cliente
 * (revisão de segurança #4). Só existe quando há um efeito crítico
 * posterior à persistência (hoje, só o resgate de fidelidade):
 *
 * - `pending_critical_confirmation`: pedido persistido, mas o efeito
 *   crítico (débito do resgate) ainda não foi confirmado. NUNCA pode ser
 *   reconstruído como sucesso pela busca por hash nem pelo fast path.
 * - `completed`: efeito crítico confirmado (ou não havia nenhum) — único
 *   estado em que a idempotência pode devolver sucesso.
 * - `recovery_required`: a confirmação do efeito crítico falhou E o
 *   rollback do pedido TAMBÉM falhou — inconsistência que exige
 *   intervenção operacional. Tratado de forma idêntica a
 *   `pending_critical_confirmation` pelas buscas de idempotência (nunca
 *   sucesso), mas logado com um código distinto para investigação.
 *
 * Pedidos sem `clientRequestId` (flag desligada) nunca recebem este campo —
 * `undefined` é tratado como equivalente a `completed` (comportamento de
 * antes deste programa, sem nenhuma verificação adicional).
 */
type SurvivalPedidoState = "pending_critical_confirmation" | "completed" | "recovery_required";

// Recebe o PEDIDO INTEIRO (não só o campo survivalState) de propósito —
// revisão de segurança, 4ª rodada, ponto 1 (itens 4-6): um pedido que
// PASSOU pelo Modo Sobrevivência (tem o hash da tentativa gravado) só pode
// ser reconstruído como sucesso quando survivalState for EXATAMENTE
// "completed" — undefined, null, string desconhecida ou qualquer valor
// malformado bloqueia, nunca é tratado como "sem restrição". Pedidos
// ANTIGOS, sem o hash (criados antes deste programa ou com a flag
// desligada), nunca tiveram esse campo e mantêm o comportamento anterior —
// nunca bloqueados por esta função (e, na prática, nunca seriam encontrados
// por um hash de clientRequestId de qualquer forma).
function survivalStateBloqueiaSucesso(pedido: PedidoArmazenado): boolean {
  if (!pedido.survivalClientRequestIdHash) return false;
  return pedido.survivalState !== ("completed" satisfies SurvivalPedidoState);
}

type PedidoArmazenado = {
  id?: unknown;
  numero?: unknown;
  statusToken?: unknown;
  total?: unknown;
  pix?: PixMetadata;
  /** Hash (nunca o valor bruto) do clientRequestId da tentativa que criou
   * este pedido — única prova durável dentro do próprio pedido persistido,
   * usada para recuperar a idempotência quando `:claim`/`:result` já
   * expiraram ou nunca chegaram a ser gravados (ver revisão de segurança,
   * ponto 1 — "lacuna após expiração do claim"). */
  survivalClientRequestIdHash?: unknown;
  survivalRequestFingerprint?: unknown;
  survivalState?: unknown;
};

function criarTokenPublicoAcompanhamento(): string {
  return randomUUID().replace(/-/g, "");
}

async function getConfigPix(): Promise<ConfigPizzariaPix> {
  return (await redis.get<ConfigPizzariaPix>("config:pizzaria")) || {};
}

function respostaClaimIncerto(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      unresolved: true,
      error: "Não foi possível confirmar se o pedido foi recebido. Seu carrinho foi preservado — verifique antes de tentar novamente.",
    },
    { status: 503 }
  );
}

function respostaConflitoFingerprint(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Este identificador de tentativa já foi usado com dados diferentes. Reinicie o checkout." },
    { status: 409 }
  );
}

function respostaAindaProcessando(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Este pedido já está sendo processado. Aguarde alguns segundos e verifique antes de tentar de novo." },
    { status: 409 }
  );
}

// Reconstrói a resposta de sucesso a partir do pedido REAL já persistido
// (nunca de um total/Pix cacheado às cegas — ver revisão de segurança,
// ponto 6): total e Pix são sempre lidos frescos do PRÓPRIO PEDIDO + config
// atual — nunca de um valor gravado antecipadamente no registro de
// idempotência. Se o Pix não puder ser serializado (config indisponível),
// a resposta ainda confirma o pedido, só sem o campo `pix` (`degradado`) —
// nunca gera uma segunda cobrança nem inventa dado de pagamento.
async function montarRespostaAPartirDoPedido(
  pedido: PedidoArmazenado,
  pedidoId: string,
  numero: number,
  statusToken: string
): Promise<PedidoAppRespostaSucesso> {
  let pixCliente: ReturnType<typeof serializarPixCliente>;
  let degradado = false;
  try {
    const configPix = await getConfigPix();
    pixCliente = serializarPixCliente(pedido.pix, configPix);
  } catch (err) {
    degradado = true;
    logSurvivalErro("idempotencia_pedido", "reconstrucao", "config_pix_falhou", err);
  }

  return {
    ok: true,
    pedidoId,
    numero,
    total: typeof pedido.total === "number" ? pedido.total : 0,
    statusToken,
    ...(pixCliente ? { pix: pixCliente } : {}),
    ...(degradado ? { degradado: true as const } : {}),
  };
}

type ResultadoBuscaPedidoPorId =
  | { tipo: "encontrado"; pedido: PedidoArmazenado }
  | { tipo: "nao_encontrado" }
  | { tipo: "incerto" };

// Distingue explicitamente "Redis falhou ao ler" de "leitura funcionou e o
// pedido não existe" (revisão de segurança, ponto 4) — os dois casos exigem
// tratamento diferente: o primeiro é sempre 503 recuperável; o segundo é
// que torna um :result "stale" (aponta para um pedido que comprovadamente
// não existe mais) elegível para invalidação segura.
async function buscarPedidoPersistidoPorId(pedidoId: string): Promise<ResultadoBuscaPedidoPorId> {
  let pedidosAtuais: PedidoArmazenado[];
  try {
    pedidosAtuais = (await redis.get<PedidoArmazenado[]>("pedidos")) || [];
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "busca_por_id", "get_pedidos_falhou", err);
    return { tipo: "incerto" };
  }
  const pedido = pedidosAtuais.find((p) => p && p.id === pedidoId);
  return pedido ? { tipo: "encontrado", pedido } : { tipo: "nao_encontrado" };
}

type ResultadoReconciliacaoCompleta =
  | { tipo: "encontrado"; pedido: PedidoArmazenado }
  | { tipo: "nao_encontrado" }
  | { tipo: "incerto" }
  | { tipo: "inconsistente" };

// 7ª revisão de segurança, ponto 3: `pedido.id === pedidoId` sozinho NÃO
// comprova que o pedido encontrado é o MESMO cuja criação lançou a exceção
// reconciliada — pedidoId é derivado de Date.now() (risco de colisão já
// documentado em DECISAO-CONCORRENCIA-CHAVE-PEDIDOS.md) e uma leitura da
// chave única "pedidos" sob concorrência pode, em tese, expor um estado
// intermediário. Antes de tratar qualquer pedido encontrado como "o pedido
// desta tentativa", confirma a IDENTIDADE COMPLETA: hash do clientRequestId,
// fingerprint da requisição, correspondência ÚNICA (nunca mais de um pedido
// com o mesmo id), e que os campos essenciais (numero, statusToken, total,
// survivalState, txid do Pix) sejam valores válidos — nunca aproveita
// numero/statusToken/Pix de um pedido só porque o id bateu.
async function reconciliarIdentidadeCompletaAposFalha(
  pedidoId: string,
  clientRequestIdHash: string,
  requestFingerprint: string
): Promise<ResultadoReconciliacaoCompleta> {
  let pedidosAtuais: PedidoArmazenado[];
  try {
    pedidosAtuais = (await redis.get<PedidoArmazenado[]>("pedidos")) || [];
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "reconciliacao_identidade_completa", "get_pedidos_falhou", err);
    return { tipo: "incerto" };
  }

  const candidatos = pedidosAtuais.filter((p) => p && p.id === pedidoId);
  if (candidatos.length === 0) return { tipo: "nao_encontrado" };
  if (candidatos.length > 1) {
    logSurvivalErro("idempotencia_pedido", "reconciliacao_identidade_completa", "multiplos_pedidos_mesmo_id");
    return { tipo: "inconsistente" };
  }

  const pedido = candidatos[0];

  if (pedido.survivalClientRequestIdHash !== clientRequestIdHash) {
    logSurvivalErro("idempotencia_pedido", "reconciliacao_identidade_completa", "hash_divergente");
    return { tipo: "inconsistente" };
  }
  if (pedido.survivalRequestFingerprint !== requestFingerprint) {
    logSurvivalErro("idempotencia_pedido", "reconciliacao_identidade_completa", "fingerprint_divergente");
    return { tipo: "inconsistente" };
  }
  if (
    pedido.survivalState !== undefined &&
    pedido.survivalState !== "pending_critical_confirmation" &&
    pedido.survivalState !== "completed" &&
    pedido.survivalState !== "recovery_required"
  ) {
    logSurvivalErro("idempotencia_pedido", "reconciliacao_identidade_completa", "survival_state_invalido");
    return { tipo: "inconsistente" };
  }
  if (pedido.numero !== undefined && (typeof pedido.numero !== "number" || !Number.isInteger(pedido.numero))) {
    logSurvivalErro("idempotencia_pedido", "reconciliacao_identidade_completa", "numero_invalido");
    return { tipo: "inconsistente" };
  }
  if (pedido.statusToken !== undefined && typeof pedido.statusToken !== "string") {
    logSurvivalErro("idempotencia_pedido", "reconciliacao_identidade_completa", "status_token_invalido");
    return { tipo: "inconsistente" };
  }
  if (pedido.total !== undefined && (typeof pedido.total !== "number" || !Number.isFinite(pedido.total) || pedido.total < 0)) {
    logSurvivalErro("idempotencia_pedido", "reconciliacao_identidade_completa", "total_invalido");
    return { tipo: "inconsistente" };
  }
  if (pedido.pix && typeof pedido.pix.txid === "string" && pedido.pix.txid !== gerarTxidPixInterno(pedidoId)) {
    logSurvivalErro("idempotencia_pedido", "reconciliacao_identidade_completa", "pix_txid_nao_corresponde");
    return { tipo: "inconsistente" };
  }

  return { tipo: "encontrado", pedido };
}

type ResultadoReconstrucao =
  | { tipo: "sucesso"; resposta: PedidoAppRespostaSucesso }
  | { tipo: "pendente_critico" }
  | { tipo: "stale" }
  | { tipo: "incerto" };

async function reconstruirRespostaPedido(registro: ResultadoIdempotenciaPedido): Promise<ResultadoReconstrucao> {
  const busca = await buscarPedidoPersistidoPorId(registro.pedidoId);
  if (busca.tipo === "incerto") return { tipo: "incerto" };
  if (busca.tipo === "nao_encontrado") {
    // :result aponta para um pedido que comprovadamente não existe mais —
    // stale, não incerto. O chamador decide invalidar o :result e seguir.
    logSurvivalErro("idempotencia_pedido", "reconstrucao", "resultado_stale_pedido_ausente");
    return { tipo: "stale" };
  }
  if (survivalStateBloqueiaSucesso(busca.pedido)) {
    // Pedido existe, mas ainda não passou por um efeito crítico posterior à
    // persistência (resgate) ou ficou em inconsistência que exige
    // intervenção — NUNCA reconstruído como sucesso (revisão de segurança,
    // ponto 1/5).
    return { tipo: "pendente_critico" };
  }
  const resposta = await montarRespostaAPartirDoPedido(busca.pedido, registro.pedidoId, registro.numero, registro.statusToken);
  return { tipo: "sucesso", resposta };
}

type ResultadoInvalidacaoStale = "removido" | "ja_ausente" | "substituido_por_outro" | "incerto";

// Invalida um :result "stale" com um COMPARE-AND-DELETE ATÔMICO (Lua), nunca
// um GET seguido de um DEL separado (revisão de segurança, 4ª rodada, ponto
// 2): entre o GET e o DEL de duas chamadas separadas, uma execução
// concorrente poderia ler o mesmo registro antigo, uma outra gravar um
// resultado novo, e a primeira apagar esse resultado novo por engano — o
// script Lua fecha essa janela por completo, comparando e apagando (o
// registro principal E a chave-token) numa única operação atômica no Redis.
async function invalidarResultadoStaleAtomico(clientRequestId: string, resultTokenEsperado: string): Promise<ResultadoInvalidacaoStale> {
  try {
    const resultado = await redis.eval(
      INVALIDAR_RESULTADO_SE_TOKEN_SCRIPT,
      [chaveResultadoTokenPedido(clientRequestId), chaveResultadoPedido(clientRequestId)],
      [resultTokenEsperado]
    );
    if (resultado === "removido" || resultado === "ja_ausente" || resultado === "substituido_por_outro") return resultado;
    return "incerto";
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "invalidacao_resultado_stale", "eval_falhou", err);
    return "incerto";
  }
}

type ResultadoResolucaoRapida =
  | { tipo: "resposta"; resposta: NextResponse }
  | { tipo: "prosseguir" };

// Máximo de reconciliações de concorrência antes de desistir com segurança
// (nunca em loop indefinido) — cada iteração só acontece quando OUTRA
// execução grava um :result novo bem no meio da nossa tentativa de invalidar
// um stale (extremamente raro; ver "substituido_por_outro").
const MAX_TENTATIVAS_RESOLUCAO_RESULTADO = 3;

// Consulta o :result existente e, quando "stale" (aponta para um pedido que
// comprovadamente não existe mais), invalida atomicamente e REINICIA a
// consulta (revisão de segurança, 4ª rodada, ponto 2) — nunca prossegue para
// criar um pedido sem antes comprovar que o :result antigo foi removido ou
// já estava ausente. "substituido_por_outro" (uma execução concorrente
// gravou um resultado mais novo entre a nossa leitura e a tentativa de
// invalidar) reinicia a consulta em vez de assumir qualquer coisa sobre o
// registro novo.
async function resolverViaResultadoExistente(clientRequestId: string, requestFingerprint: string): Promise<ResultadoResolucaoRapida> {
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS_RESOLUCAO_RESULTADO; tentativa++) {
    const consultaRapida = await consultarResultadoExistente(clientRequestId, requestFingerprint);
    if (consultaRapida.tipo === "conflito_fingerprint") return { tipo: "resposta", resposta: respostaConflitoFingerprint() };
    if (consultaRapida.tipo === "incerto") return { tipo: "resposta", resposta: respostaClaimIncerto() };
    if (consultaRapida.tipo === "nao_encontrado") return { tipo: "prosseguir" };

    const reconstrucao = await reconstruirRespostaPedido(consultaRapida.registro);
    if (reconstrucao.tipo === "sucesso") return { tipo: "resposta", resposta: NextResponse.json(reconstrucao.resposta) };
    if (reconstrucao.tipo === "pendente_critico") return { tipo: "resposta", resposta: respostaClaimIncerto() };
    if (reconstrucao.tipo === "incerto") return { tipo: "resposta", resposta: respostaClaimIncerto() };

    // "stale": :result existe mas o pedido comprovadamente não existe mais.
    const statusInvalidacao = await invalidarResultadoStaleAtomico(clientRequestId, consultaRapida.registro.resultToken);
    if (statusInvalidacao === "incerto") return { tipo: "resposta", resposta: respostaClaimIncerto() };
    if (statusInvalidacao === "removido" || statusInvalidacao === "ja_ausente") return { tipo: "prosseguir" };
    // "substituido_por_outro": outra execução já gravou um resultado mais
    // novo — reinicia a consulta (próxima iteração do loop) em vez de supor
    // qualquer coisa sobre esse registro novo.
  }
  // Esgotou as tentativas de reconciliar concorrência — nunca prossegue às
  // cegas; pede para o cliente aguardar/tentar de novo (mesmo efeito
  // observável de "ainda processando").
  return { tipo: "resposta", resposta: respostaAindaProcessando() };
}

type ResultadoBuscaPorHash =
  | { tipo: "nao_encontrado" }
  | { tipo: "incerto" }
  | { tipo: "conflito_fingerprint" }
  | { tipo: "pendente_critico" }
  | { tipo: "encontrado"; pedido: PedidoArmazenado };

// Última linha de defesa contra duplicidade (ver revisão de segurança, ponto
// 1): mesmo quando NEM `:claim` NEM `:result` existem mais (TTL expirado,
// gravação de `:result` nunca chegou a acontecer — processo encerrado logo
// depois de persistir), o pedido REAL já persistido em `pedidos` carrega um
// hash do clientRequestId que o criou. Antes de reivindicar um novo claim,
// procura por esse hash — encontrando, NUNCA cria um segundo pedido.
async function buscarPedidoPorClientRequestIdHash(
  clientRequestIdHash: string,
  requestFingerprint: string
): Promise<ResultadoBuscaPorHash> {
  let pedidosAtuais: PedidoArmazenado[];
  try {
    pedidosAtuais = (await redis.get<PedidoArmazenado[]>("pedidos")) || [];
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "busca_por_hash", "get_pedidos_falhou", err);
    return { tipo: "incerto" };
  }
  const pedidoEncontrado = pedidosAtuais.find((p) => p && p.survivalClientRequestIdHash === clientRequestIdHash);
  if (!pedidoEncontrado) return { tipo: "nao_encontrado" };
  if (pedidoEncontrado.survivalRequestFingerprint !== requestFingerprint) return { tipo: "conflito_fingerprint" };
  if (survivalStateBloqueiaSucesso(pedidoEncontrado)) return { tipo: "pendente_critico" };
  return { tipo: "encontrado", pedido: pedidoEncontrado };
}

// Grava o registro principal + a chave-token companheira NUMA ÚNICA
// OPERAÇÃO ATÔMICA (Lua — revisão de segurança, 5ª rodada, ponto 2): as duas
// chaves são sempre escritas juntas (nunca dois SETs separados do lado do
// cliente, que deixariam uma janela em que só uma existe). Se o EVAL
// lançar, NENHUMA das duas chaves é considerada gravada (o chamador trata
// como falha completa, nunca como "gravação parcial aceitável").
async function persistirRegistroResultado(clientRequestId: string, registro: ResultadoIdempotenciaPedido): Promise<void> {
  await redis.eval(
    GRAVAR_RESULTADO_E_TOKEN_SCRIPT,
    [chaveResultadoPedido(clientRequestId), chaveResultadoTokenPedido(clientRequestId)],
    [JSON.stringify(registro), registro.resultToken, String(RESULT_TTL_SEGUNDOS)]
  );
}

// Grava o registro durável de idempotência (24h) — só chamado quando o
// pedido já está no estado "completed" (sem efeito crítico pendente). Uma
// falha aqui NUNCA desfaz o pedido; apenas o claim continua vivo até o TTL
// curto (30s) expirar sozinho (ver revisão de segurança, ponto 5).
async function gravarResultadoDuravel(
  clientRequestId: string,
  requestFingerprint: string,
  pedidoId: string,
  numero: number,
  statusToken: string
): Promise<boolean> {
  try {
    const registro: ResultadoIdempotenciaPedido = {
      state: "completed",
      requestFingerprint,
      pedidoId,
      numero,
      statusToken,
      createdAt: Date.now(),
      resultToken: randomUUID().replace(/-/g, ""),
    };
    await persistirRegistroResultado(clientRequestId, registro);
    return true;
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "finalizacao", "set_result_falhou", err);
    return false;
  }
}

// Atualiza o campo survivalState DENTRO do pedido já persistido (read-modify-write
// pontual sobre "pedidos", mesmo padrão já usado pelo rollback do resgate) —
// nunca cria nem remove um pedido, só corrige seu estado de consistência.
async function marcarSurvivalStateDoPedido(pedidoId: string, novoEstado: SurvivalPedidoState): Promise<boolean> {
  try {
    const pedidosAtuais = (await redis.get<PedidoArmazenado[]>("pedidos")) || [];
    const idx = pedidosAtuais.findIndex((p) => p && p.id === pedidoId);
    if (idx < 0) return false;
    pedidosAtuais[idx] = { ...pedidosAtuais[idx], survivalState: novoEstado };
    await redis.set("pedidos", pedidosAtuais);
    return true;
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "estado_pedido", "atualizar_estado_falhou", err);
    return false;
  }
}

type ResultadoConsultaRapida =
  | { tipo: "nao_encontrado" }
  | { tipo: "conflito_fingerprint" }
  | { tipo: "encontrado"; registro: ResultadoIdempotenciaPedido }
  | { tipo: "incerto" };

// Fast path: já existe um resultado durável (24h) para este clientRequestId?
// Só GET — nenhuma escrita, nenhum efeito colateral.
async function consultarResultadoExistente(clientRequestId: string, requestFingerprint: string): Promise<ResultadoConsultaRapida> {
  let bruto: unknown;
  try {
    bruto = await redis.get(chaveResultadoPedido(clientRequestId));
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "leitura_resultado", "get_result_falhou", err);
    return { tipo: "incerto" };
  }
  if (!bruto) return { tipo: "nao_encontrado" };
  if (!ehResultadoIdempotenciaValido(bruto)) {
    logSurvivalErro("idempotencia_pedido", "leitura_resultado", "resultado_formato_invalido");
    return { tipo: "incerto" };
  }
  if (bruto.requestFingerprint !== requestFingerprint) return { tipo: "conflito_fingerprint" };
  return { tipo: "encontrado", registro: bruto };
}

type ResultadoClaim =
  | { tipo: "claimed" }
  | { tipo: "conflito_fingerprint" }
  | { tipo: "processando_mesmo_fingerprint" }
  | { tipo: "incerto" };

// Reivindica atomicamente (SET NX) o claim de criação para este
// clientRequestId. Qualquer resultado que não seja um SET NX bem-sucedido
// confirmado é tratado com o máximo de cautela: nunca assume "posso criar o
// pedido" quando o estado real do Redis é desconhecido (ver revisão de
// segurança, ponto 1).
async function tentarReivindicarClaim(claimKey: string, valorClaim: string, requestFingerprint: string): Promise<ResultadoClaim> {
  try {
    const reivindicado = await redis.set(claimKey, valorClaim, { nx: true, ex: CLAIM_TTL_SEGUNDOS });
    if (reivindicado) return { tipo: "claimed" };
  } catch (err) {
    // O SET NX pode ou não ter sido aplicado no servidor Redis mesmo tendo
    // lançado (timeout na resposta, por exemplo) — não há como saber a
    // partir daqui. Nunca prossegue como se tivéssemos reivindicado.
    logSurvivalErro("idempotencia_pedido", "claim", "set_nx_falhou", err);
    return { tipo: "incerto" };
  }

  // SET NX não aplicou (a chave já existia) — inspeciona quem é o dono atual.
  let claimAtual: unknown;
  try {
    claimAtual = await redis.get(claimKey);
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "leitura_claim", "get_claim_falhou", err);
    return { tipo: "incerto" };
  }
  const fingerprintAtual = extrairFingerprintDoClaim(claimAtual);
  if (fingerprintAtual === null) {
    // A chave expirou entre o SET NX falhar e este GET (janela mínima), ou o
    // valor veio corrompido/inesperado — não há base segura para decidir se
    // é a mesma tentativa ou uma nova. Nunca supõe.
    return { tipo: "incerto" };
  }
  return { tipo: fingerprintAtual === requestFingerprint ? "processando_mesmo_fingerprint" : "conflito_fingerprint" };
}

// Espera limitada (~1.8s no pior caso) por uma requisição concorrente com o
// MESMO clientRequestId (e mesmo fingerprint) terminar de criar o pedido.
// Nunca cria nada aqui — só observa o registro de RESULTADO (não o claim)
// até ele aparecer ou esgotar as tentativas. Bem dentro do maxDuration=20s.
async function aguardarResultadoPedido(clientRequestId: string): Promise<ResultadoIdempotenciaPedido | null> {
  const chave = chaveResultadoPedido(clientRequestId);
  for (let tentativa = 0; tentativa < POLL_TENTATIVAS; tentativa++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVALO_MS));
    const atual = await redis.get(chave).catch(() => null);
    if (ehResultadoIdempotenciaValido(atual)) return atual;
  }
  return null;
}

type ResultadoAttempt =
  | { tipo: "obtido"; pedidoId: string; txid: string; pricing: SnapshotFinanceiroAttempt }
  | { tipo: "conflito_fingerprint" }
  | { tipo: "incerto" };

type ResultadoConsultaAttempt =
  | { tipo: "encontrado"; registro: RegistroAttemptPedido }
  | { tipo: "nao_encontrado" }
  | { tipo: "conflito_fingerprint" }
  | { tipo: "incerto" };

// 7ª revisão de segurança, ponto 1: consulta SOMENTE LEITURA do :attempt —
// roda na FASE 2, ANTES das validações mutáveis (FASE 3), para nunca deixar
// um attempt corrompido ou de outra tentativa passar silenciosamente. Nunca
// cria/reivindica nada (isso continua sendo feito só pela FASE 4, via
// `obterOuCriarAttempt`) — só protege contra colisão de identidade e
// corrupção antes de rodar validações que dependem de estado mutável.
async function consultarAttemptSomenteLeitura(clientRequestId: string, requestFingerprint: string): Promise<ResultadoConsultaAttempt> {
  let atual: unknown;
  try {
    atual = await redis.get(chaveAttemptPedido(clientRequestId));
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "attempt_consulta_antecipada", "get_falhou", err);
    return { tipo: "incerto" };
  }
  if (atual === null || atual === undefined) return { tipo: "nao_encontrado" };
  if (!ehAttemptValido(atual)) {
    logSurvivalErro("idempotencia_pedido", "attempt_consulta_antecipada", "formato_invalido");
    return { tipo: "incerto" };
  }
  if (atual.requestFingerprint !== requestFingerprint) return { tipo: "conflito_fingerprint" };
  return { tipo: "encontrado", registro: atual };
}

// Cria (SET NX) ou recupera atomicamente a identidade ESTÁVEL da tentativa
// — pedidoId + txid (txid é uma função pura e determinística de pedidoId,
// ver gerarTxidPixInterno; a X-Idempotency-Key do Mercado Pago é por sua vez
// derivada do txid) + o SNAPSHOT FINANCEIRO (5ª rodada, ponto 4: total,
// subtotal, taxa, desconto, valorPixEsperado) — ANTES de qualquer efeito
// externo (vínculo da Jornada do Chef, cobrança Pix). Revisão de segurança,
// 4ª rodada, ponto 3: sem a identidade estável, cada retry gerava um
// pedidoId novo (Date.now()), e portanto um txid novo, arriscando uma
// SEGUNDA cobrança real no Mercado Pago. Sem o snapshot financeiro (5ª
// rodada), um retry que reutilizasse a identidade mas recalculasse o preço
// na hora (cardápio/promoção/taxa podem ter mudado) poderia cobrar/persistir
// um valor DIFERENTE do que a cobrança original já usou. Nunca contém
// PII/QR/copia-e-cola/credencial.
async function obterOuCriarAttempt(
  clientRequestId: string,
  requestFingerprint: string,
  pedidoIdCandidato: string,
  pricingCandidato: SnapshotFinanceiroAttempt
): Promise<ResultadoAttempt> {
  const chave = chaveAttemptPedido(clientRequestId);
  const txidCandidato = gerarTxidPixInterno(pedidoIdCandidato);
  const registroCandidato: RegistroAttemptPedido = {
    state: "in_progress",
    requestFingerprint,
    pedidoId: pedidoIdCandidato,
    txid: txidCandidato,
    pricing: pricingCandidato,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    const criado = await redis.set(chave, registroCandidato, { nx: true, ex: ATTEMPT_TTL_SEGUNDOS });
    if (criado) return { tipo: "obtido", pedidoId: pedidoIdCandidato, txid: txidCandidato, pricing: pricingCandidato };
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "attempt", "set_nx_falhou", err);
    return { tipo: "incerto" };
  }

  // Chave já existia — recupera a identidade E O PREÇO já reivindicados
  // (retry de uma tentativa anterior, incluindo uma que nunca chegou a
  // persistir o pedido) em vez de gerar/recalcular do zero.
  let atual: unknown;
  try {
    atual = await redis.get(chave);
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "attempt", "get_falhou", err);
    return { tipo: "incerto" };
  }
  if (!ehAttemptValido(atual)) {
    logSurvivalErro("idempotencia_pedido", "attempt", "formato_invalido");
    return { tipo: "incerto" };
  }
  if (atual.requestFingerprint !== requestFingerprint) return { tipo: "conflito_fingerprint" };
  return { tipo: "obtido", pedidoId: atual.pedidoId, txid: atual.txid, pricing: atual.pricing };
}

// Best-effort: marca o attempt como "completed" quando o pedido conclui de
// verdade (revisão de segurança, 5ª rodada, ponto 6) — só informativo, nada
// no fluxo depende deste campo mudar (a fonte de verdade de "já concluído" é
// sempre survivalState no próprio pedido + :result). Nunca sobrescreve um
// attempt de outra tentativa (confere o fingerprint antes de gravar).
async function marcarAttemptComoCompleted(clientRequestId: string, requestFingerprint: string): Promise<void> {
  try {
    const chave = chaveAttemptPedido(clientRequestId);
    const atual = await redis.get(chave);
    if (!ehAttemptValido(atual) || atual.requestFingerprint !== requestFingerprint) return;
    await redis.set(chave, { ...atual, state: "completed", updatedAt: Date.now() }, { ex: ATTEMPT_TTL_SEGUNDOS });
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "attempt", "marcar_completed_falhou", err);
  }
}

// Libera o claim (compare-and-delete atômico via Lua, só se ownerToken +
// fingerprint ainda baterem) — usado nos caminhos em que NENHUM pedido
// chegou a ser criado depois de reivindicar (validação/efeito colateral
// falhou), permitindo um retry legítimo com o mesmo clientRequestId. Nunca
// chamado depois que o pedido já existe de verdade.
async function liberarClaimSeAdquirido(
  clientRequestId: string | null,
  ownerToken: string | null,
  requestFingerprint: string | null,
  claimAdquirido: boolean
): Promise<void> {
  if (!claimAdquirido || !clientRequestId || !ownerToken || !requestFingerprint) return;
  await redis
    .eval(LIBERAR_CLAIM_SE_DONO_SCRIPT, [chaveClaimPedido(clientRequestId)], [montarValorClaim(ownerToken, requestFingerprint)])
    .catch((err) => logSurvivalErro("idempotencia_pedido", "liberacao", "eval_falhou", err));
}

export async function POST(req: NextRequest) {
  let clientRequestId: string | null = null;
  let requestFingerprint: string | null = null;
  let ownerToken: string | null = null;
  let claimAdquirido = false;

  // Marcado assim que a persistência do pedido tiver sucesso (ou for
  // reconciliada como já persistida — ver FASE 5) — usado só pelo catch
  // externo para decidir 503 recuperável vs. 500 comum.
  let pedidoIdCriado: string | null = null;

  try {
    const body = (await req.json()) as PedidoApp;

    // =================================================================
    // FASE 1 — validações ESTRUTURAIS puras (revisão de segurança, 5ª
    // rodada, ponto 1): dependem só da FORMA do próprio payload, nunca de
    // estado que muda com o tempo (cardápio, promoções, esgotados, status
    // de recompensa/resgate). Seguro rodar sempre, incondicionalmente,
    // antes de qualquer consulta de idempotência ou validação de negócio —
    // um payload malformado é sempre malformado, não importa quanto tempo
    // tenha passado desde a tentativa original.
    // =================================================================

    if (!body.cliente || !body.itens || body.itens.length === 0) {
      return NextResponse.json({ ok: false, error: "Pedido inválido" }, { status: 400 });
    }
    // 7ª revisão de segurança, ponto 2: a RESOLUÇÃO do vínculo com o
    // WhatsApp (`validarTokenCardapio`, uma chamada ao Redis com token de
    // 24h) NUNCA pode rodar antes da recuperação de idempotência (FASE 2) —
    // um retry legítimo de uma tentativa já concluída não pode receber
    // "Telefone obrigatório"/500 só porque o token temporário expirou ou o
    // Redis falhou nessa checagem específica. Aqui extraímos só a
    // IDENTIDADE BRUTA E ESTÁVEL enviada (o próprio token opaco, quando
    // presente, ou o telefone digitado) — sem nenhuma chamada ao Redis —
    // para alimentar o fingerprint. A resolução de verdade (token → telefone
    // canônico) é adiada para logo após a FASE 2, e só é EXIGIDA quando esta
    // se revela uma criação genuinamente nova.
    const telefoneDigitado = (body.telefone || "").trim();
    const usarOutroWhatsapp = !!body.usarOutroWhatsapp;
    const identidadeBrutaTelefone =
      !usarOutroWhatsapp && body.whatsappToken?.trim() ? body.whatsappToken.trim() : telefoneDigitado;
    if (!body.pagamento || !body.pagamento.trim()) {
      return NextResponse.json({ ok: false, error: "Forma de pagamento obrigatória" }, { status: 400 });
    }
    if (temDinheiroNoPagamento(body.pagamento) && !body.troco?.trim()) {
      return NextResponse.json({ ok: false, error: "Troco obrigatorio para dinheiro" }, { status: 400 });
    }
    if (body.tipoEntrega === "delivery" && (!body.bairro?.trim() || !body.rua?.trim() || !body.numero?.trim())) {
      return NextResponse.json({ ok: false, error: "Endereco obrigatorio para entrega" }, { status: 400 });
    }
    // O frontend NUNCA decide o que é gratuito (bloqueio econômico crítico):
    // `recompensaJornadaId` num item do carrinho não é mais um campo aceito
    // do cliente — só o servidor marca um item como presente da Jornada,
    // sempre a partir do snapshot da recompensa (ver FASE 3). Qualquer item
    // que chegue com este campo é rejeitado de imediato.
    if (body.itens.some((item) => Boolean((item as ItemApp & { recompensaJornadaId?: unknown }).recompensaJornadaId))) {
      return NextResponse.json({ ok: false, error: "Item inválido" }, { status: 400 });
    }

    // Presente da Jornada do Chef: só a FORMA do campo (qual recompensa,
    // qual sabor) é extraída aqui — puro parse, sem tocar Redis além do já
    // feito acima. A validação de NEGÓCIO (sessão pertence ao telefone,
    // recompensa realmente disponível — `prepararResgateParaPedido`) é
    // adiada para a FASE 3, porque o status da recompensa é mutável.
    let recompensaJornadaId: string | undefined;
    let recompensaEscolha: EscolhaRecompensaJornada | undefined;
    if (body.recompensaJornada && typeof body.recompensaJornada === "object") {
      recompensaJornadaId = String(body.recompensaJornada.recompensaId ?? "").trim();
      if (!recompensaJornadaId) {
        return NextResponse.json({ ok: false, error: "Presente da Jornada do Chef inválido ou já utilizado" }, { status: 400 });
      }
      const escolhaBruta = body.recompensaJornada.escolha;
      recompensaEscolha = escolhaBruta && typeof escolhaBruta === "object"
        ? { sabor: typeof escolhaBruta.sabor === "string" ? escolhaBruta.sabor : undefined }
        : undefined;
    }

    // =================================================================
    // FASE 2 — clientRequestId + fingerprint (só campos BRUTOS do payload,
    // nunca preço calculado) e RECUPERAÇÃO ANTECIPADA de idempotência
    // (revisão de segurança, 5ª rodada, ponto 1): se esta tentativa já foi
    // concluída (ou está em andamento por outra execução concorrente),
    // devolve o resultado real AGORA — antes de rodar qualquer validação
    // de negócio que possa ter mudado com o tempo (promoção expirada,
    // produto esgotado, resgate já debitado por ESTA MESMA tentativa já
    // confirmada, recompensa da Jornada já usada). Sem isto, um retry
    // legítimo de uma tentativa JÁ CONCLUÍDA podia receber 400/409 antes de
    // a rota sequer olhar para o pedido/resultado já existente. Só quando
    // NENHUM resultado/pedido concluído é encontrado é que seguimos para
    // as validações mutáveis (FASE 3) e, só então, para o claim de uma
    // criação genuinamente NOVA (FASE 4) — o claim continua depois das
    // validações de negócio, como antes; só a RECUPERAÇÃO foi antecipada.
    // =================================================================

    const survivalAtivo = survivalModeEnabled();
    clientRequestId = survivalAtivo ? sanitizeClientRequestId(body.clientRequestId) : null;

    // Revisão de segurança, 4ª rodada, ponto 5: um clientRequestId PRESENTE
    // porém em formato inválido nunca pode ser silenciosamente ignorado sem
    // visibilidade. Enquanto a flag de enforcement (separada, padrão
    // desligada) não estiver ativa, o pedido continua sendo criado sem
    // proteção de idempotência (compatibilidade com clientes antigos que
    // ainda não geram/enviam o campo) — mas o caso fica logado. Com a
    // enforcement ligada, um valor presente e malformado é rejeitado (400);
    // a AUSÊNCIA do campo nunca é rejeitada por esta checagem.
    if (survivalAtivo && body.clientRequestId && !clientRequestId) {
      if (survivalClientRequestIdEnforcementEnabled()) {
        return NextResponse.json(
          { ok: false, error: "Identificador de tentativa (clientRequestId) inválido." },
          { status: 400 }
        );
      }
      logSurvivalErro("idempotencia_pedido", "sanitizacao_client_request_id", "formato_invalido_ignorado");
    }

    if (clientRequestId) {
      requestFingerprint = calcularRequestFingerprint({
        cliente: body.cliente,
        telefonePedido: identidadeBrutaTelefone,
        itens: body.itens,
        tipoEntrega: body.tipoEntrega,
        bairro: body.bairro,
        rua: body.rua,
        numero: body.numero,
        referencia: body.referencia,
        observacao: body.observacao,
        email: body.email,
        pagamento: body.pagamento,
        troco: body.troco,
        resgateId: body.resgateId,
        recompensaJornadaId,
        recompensaEscolhaSabor: recompensaEscolha?.sabor,
      });

      const resolucaoRapida = await resolverViaResultadoExistente(clientRequestId, requestFingerprint);
      if (resolucaoRapida.tipo === "resposta") return resolucaoRapida.resposta;
      // "prosseguir" (:result nunca existiu, ou stale já invalidado
      // atomicamente e comprovado) — antes de reivindicar um novo claim,
      // verifica se o PEDIDO REAL já existe (caso em que o :result nunca
      // chegou a ser gravado ou já expirou). Nunca cria um segundo pedido
      // quando o hash bate.
      const clientRequestIdHash = hashClientRequestId(clientRequestId);
      const buscaPorHash = await buscarPedidoPorClientRequestIdHash(clientRequestIdHash, requestFingerprint);
      if (buscaPorHash.tipo === "incerto") return respostaClaimIncerto();
      if (buscaPorHash.tipo === "conflito_fingerprint") return respostaConflitoFingerprint();
      if (buscaPorHash.tipo === "pendente_critico") return respostaClaimIncerto();
      if (buscaPorHash.tipo === "encontrado") {
        const pedidoExistente = buscaPorHash.pedido;
        const pedidoIdExistente = String(pedidoExistente.id ?? "");
        const numeroExistente = typeof pedidoExistente.numero === "number" ? pedidoExistente.numero : 0;
        const statusTokenExistente = typeof pedidoExistente.statusToken === "string" ? pedidoExistente.statusToken : "";
        const respostaRecuperada = await montarRespostaAPartirDoPedido(
          pedidoExistente,
          pedidoIdExistente,
          numeroExistente,
          statusTokenExistente
        );
        // Recria o registro :result best-effort — acelera retries futuros,
        // mas não é crítico se falhar (a busca por hash cobre esse caso).
        const registroRecriado: ResultadoIdempotenciaPedido = {
          state: "completed",
          requestFingerprint,
          pedidoId: pedidoIdExistente,
          numero: numeroExistente,
          statusToken: statusTokenExistente,
          createdAt: Date.now(),
          resultToken: randomUUID().replace(/-/g, ""),
        };
        await persistirRegistroResultado(clientRequestId, registroRecriado).catch((err) =>
          logSurvivalErro("idempotencia_pedido", "recriacao_resultado", "set_falhou", err)
        );
        return NextResponse.json(respostaRecuperada);
      }
      // "nao_encontrado" em ambos — ainda pode ser uma RECUPERAÇÃO de uma
      // tentativa cujo attempt já existe (Pix cobrado, pedido nunca
      // persistido) — 7ª revisão de segurança, ponto 1: consulta
      // SOMENTE LEITURA do :attempt aqui, antes das validações mutáveis da
      // FASE 3, para nunca criar uma segunda identidade nem deixar um
      // attempt corrompido passar silenciosamente. A reconstrução completa
      // do snapshot de checkout (para pular a FASE 3 inteira numa
      // recuperação) permanece um limite conhecido desta rodada — ver
      // docs/architecture/MODO_SOBREVIVENCIA_1_0.md, seção 2.5-I (item 2),
      // para o registro explícito do que ainda não está coberto.
      const attemptAntecipado = await consultarAttemptSomenteLeitura(clientRequestId, requestFingerprint);
      if (attemptAntecipado.tipo === "incerto") return respostaClaimIncerto();
      if (attemptAntecipado.tipo === "conflito_fingerprint") return respostaConflitoFingerprint();
      // "encontrado" (attempt em andamento, mesmo fingerprint) ou
      // "nao_encontrado": ambos seguem para a resolução de identidade e
      // FASE 3 abaixo — quando "encontrado", a FASE 4 reaproveita a MESMA
      // identidade/preço já reivindicados (já implementado desde a 4ª/5ª
      // rodada).
    }

    // 7ª revisão de segurança, ponto 2: a resolução de verdade do vínculo
    // com o WhatsApp (chamada ao Redis) só acontece agora — depois que
    // nenhuma recuperação de idempotência (:result, pedido por hash,
    // :attempt) encontrou uma tentativa já em andamento/concluída. Só uma
    // criação genuinamente nova (ou uma recuperação de attempt, que ainda
    // assim precisa de um telefone para persistir o pedido) exige um
    // token/telefone válido agora.
    let vinculoWhatsapp: { phone: string } | null = null;
    if (body.whatsappToken) {
      try {
        vinculoWhatsapp = await validarTokenCardapio(body.whatsappToken);
      } catch (err) {
        logSurvivalErro("idempotencia_pedido", "resolucao_whatsapp_token", "redis_falhou", err);
        return respostaClaimIncerto();
      }
    }
    const telefonePedido = vinculoWhatsapp && !usarOutroWhatsapp ? vinculoWhatsapp.phone : telefoneDigitado;
    const whatsappVinculado = !!vinculoWhatsapp && !usarOutroWhatsapp;
    if (!telefonePedido) {
      return NextResponse.json({ ok: false, error: "Telefone obrigatório" }, { status: 400 });
    }

    // =================================================================
    // FASE 3 — validações de NEGÓCIO, que dependem de estado MUTÁVEL
    // (cardápio, promoções, produtos esgotados, disponibilidade da
    // recompensa da Jornada, validade do resgate de pontos, cálculo de
    // preço). Só chega aqui quando a FASE 2 não encontrou nenhuma
    // tentativa já concluída/em andamento — sempre uma avaliação FRESCA.
    // =================================================================

    const menu = await getMENUDinamico();
    const pedidos = (await redis.get<unknown[]>("pedidos")) || [];

    // Itens promocionais: o preço NUNCA vem do cliente — é recalculado a
    // partir da promoção ativa salva no Redis. Promoção inexistente,
    // inativa, fora da janela ou com produto esgotado invalida o pedido.
    const temPromo = body.itens.some((item) => item.kind === "promo");
    const promos = temPromo ? ((await redis.get<Promocao[]>(PROMOS_KEY)) || []) : [];
    const esgotadosPromo = temPromo ? ((await redis.get<string[]>("esgotados")) || []) : [];
    const catalogoPromo = temPromo ? catalogoDoMenu(menu as never) : [];

    const promoUnitPrice = makePromoUnitPrice({
      promos,
      esgotadosPromo,
      dentroDaJanela,
      promocaoIndisponivel,
      precoFinalPromocao: (promo) => precoFinalPromocao(promo, catalogoPromo),
    });

    const itensValidados = body.itens.map((item) => ({
      linha: formatItem(item),
      unitPrice: item.kind === "promo" ? promoUnitPrice(item) : officialUnitPrice(item, menu as MenuPedidoApp),
      qty: item.qty,
    }));

    if (itensValidados.some((item) => item.unitPrice === null)) {
      return NextResponse.json({ ok: false, error: "Item inválido" }, { status: 400 });
    }

    // Presente da Jornada do Chef (rule 1/2/3): produto, preço, quantidade,
    // tamanho e composição são SEMPRE reconstruídos no servidor a partir do
    // snapshot da própria recompensa (nunca do carrinho) — ver
    // `materializarItensRecompensa`. Autorização é SEMPRE pela sessão da
    // Área do Cliente, nunca pelo telefone digitado no checkout.
    //
    // `prepararResgateParaPedido` é só leitura/validação — a vinculação real
    // (`confirmarReservaNoPedido`, primeiro efeito irreversível deste
    // fluxo) acontece na FASE 5, depois do claim de idempotência.
    let clienteIdJornada: string | undefined;
    let itensRecompensaMaterializados: ItemApp[] = [];
    if (recompensaJornadaId) {
      const tokenSessaoJornada = req.cookies.get(CLIENTE_COOKIE)?.value;
      const payloadSessaoJornada = tokenSessaoJornada ? await verificarTokenCliente(tokenSessaoJornada) : null;
      if (!payloadSessaoJornada) {
        return NextResponse.json({ ok: false, error: "Faça login na área do cliente para usar o presente da Jornada do Chef" }, { status: 401 });
      }
      const clienteSessaoJornada = await buscarClientePorId(payloadSessaoJornada.clienteId);
      if (!clienteSessaoJornada) {
        return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401 });
      }
      // O telefone do pedido precisa corresponder ao telefone canônico da
      // sessão autenticada (após normalização) — nunca transfere
      // silenciosamente uma recompensa para outro número.
      if (sanitizeTelefoneCliente(telefonePedido) !== sanitizeTelefoneCliente(clienteSessaoJornada.telefone)) {
        return NextResponse.json({ ok: false, error: "O telefone do pedido não corresponde ao seu perfil. Presente da Jornada do Chef não aplicado." }, { status: 403 });
      }
      clienteIdJornada = derivarClienteIdPorTelefone(clienteSessaoJornada.telefone) ?? clienteSessaoJornada.clienteId;

      const materializado = await prepararResgateParaPedido(clienteIdJornada, recompensaJornadaId, recompensaEscolha);
      if (!materializado.ok) {
        return NextResponse.json({ ok: false, error: materializado.erro }, { status: 400 });
      }
      itensRecompensaMaterializados = materializado.itens.map((item) => ({
        kind: item.kind,
        name: item.name,
        ...(item.detail ? { detail: item.detail } : {}),
        price: 0,
        qty: item.qty,
        recompensaJornadaId,
      }));
    }

    // Itens finais = itens normais do carrinho (preço sempre recalculado no
    // servidor acima) + itens do presente da Jornada, se houver (sempre
    // materializados no servidor, preço sempre 0). Formata como strings, no
    // MESMO padrão do fluxo do WhatsApp.
    const itensRecompensaValidados = itensRecompensaMaterializados.map((item) => ({
      linha: formatItem(item),
      unitPrice: 0,
      qty: item.qty,
    }));
    const itensDetalhadosFinais: ItemApp[] = [...body.itens, ...itensRecompensaMaterializados];
    const itensValidadosFinais = [...itensValidados, ...itensRecompensaValidados];
    const itens = itensValidadosFinais.map((item) => item.linha);
    // `let`: reatribuído na FASE 4 para o valor ESTÁVEL do snapshot financeiro
    // do attempt quando clientRequestId está presente (7ª revisão de
    // segurança, ponto 4) — nunca o subtotal recém-calculado, que poderia
    // divergir do já usado numa cobrança Pix anterior.
    let subtotal = itensValidadosFinais.reduce((s, item) => s + item.unitPrice! * item.qty, 0);

    // Resgate de fidelidade (Etapa 5): desconto calculado EXCLUSIVAMENTE no
    // servidor, a partir de uma reserva já validada (nunca um valor vindo do
    // cliente). `obterReservasResgatePontos` é só leitura — a confirmação
    // real (`confirmarResgatePontos`) acontece na FASE 5, depois da
    // persistência do pedido.
    let descontoFidelidade = 0;
    let resgateAplicado: { clienteId: string; resgateId: string } | null = null;
    if (body.resgateId) {
      const clienteIdResgate = derivarClienteIdPorTelefone(telefonePedido);
      if (!clienteIdResgate) {
        return NextResponse.json({ ok: false, error: "Telefone inválido para aplicar o resgate" }, { status: 400 });
      }
      const reservas = await obterReservasResgatePontos(clienteIdResgate);
      const reserva = reservas.find((r) => r.resgateId === body.resgateId);
      if (!reserva || reserva.status !== "reservado") {
        return NextResponse.json({ ok: false, error: "Resgate inválido ou já utilizado" }, { status: 400 });
      }
      if (new Date(reserva.expiraEm).getTime() < Date.now()) {
        return NextResponse.json({ ok: false, error: "Resgate expirado — gere um novo resgate no app" }, { status: 400 });
      }
      // Desconto nunca ultrapassa o valor-base configurado nem o próprio
      // subtotal (nunca deixa o pedido negativo); adicionais/borda/entrega já
      // ficam de fora por construção (o desconto incide só sobre o subtotal
      // dos produtos, antes da taxa de entrega).
      descontoFidelidade = Math.max(0, Math.min(reserva.valorDescontoMaximo, subtotal));
      if (descontoFidelidade <= 0) {
        return NextResponse.json({ ok: false, error: "Pedido não atinge o valor mínimo para usar o resgate" }, { status: 400 });
      }
      resgateAplicado = { clienteId: clienteIdResgate, resgateId: reserva.resgateId };
    }

    // `let`: os três podem ser SUBSTITUÍDOS na FASE 4 pelo snapshot
    // financeiro ESTÁVEL do attempt (revisão de segurança, 5ª rodada, ponto
    // 4), quando esta for a recuperação de uma tentativa anterior cujo
    // preço já foi cobrado/persistido — nunca cobra/persiste um valor
    // diferente do que uma cobrança Pix anterior já usou, mesmo que
    // cardápio/promoção/taxa tenham mudado nesse meio-tempo.
    let taxa = computeTaxaApp(body.tipoEntrega, body.bairro, menu.neighborhoods as Array<{ name: string; fee: number }>);
    let total = subtotal - descontoFidelidade + taxa;

    const endereco = buildEnderecoApp({ tipoEntrega: body.tipoEntrega, rua: body.rua, numero: body.numero, bairro: body.bairro });

    // Vinculo com area do cliente (opcional): se o cliente estiver logado
    // (cookie cliente-token valido), o pedido recebe clienteId + contagem de
    // pizzas para credito de fidelidade futuro. Pedido anonimo/convidado
    // segue funcionando normalmente — qualquer falha aqui e ignorada e o
    // pedido NUNCA deixa de ser criado por causa da fidelidade/login.
    let clienteId: string | undefined;
    try {
      const clienteToken = req.cookies.get(CLIENTE_COOKIE)?.value;
      if (clienteToken) {
        const payloadCliente = await verificarTokenCliente(clienteToken);
        if (payloadCliente) clienteId = payloadCliente.clienteId;
      }
    } catch (err) {
      console.error("[ChefeBot] Erro ao resolver cliente do pedido (ignorado):", err);
    }

    // pizzasCount alimenta a fidelidade antiga (compra N pizzas, ganha 1
    // grátis) quando o pedido é marcado como entregue — nunca pode incluir a
    // pizza-presente da Jornada do Chef, que o cliente não pagou.
    let pizzasCount = 0;
    try {
      pizzasCount = contarPizzasPagasParaFidelidade(itensDetalhadosFinais);
    } catch (err) {
      console.error("[ChefeBot] Erro ao contar pizzas para fidelidade (ignorado):", err);
    }

    // `let`: reatribuído na FASE 4 para o valor ESTÁVEL do "attempt" quando
    // clientRequestId está presente — todo o resto do fluxo (Jornada, Pix,
    // persistência) usa só esta variável, nunca um valor recalculado.
    let pedidoId = Date.now().toString();

    // Snapshot do valor Pix ESPERADO gravado no attempt (7ª revisão de
    // segurança, ponto 4) — usado só como referência de comparação em
    // centavos antes de qualquer chamada ao provider: nunca aceita um valor
    // recalculado que divirja do valor já potencialmente cobrado numa
    // tentativa anterior.
    let valorPixEsperadoSnapshot: number | undefined;

    // =================================================================
    // FASE 4 — claim (só para uma criação NOVA) + identidade/preço
    // estáveis da tentativa (attempt). O claim continua depois das
    // validações de negócio (nunca antes) — só a RECUPERAÇÃO de uma
    // tentativa já concluída foi antecipada para a FASE 2.
    // =================================================================

    if (clientRequestId && requestFingerprint) {
      ownerToken = randomUUID();
      const claimKey = chaveClaimPedido(clientRequestId);
      const valorClaim = montarValorClaim(ownerToken, requestFingerprint);
      const resultadoClaim = await tentarReivindicarClaim(claimKey, valorClaim, requestFingerprint);

      if (resultadoClaim.tipo === "conflito_fingerprint") {
        return respostaConflitoFingerprint();
      }
      if (resultadoClaim.tipo === "incerto") {
        return respostaClaimIncerto();
      }
      if (resultadoClaim.tipo === "processando_mesmo_fingerprint") {
        const resolvido = await aguardarResultadoPedido(clientRequestId);
        if (resolvido) {
          const reconstrucao = await reconstruirRespostaPedido(resolvido);
          if (reconstrucao.tipo === "sucesso") return NextResponse.json(reconstrucao.resposta);
          // "pendente_critico"/"incerto"/"stale": nunca inventa sucesso aqui
          // — cai no mesmo "ainda processando" de baixo, seguro em todos os
          // casos (o pior efeito é pedir para o cliente aguardar mais).
        }
        return respostaAindaProcessando();
      }
      claimAdquirido = true;

      // Identidade estável da tentativa (revisão de segurança, 4ª rodada,
      // ponto 3) + snapshot financeiro estável (5ª rodada, ponto 4) —
      // resolvidos ANTES de qualquer efeito externo. O candidato é
      // construído a partir do preço FRESCO calculado acima (FASE 3); se
      // esta chave já existir (retry), o valor ARMAZENADO é o que vale.
      const pricingCandidato: SnapshotFinanceiroAttempt = {
        total,
        subtotal,
        taxaEntrega: taxa,
        descontoFidelidade,
        ...(temPixNoPagamento(body.pagamento) ? { valorPixEsperado: valorPixEsperado(body.pagamento, total) } : {}),
        pricingFingerprint: "",
      };
      pricingCandidato.pricingFingerprint = calcularPricingFingerprint(pricingCandidato);

      const attempt = await obterOuCriarAttempt(clientRequestId, requestFingerprint, pedidoId, pricingCandidato);
      if (attempt.tipo === "conflito_fingerprint") {
        await liberarClaimSeAdquirido(clientRequestId, ownerToken, requestFingerprint, claimAdquirido);
        return respostaConflitoFingerprint();
      }
      if (attempt.tipo === "incerto") {
        // Não há como saber se o attempt foi criado/recuperado — nunca
        // prossegue às cegas (poderia gerar um pedidoId/preço divergente do
        // já eventualmente usado numa cobrança Pix anterior). Mantém o
        // claim: só liberar quando soubermos com certeza que nada foi criado.
        return respostaClaimIncerto();
      }
      pedidoId = attempt.pedidoId;
      // Reaproveita o valor financeiro ESTÁVEL do attempt — numa criação
      // nova, isto é um no-op (o candidato acabou de ser gravado com este
      // mesmo valor); numa recuperação, GARANTE que o valor cobrado/
      // persistido seja EXATAMENTE o mesmo da tentativa original, mesmo que
      // cardápio/promoção/taxa tenham mudado desde então.
      total = attempt.pricing.total;
      subtotal = attempt.pricing.subtotal;
      taxa = attempt.pricing.taxaEntrega;
      descontoFidelidade = attempt.pricing.descontoFidelidade;
      valorPixEsperadoSnapshot = attempt.pricing.valorPixEsperado;
    }

    // Troco (quando há dinheiro no pagamento, puro ou híbrido) é validado só
    // contra a parte em dinheiro — mesma regra do fluxo do WhatsApp
    // (bot.ts). Roda DEPOIS da FASE 4 de propósito: usa o `total` FINAL
    // (já possivelmente substituído pelo snapshot estável do attempt), nunca
    // um total recém-calculado que poderia divergir do valor já cobrado.
    if (temDinheiroNoPagamento(body.pagamento) && body.troco?.trim() && !/sem\s*troco/i.test(body.troco)) {
      const valorTroco = parseFloat(body.troco.replace(",", ".").replace(/[^0-9.]/g, ""));
      const baseTroco = valorDinheiroEsperado(body.pagamento, total);
      if (isNaN(valorTroco) || valorTroco < baseTroco) {
        await liberarClaimSeAdquirido(clientRequestId, ownerToken, requestFingerprint, claimAdquirido);
        return NextResponse.json({ ok: false, error: "Valor de troco insuficiente para a parte em dinheiro" }, { status: 400 });
      }
    }

    // =================================================================
    // FASE 5 — efeitos irreversíveis: vínculo da Jornada, preparação do
    // Pix e persistência do pedido; confirmação do resgate; idempotência
    // durável.
    // =================================================================

    // Vincula a recompensa da Jornada do Chef a ESTE pedidoId ANTES de
    // persistir o pedido (rule 6): se a vinculação falhar (recompensa
    // consumida por outra requisição concorrente, expirada nesse meio-tempo,
    // etc.), nenhum pedido chega a ser criado — nunca é preciso compensar
    // reescrevendo a lista inteira de "pedidos". `confirmarReservaNoPedido`
    // já é idempotente e protegida por lock por cliente.
    if (recompensaJornadaId && clienteIdJornada) {
      try {
        await confirmarReservaNoPedido(clienteIdJornada, recompensaJornadaId, pedidoId);
      } catch (err) {
        console.error("[ChefeBot] Erro ao vincular presente da Jornada do Chef ao pedido:", err);
        await liberarClaimSeAdquirido(clientRequestId, ownerToken, requestFingerprint, claimAdquirido);
        return NextResponse.json({ ok: false, error: "Nao foi possivel confirmar o presente. Tente novamente." }, { status: 409 });
      }
    }

    // Declaradas fora do try: atribuídas uma única vez, DENTRO do try
    // abaixo, que cobre todo o espaço entre o vínculo da Jornada e a
    // persistência — nunca só o redis.set. `pedidoId` já é estável (ver
    // FASE 4) — um retry que refizer esta preparação (inclusive recriando
    // a cobrança Pix) reutiliza a MESMA X-Idempotency-Key e o MESMO valor
    // financeiro, então o Mercado Pago nunca gera uma segunda cobrança real
    // mesmo que o provider já tenha sido chamado antes de uma exceção.
    let numeroPedido: number;
    let statusToken: string;
    let pix: PixMetadata | undefined;

    // 7ª revisão de segurança, ponto 4: o valor Pix efetivamente cobrado
    // nunca pode divergir do valor gravado no snapshot financeiro do attempt
    // — comparação em CENTAVOS (nunca uma tolerância aproximada), feita
    // ANTES de qualquer chamada ao provider. Uma divergência aqui só seria
    // possível por um bug de cálculo (ambos derivam da MESMA função pura a
    // partir do MESMO `total` estável) — nunca prossegue silenciosamente
    // nesse caso, nunca chama o provider com um valor diferente do já
    // potencialmente cobrado.
    if (valorPixEsperadoSnapshot !== undefined) {
      const valorPixRecalculado = temPixNoPagamento(body.pagamento) ? valorPixEsperado(body.pagamento, total) : undefined;
      const divergiu =
        valorPixRecalculado === undefined || Math.round(valorPixRecalculado * 100) !== Math.round(valorPixEsperadoSnapshot * 100);
      if (divergiu) {
        logSurvivalErro("pedido_app", "snapshot_financeiro", "valor_pix_divergente");
        return respostaClaimIncerto();
      }
    }

    try {
      numeroPedido = await proximoNumeroPedido();
      statusToken = criarTokenPublicoAcompanhamento();
      const pixBase = criarPixMetadata(pedidoId, body.pagamento, total);
      pix = await prepararPixProviderMercadoPago({
        pedidoId,
        pix: pixBase,
        clienteNome: body.cliente,
        payerEmail: body.email,
      });
      const novoPedido = {
        id: pedidoId,
        numero: numeroPedido,
        cliente: body.cliente,
        telefone: telefonePedido,
        ...(whatsappVinculado ? { whatsappVinculado: true } : {}),
        ...(clienteId ? { clienteId } : {}),
        ...(pizzasCount > 0 ? { pizzasCount } : {}),
        ...(resgateAplicado ? { resgateId: resgateAplicado.resgateId, descontoFidelidade } : {}),
        ...(recompensaJornadaId ? { recompensaJornadaId } : {}),
        // Modo Sobrevivência: hash (nunca o valor bruto) do clientRequestId +
        // fingerprint da tentativa — única prova durável de idempotência
        // dentro do próprio pedido, usada quando :claim/:result expiram ou
        // nunca chegam a ser gravados (ver buscarPedidoPorClientRequestIdHash).
        // Nunca enviado em recibos/mensagens/APIs públicas: todos os pontos de
        // leitura voltados ao cliente (montarStatusPublicoPedido, etc.)
        // projetam campos explícitos, nunca espalham o pedido inteiro.
        ...(clientRequestId && requestFingerprint
          ? {
              survivalClientRequestIdHash: hashClientRequestId(clientRequestId),
              survivalRequestFingerprint: requestFingerprint,
              // Resgate é o único efeito crítico posterior à persistência
              // hoje — pedidos sem resgate já nascem "completed" (nada mais
              // precisa ser confirmado). Ver survivalStateBloqueiaSucesso.
              survivalState: (resgateAplicado ? "pending_critical_confirmation" : "completed") satisfies SurvivalPedidoState,
            }
          : {}),
        itens,
        total,
        status: "novo" as const,
        horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
        endereco,
        data: new Date().toLocaleDateString("pt-BR"),
        origem: "site",
        statusToken,
        ...(body.observacao ? { observacao: body.observacao } : {}),
        pagamento: body.pagamento,
        ...(pix ? { pix } : {}),
        ...(body.troco ? { troco: body.troco } : {}),
        ...(taxa ? { taxaEntrega: taxa } : {}),
        ...(body.bairro ? { bairro: body.bairro } : {}),
        ...(body.referencia ? { referencia: body.referencia } : {}),
        ...(body.tipoEntrega ? { tipoEntrega: body.tipoEntrega } : {}),
        ...(body.tipoEntrega === "delivery" && body.rua ? { rua: body.rua } : {}),
        ...(body.tipoEntrega === "delivery" && body.numero ? { enderecoNumero: body.numero } : {}),
        // Snapshot estruturado dos itens (Etapa edição de pedido): permite
        // recarregar o carrinho fielmente ao iniciar uma edição, sem depender
        // de reinterpretar as strings formatadas de `itens`. Inclui o(s) item(ns)
        // materializados do presente da Jornada do Chef, se houver.
        itensDetalhados: itensDetalhadosFinais,
        revision: 1,
      };

      await redis.set("pedidos", [...pedidos, novoPedido]);
      pedidoIdCriado = pedidoId;
    } catch (err) {
      // Revisão de segurança, 5ª rodada, ponto 3: uma exceção de
      // redis.set("pedidos", ...) NÃO comprova que o pedido não foi
      // persistido — o Redis pode ter aplicado a escrita e a resposta HTTP
      // ter sofrido timeout. Para tentativas protegidas pelo Modo
      // Sobrevivência (pedidoId estável via attempt + hash gravado no
      // pedido), reconcilia com uma leitura FRESCA antes de compensar às
      // cegas.
      if (clientRequestId) {
        // 7ª revisão de segurança, ponto 3: `pedido.id === pedidoId` sozinho
        // não basta para reconciliar — confirma hash+fingerprint+match único
        // antes de aproveitar qualquer campo do pedido encontrado.
        const reconciliacao = await reconciliarIdentidadeCompletaAposFalha(
          pedidoId,
          hashClientRequestId(clientRequestId),
          requestFingerprint ?? ""
        );
        if (reconciliacao.tipo === "incerto") {
          logSurvivalErro("pedido_app", "reconciliacao_persistencia", "leitura_incerta", err);
          // Nunca compensa, nunca libera claim/attempt — não há como saber
          // se o pedido existe ou não.
          return respostaClaimIncerto();
        }
        if (reconciliacao.tipo === "inconsistente") {
          // Encontrou um pedido com o mesmo id, mas a identidade completa
          // (hash/fingerprint/unicidade/campos essenciais) não bate — trata
          // como colisão/inconsistência, NUNCA como o pedido desta
          // tentativa. Nunca compensa, nunca libera claim às cegas.
          logSurvivalErro("pedido_app", "reconciliacao_persistencia", "identidade_inconsistente", err);
          return respostaClaimIncerto();
        }
        if (reconciliacao.tipo === "encontrado") {
          // O pedido FOI persistido de verdade apesar da exceção reportada
          // — nunca duplicar, nunca liberar o vínculo da Jornada nem o
          // claim às cegas. Continua o fluxo normal a partir daqui como se
          // a persistência tivesse retornado com sucesso, usando os dados
          // REAIS já persistidos (nunca os valores locais não confirmados).
          pedidoIdCriado = pedidoId;
          numeroPedido = typeof reconciliacao.pedido.numero === "number" ? reconciliacao.pedido.numero : 0;
          statusToken = typeof reconciliacao.pedido.statusToken === "string" ? reconciliacao.pedido.statusToken : "";
          pix = reconciliacao.pedido.pix;
        } else {
          // "nao_encontrado" comprovado — agora sim, seguro compensar.
          if (recompensaJornadaId && clienteIdJornada) {
            // Revisão de segurança, 5ª rodada, ponto 5: o resultado da
            // liberação NUNCA é ignorado (nunca só `.catch(() => {})`). Se
            // não for possível comprovar que a recompensa foi liberada, a
            // rota NUNCA finge sucesso — mantém claim+attempt estáveis para
            // uma tentativa de recuperação operacional, e um retry legítimo
            // continua reutilizando o MESMO pedidoId (nunca vincula a
            // recompensa a outro).
            let vinculoLiberado = true;
            try {
              await liberarVinculoRecompensaPedidoNaoCriado(clienteIdJornada, recompensaJornadaId, pedidoId);
            } catch (errLiberacao) {
              vinculoLiberado = false;
              logSurvivalErro("pedido_app", "compensacao_jornada", "liberar_vinculo_falhou", errLiberacao);
            }
            if (!vinculoLiberado) {
              return NextResponse.json(
                {
                  ok: false,
                  unresolved: true,
                  error: "Não foi possível confirmar este pedido. Não tente novamente agora — verifique com a pizzaria antes de fazer um novo pedido.",
                },
                { status: 503 }
              );
            }
          }
          await liberarClaimSeAdquirido(clientRequestId, ownerToken, requestFingerprint, claimAdquirido);
          console.error("[ChefeBot] Erro ao preparar/persistir pedido do site:", err);
          return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
        }
      } else {
        // Sem clientRequestId (flag desligada ou ausente) — este é o
        // caminho ATIVO hoje em produção (todas as flags de sobrevivência
        // desligadas). Nenhuma reconciliação de idempotência é possível
        // aqui (pedidoId não é estável, sem hash gravado no pedido), então
        // qualquer exceção é tratada como "não persistido". Mas isso NÃO
        // justifica ignorar o resultado da liberação do vínculo da
        // Jornada — 7ª revisão de segurança, ponto 5: um `.catch(() => {})`
        // fingiria sucesso mesmo quando a recompensa continuasse presa a
        // um pedido que nunca existiu. Sem clientRequestId não há como
        // automatizar um retry seguro nem gerar outro vínculo — a única
        // opção segura é reportar o estado incerto e pedir confirmação
        // operacional antes de uma nova tentativa.
        if (recompensaJornadaId && clienteIdJornada) {
          let vinculoLiberado = true;
          try {
            await liberarVinculoRecompensaPedidoNaoCriado(clienteIdJornada, recompensaJornadaId, pedidoId);
          } catch (errLiberacao) {
            vinculoLiberado = false;
            logSurvivalErro("pedido_app", "compensacao_jornada_sem_client_request_id", "liberar_vinculo_falhou", errLiberacao);
          }
          if (!vinculoLiberado) {
            return NextResponse.json(
              {
                ok: false,
                unresolved: true,
                error: "Não foi possível confirmar este pedido. Não tente novamente agora — verifique com a pizzaria antes de fazer um novo pedido.",
              },
              { status: 503 }
            );
          }
        }
        console.error("[ChefeBot] Erro ao preparar/persistir pedido do site:", err);
        return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
      }
    }

    // A partir daqui o pedido EXISTE de verdade, mas — se houver resgate —
    // ainda em estado "pending_critical_confirmation": o registro durável
    // (:result) só é gravado DEPOIS de o efeito crítico (débito do resgate)
    // estar confirmado. Ordem segura: persistir (já feito) → confirmar
    // crítico → marcar completed → gravar :result → liberar claim → só
    // então responder sucesso. Pedidos sem resgate não têm nada crítico
    // pendente e seguem o caminho simples (gravam :result imediatamente),
    // mas passam pela MESMA função `gravarResultadoDuravel` — uma regra
    // única e auditável.
    let resultadoGravado = false;

    if (resgateAplicado) {
      // Confirma o resgate (Etapa 5): se o débito não persistir, o pedido
      // com desconto é revertido e a API não devolve sucesso com estado
      // inconsistente.
      try {
        await confirmarResgatePontos(resgateAplicado.clienteId, resgateAplicado.resgateId, pedidoId);
      } catch (err) {
        console.error("[ChefeBot] Erro ao confirmar resgate de fidelidade — tentando reverter o pedido:", err);
        try {
          const pedidosAtuais = (await redis.get<unknown[]>("pedidos")) || [];
          await redis.set(
            "pedidos",
            pedidosAtuais.filter((pedido) => (pedido as { id?: unknown } | null)?.id !== pedidoId)
          );
          // O pedido foi removido de verdade — nenhum :result foi gravado
          // ainda (era exatamente o que este bloco adiava), então não há
          // nada para invalidar. Agora é seguro (e correto) liberar o
          // claim, para um retry legítimo poder tentar de novo.
          await liberarClaimSeAdquirido(clientRequestId, ownerToken, requestFingerprint, claimAdquirido);
          return NextResponse.json({ ok: false, error: "Nao foi possivel confirmar o resgate. Tente novamente." }, { status: 409 });
        } catch (errRollback) {
          // FALHA CRÍTICA: nem a confirmação do resgate nem o rollback do
          // pedido tiveram sucesso. O pedido continua existindo em
          // "pending_critical_confirmation" — tenta, best-effort, marcar
          // "recovery_required" (nunca afirmar que foi persistido sem
          // realmente ter conseguido — se esta tentativa também falhar, o
          // pedido simplesmente permanece em "pending_critical_confirmation",
          // que já bloqueia sucesso de forma idêntica). NUNCA devolve
          // sucesso (nem degradado). O claim NUNCA é liberado aqui.
          await marcarSurvivalStateDoPedido(pedidoId, "recovery_required").catch(() => {});
          logSurvivalErro("pedido_app", "rollback_resgate", "falha_critica_rollback", errRollback);
          return NextResponse.json(
            {
              ok: false,
              unresolved: true,
              error: "Não foi possível confirmar nem reverter este pedido. Não tente novamente agora — verifique com a pizzaria antes de fazer um novo pedido.",
            },
            { status: 503 }
          );
        }
      }

      // Débito do resgate confirmado com sucesso — agora precisa REGISTRAR
      // essa consistência no próprio pedido para que o fast path/busca por
      // hash possam reconstruir sucesso. `marcarSurvivalStateDoPedido`
      // retorna um boolean explícito — NUNCA ignorado: se a transição não
      // puder ser comprovada, esta resposta NUNCA finge sucesso, mesmo com
      // o resgate já efetivamente debitado (rollback aqui seria ERRADO —
      // desfaria um débito que já aconteceu de verdade).
      if (clientRequestId) {
        const marcadoCompleted = await marcarSurvivalStateDoPedido(pedidoId, "completed");
        if (!marcadoCompleted) {
          await marcarSurvivalStateDoPedido(pedidoId, "recovery_required").catch(() => {});
          logSurvivalErro("pedido_app", "transicao_completed", "falha_ao_marcar_completed");
          return NextResponse.json(
            {
              ok: false,
              unresolved: true,
              error: "Não foi possível confirmar este pedido. Não tente novamente agora — verifique com a pizzaria antes de fazer um novo pedido.",
            },
            { status: 503 }
          );
        }
      }
    }

    if (claimAdquirido && clientRequestId && requestFingerprint) {
      resultadoGravado = await gravarResultadoDuravel(clientRequestId, requestFingerprint, pedidoId, numeroPedido, statusToken);
      if (resultadoGravado) {
        // Best-effort (5ª rodada, ponto 6) — só informativo, nada depende
        // deste campo mudar.
        await marcarAttemptComoCompleted(clientRequestId, requestFingerprint);
      }
    }

    // Pontos previstos (modelo novo): a identidade canonica e o telefone do
    // pedido, nao a existencia de perfil ativo. A estimativa nunca afeta o
    // saldo confirmado e falhas aqui nao impedem a criacao do pedido.
    const clienteIdPontos = derivarClienteIdPorTelefone(telefonePedido);
    if (clienteIdPontos) {
      try {
        const pontosElegiveis = calcularPontosElegiveisPedido({ total, taxaEntrega: taxa });
        if (pontosElegiveis > 0) {
          await registrarMovimentoPontosIdempotente(clienteIdPontos, {
            eventoId: construirEventoIdPontos(pedidoId, "previsto"),
            pedidoId,
            tipo: "previsto",
            pontos: pontosElegiveis,
            motivo: `Pontos previstos do pedido ${pedidoId}`,
          });
        }
      } catch (err) {
        console.error("[ChefeBot] Erro ao registrar pontos previstos (ignorado):", err);
      }
    }

    // Dispara notificação push para a Kellyne (mesmo canal do WhatsApp)
    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://chefebot-pjif.vercel.app";
      const firstName = body.cliente.split(" ")[0];
      const itensResumo = itens.slice(0, 2).join(", ") + (itens.length > 2 ? "..." : "");
      await fetch(`${baseUrl}/api/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "notify",
          title: `Pedido #${numeroPedido} (site) — ${firstName} 🍕`,
          message: itensResumo,
        }),
      });
    } catch {}

    // getConfigPix + serializarPixCliente: o pedido já existe de verdade a
    // partir daqui, então uma falha aqui NUNCA vira um 500 cru — devolve a
    // confirmação real do pedido, sinalizando "degradado" e sem fabricar
    // dado de pagamento algum.
    let pixCliente: ReturnType<typeof serializarPixCliente>;
    let degradado = false;
    try {
      const configPix = await getConfigPix();
      pixCliente = serializarPixCliente(pix, configPix);
    } catch (err) {
      degradado = true;
      logSurvivalErro("pedido_app", "serializacao_pix", "config_pix_falhou", err);
    }

    if (claimAdquirido && clientRequestId && ownerToken && requestFingerprint && resultadoGravado) {
      // Best-effort: o registro durável já é a fonte de verdade a partir
      // daqui — liberar o claim agora só evita segurar a chave até o TTL
      // curto (30s) expirar sozinho; uma falha aqui não muda nada de
      // observável para o cliente.
      await redis
        .eval(LIBERAR_CLAIM_SE_DONO_SCRIPT, [chaveClaimPedido(clientRequestId)], [montarValorClaim(ownerToken, requestFingerprint)])
        .catch((err) => logSurvivalErro("idempotencia_pedido", "liberacao", "eval_falhou", err));
    }

    const resposta: PedidoAppRespostaSucesso = {
      ok: true,
      pedidoId,
      numero: numeroPedido,
      total,
      statusToken,
      ...(pixCliente ? { pix: pixCliente } : {}),
      ...(degradado ? { degradado: true } : {}),
    };
    return NextResponse.json(resposta);
  } catch (error) {
    // Removida a regra genérica de que toda exceção depois da persistência
    // vira sucesso degradado. As únicas falhas que podem gerar `ok:true
    // degradado` são secundárias e já isoladas em seus próprios try/catch
    // (push, pontos previstos, getConfigPix/Pix) — nenhuma delas propaga
    // exceção até aqui. Qualquer exceção que ainda chegue neste catch
    // DEPOIS da persistência (`pedidoIdCriado` setado) é, por definição, um
    // caso que nenhuma recuperação local já cobriu — nunca finge sucesso:
    // resposta recuperável, carrinho preservado, log sanitizado.
    if (pedidoIdCriado) {
      logSurvivalErro("pedido_app", "pos_persistencia", "excecao_nao_tratada_apos_persistir", error);
      return respostaClaimIncerto();
    }
    // Nenhum pedido foi persistido — se havíamos reivindicado o claim,
    // libera para permitir um retry legítimo com o mesmo clientRequestId.
    await liberarClaimSeAdquirido(clientRequestId, ownerToken, requestFingerprint, claimAdquirido);
    console.error("Erro ao salvar pedido do site:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
