import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { redis } from "@/lib/redis";
import { obterEsgotadosEfetivos, obterEsgotadosLegado, obterEstoqueItens } from "@/lib/estoque";
import { mutarPedidos } from "@/lib/pedidosConcorrencia";
import { gerarIdPedidoUnico, proximoNumeroPedido } from "@/lib/numeracao";
import { getMENUDinamico } from "@/lib/menu.server";
import { computeTaxaApp, buildEnderecoApp } from "@/lib/pedidoAppLogic";
import { criarPixMetadata, prepararPixProviderMercadoPago, serializarPixCliente, gerarTxidPixInterno, type PixMetadata } from "@/lib/pix";
import { PROMOS_KEY, catalogoDoMenu, dentroDaJanela, precoFinalPromocao, promocaoIndisponivel, type Promocao } from "@/lib/promocoes";
import { validarTokenCardapio } from "@/lib/cardapioToken";
import { temDinheiroNoPagamento, valorDinheiroEsperado, temPixNoPagamento, valorPixEsperado } from "@/lib/bot";
import { verificarTokenCliente, CLIENTE_COOKIE } from "@/lib/clienteAuth";
import { buscarClientePorId, sanitizeTelefoneCliente } from "@/lib/clientes";
import { calcularPontosElegiveisPedido, registrarMovimentoPontosIdempotente, construirEventoIdPontos, derivarClienteIdPorTelefone, obterReservasResgatePontos, confirmarResgatePontos } from "@/lib/fidelidade";
import { type ItemApp, type MenuPedidoApp, formatItem, officialUnitPrice, makePromoUnitPrice, contarPizzasPagasParaFidelidade } from "@/lib/pedidoAppItens";
import {
  temSelecaoEstruturada,
  resolverItemComSelecaoEstruturada,
  temSelecaoSimplesEstruturada,
  resolverItemComSelecaoSimplesEstruturada,
  temSelecaoDupla,
} from "@/lib/pedidoAppSelecaoEstruturada";
import { buildPizzaCatalog } from "@/lib/catalog/pizzas";
import { buildSimpleCatalog } from "@/lib/catalog/simpleProducts";
import { construirSnapshotItem, construirSnapshotOficial, type PedidoSnapshotOficial } from "@/lib/pedidoSnapshot";
import { prepararResgateParaPedido, confirmarReservaNoPedido, liberarVinculoRecompensaPedidoNaoCriado, type EscolhaRecompensaJornada } from "@/lib/jornadaChef";
import { survivalModeEnabled, survivalClientRequestIdEnforcementEnabled } from "@/survival/flags";
import { lerSessaoAdministrativa, origemDoPedido } from "@/lib/sessaoAdministrativa";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { registrarRuaConhecida } from "@/lib/ruasConhecidas";
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
  calcularChecklistFingerprint,
  calcularPricingFingerprint,
  chaveAttemptPedido,
  chaveClaimPedido,
  chaveResultadoPedido,
  chaveResultadoTokenPedido,
  ehAttemptValido,
  ehResultadoIdempotenciaValido,
  extrairFingerprintDoClaim,
  montarValorClaim,
  type ChecklistOficialAttempt,
  type ItemOficialAttempt,
  type RegistroAttemptPedido,
  type ResultadoIdempotenciaPedido,
  type SnapshotFinanceiroAttempt,
} from "@/survival/pedidoIdempotencia";

export const maxDuration = 20;

type PedidoApp = {
  cliente: string;
  telefone?: string;
  /** Só é honrado quando existir sessão administrativa real no servidor (ver lerSessaoAdministrativa). */
  semTelefonePainel?: boolean;
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

type PedidoAppRespostaSucesso = {
  ok: true;
  pedidoId: string;
  numero: number;
  total: number;
  statusToken: string;
  pix?: unknown;
  degradado?: true;
};

type SurvivalPedidoState = "pending_critical_confirmation" | "completed" | "recovery_required";

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
    logSurvivalErro("idempotencia_pedido", "reconstrucao", "resultado_stale_pedido_ausente");
    return { tipo: "stale" };
  }
  if (survivalStateBloqueiaSucesso(busca.pedido)) {
    return { tipo: "pendente_critico" };
  }
  const resposta = await montarRespostaAPartirDoPedido(busca.pedido, registro.pedidoId, registro.numero, registro.statusToken);
  return { tipo: "sucesso", resposta };
}

type ResultadoInvalidacaoStale = "removido" | "ja_ausente" | "substituido_por_outro" | "incerto";

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

const MAX_TENTATIVAS_RESOLUCAO_RESULTADO = 3;

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

    const statusInvalidacao = await invalidarResultadoStaleAtomico(clientRequestId, consultaRapida.registro.resultToken);
    if (statusInvalidacao === "incerto") return { tipo: "resposta", resposta: respostaClaimIncerto() };
    if (statusInvalidacao === "removido" || statusInvalidacao === "ja_ausente") return { tipo: "prosseguir" };
  }
  return { tipo: "resposta", resposta: respostaAindaProcessando() };
}

type ResultadoBuscaPorHash =
  | { tipo: "nao_encontrado" }
  | { tipo: "incerto" }
  | { tipo: "conflito_fingerprint" }
  | { tipo: "pendente_critico" }
  | { tipo: "encontrado"; pedido: PedidoArmazenado };

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

async function persistirRegistroResultado(clientRequestId: string, registro: ResultadoIdempotenciaPedido): Promise<void> {
  await redis.eval(
    GRAVAR_RESULTADO_E_TOKEN_SCRIPT,
    [chaveResultadoPedido(clientRequestId), chaveResultadoTokenPedido(clientRequestId)],
    [JSON.stringify(registro), registro.resultToken, String(RESULT_TTL_SEGUNDOS)]
  );
}

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

async function marcarSurvivalStateDoPedido(pedidoId: string, novoEstado: SurvivalPedidoState): Promise<boolean> {
  try {
    return await mutarPedidos<PedidoArmazenado, boolean>((pedidosFrescos) => {
      const idx = pedidosFrescos.findIndex((p) => p && p.id === pedidoId);
      if (idx < 0) return { persistir: false, resultado: false };
      const atualizados = [...pedidosFrescos];
      atualizados[idx] = { ...atualizados[idx], survivalState: novoEstado };
      return { persistir: true, pedidos: atualizados, resultado: true };
    });
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

async function tentarReivindicarClaim(claimKey: string, valorClaim: string, requestFingerprint: string): Promise<ResultadoClaim> {
  try {
    const reivindicado = await redis.set(claimKey, valorClaim, { nx: true, ex: CLAIM_TTL_SEGUNDOS });
    if (reivindicado) {
      return { tipo: "claimed" };
    }
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "claim", "set_nx_falhou", err);
    return { tipo: "incerto" };
  }

  let claimAtual: unknown;
  try {
    claimAtual = await redis.get(claimKey);
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "leitura_claim", "get_claim_falhou", err);
    return { tipo: "incerto" };
  }
  const fingerprintAtual = extrairFingerprintDoClaim(claimAtual);
  if (fingerprintAtual === null) {
    return { tipo: "incerto" };
  }
  return { tipo: fingerprintAtual === requestFingerprint ? "processando_mesmo_fingerprint" : "conflito_fingerprint" };
}

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
  | { tipo: "obtido"; pedidoId: string; txid: string; pricing: SnapshotFinanceiroAttempt; checkout: ChecklistOficialAttempt }
  | { tipo: "conflito_fingerprint" }
  | { tipo: "incerto" };

type ResultadoConsultaAttempt =
  | { tipo: "encontrado"; registro: RegistroAttemptPedido }
  | { tipo: "nao_encontrado" }
  | { tipo: "conflito_fingerprint" }
  | { tipo: "incerto" };

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

async function obterOuCriarAttempt(
  clientRequestId: string,
  requestFingerprint: string,
  pedidoIdCandidato: string,
  pricingCandidato: SnapshotFinanceiroAttempt,
  checkoutCandidato: ChecklistOficialAttempt
): Promise<ResultadoAttempt> {
  const chave = chaveAttemptPedido(clientRequestId);
  const txidCandidato = gerarTxidPixInterno(pedidoIdCandidato);
  const registroCandidato: RegistroAttemptPedido = {
    state: "in_progress",
    requestFingerprint,
    pedidoId: pedidoIdCandidato,
    txid: txidCandidato,
    pricing: pricingCandidato,
    checkout: checkoutCandidato,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    const criado = await redis.set(chave, registroCandidato, { nx: true, ex: ATTEMPT_TTL_SEGUNDOS });
    if (criado) {
      return { tipo: "obtido", pedidoId: pedidoIdCandidato, txid: txidCandidato, pricing: pricingCandidato, checkout: checkoutCandidato };
    }
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "attempt", "set_nx_falhou", err);
    return { tipo: "incerto" };
  }

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
  return { tipo: "obtido", pedidoId: atual.pedidoId, txid: atual.txid, pricing: atual.pricing, checkout: atual.checkout };
}

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
  let attemptRecuperado: RegistroAttemptPedido | null = null;
  let pedidoIdCriado: string | null = null;

  try {
    const body = (await req.json()) as PedidoApp;

    if (!body.cliente || !body.itens || body.itens.length === 0) {
      return NextResponse.json({ ok: false, error: "Pedido inválido" }, { status: 400 });
    }
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
    if (body.itens.some((item) => Boolean((item as ItemApp & { recompensaJornadaId?: unknown }).recompensaJornadaId))) {
      return NextResponse.json({ ok: false, error: "Item inválido" }, { status: 400 });
    }

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

    const sessaoAdmin = await lerSessaoAdministrativa(req);
    const sessaoSalao = await lerSessaoSalao(req);
    const survivalAtivo = survivalModeEnabled();
    const idempotenciaAtiva = survivalAtivo || sessaoAdmin !== null;
    clientRequestId = idempotenciaAtiva ? sanitizeClientRequestId(body.clientRequestId) : null;

    if (sessaoAdmin && !clientRequestId) {
      return NextResponse.json(
        {
          ok: false,
          error: body.clientRequestId
            ? "Identificador de tentativa (clientRequestId) inválido."
            : "Identificador de tentativa (clientRequestId) é obrigatório para pedido administrativo.",
        },
        { status: 400 }
      );
    }

    if (idempotenciaAtiva && body.clientRequestId && !clientRequestId) {
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
      const attemptAntecipado = await consultarAttemptSomenteLeitura(clientRequestId, requestFingerprint);
      if (attemptAntecipado.tipo === "incerto") return respostaClaimIncerto();
      if (attemptAntecipado.tipo === "conflito_fingerprint") return respostaConflitoFingerprint();
      if (attemptAntecipado.tipo === "encontrado") {
        attemptRecuperado = attemptAntecipado.registro;
      }
    }

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
    const semTelefonePainel = !!body.semTelefonePainel && !!sessaoAdmin;
    if (!telefonePedido && !semTelefonePainel && !sessaoSalao) {
      return NextResponse.json({ ok: false, error: "Telefone obrigatório" }, { status: 400 });
    }

    let clienteIdJornada: string | undefined;
    let itensDetalhadosFinais: ItemApp[];
    let itens: string[];
    let subtotal: number;
    let descontoFidelidade = 0;
    let resgateAplicado: { clienteId: string; resgateId: string } | null = null;
    let taxa: number;
    let total: number;
    let pizzasCount = 0;
    let snapshotOficialCandidato: PedidoSnapshotOficial | undefined;

    if (attemptRecuperado) {
      const checkout = attemptRecuperado.checkout;
      if ((body.resgateId ?? undefined) !== checkout.resgateId || (recompensaJornadaId ?? undefined) !== checkout.recompensaJornadaId) {
        logSurvivalErro("idempotencia_pedido", "recuperacao_attempt", "checkout_inconsistente_com_requisicao");
        return respostaClaimIncerto();
      }

      itens = checkout.itens;
      itensDetalhadosFinais = checkout.itensDetalhados.map((item) => ({ ...item }));
      subtotal = attemptRecuperado.pricing.subtotal;
      descontoFidelidade = attemptRecuperado.pricing.descontoFidelidade;
      taxa = attemptRecuperado.pricing.taxaEntrega;
      total = attemptRecuperado.pricing.total;

      if (checkout.resgateId) {
        const clienteIdResgate = derivarClienteIdPorTelefone(telefonePedido);
        if (!clienteIdResgate) {
          logSurvivalErro("idempotencia_pedido", "recuperacao_attempt", "telefone_invalido_para_resgate");
          return respostaClaimIncerto();
        }
        resgateAplicado = { clienteId: clienteIdResgate, resgateId: checkout.resgateId };
      }

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
        if (sanitizeTelefoneCliente(telefonePedido) !== sanitizeTelefoneCliente(clienteSessaoJornada.telefone)) {
          return NextResponse.json({ ok: false, error: "O telefone do pedido não corresponde ao seu perfil. Presente da Jornada do Chef não aplicado." }, { status: 403 });
        }
        clienteIdJornada = derivarClienteIdPorTelefone(clienteSessaoJornada.telefone) ?? clienteSessaoJornada.clienteId;
      }

      try {
        pizzasCount = contarPizzasPagasParaFidelidade(itensDetalhadosFinais);
      } catch (err) {
        console.error("[ChefeBot] Erro ao contar pizzas para fidelidade (ignorado):", err);
      }
    } else {
      const menu = await getMENUDinamico();
      const temPromo = body.itens.some((item) => item.kind === "promo");
      const promos = temPromo ? ((await redis.get<Promocao[]>(PROMOS_KEY)) || []) : [];
      const esgotadosPromo = temPromo ? (await obterEsgotadosEfetivos(menu)) : [];
      const catalogoPromo = temPromo ? catalogoDoMenu(menu as never) : [];

      const promoUnitPrice = makePromoUnitPrice({
        promos,
        esgotadosPromo,
        dentroDaJanela,
        promocaoIndisponivel,
        precoFinalPromocao: (promo) => precoFinalPromocao(promo, catalogoPromo),
      });

      const temSelecaoPizzaEstruturada = body.itens.some((item) => temSelecaoEstruturada(item));
      const temSelecaoSimplesEstruturadaAlgumItem = body.itens.some((item) => temSelecaoSimplesEstruturada(item));
      const precisaCatalogoEstruturado = temSelecaoPizzaEstruturada || temSelecaoSimplesEstruturadaAlgumItem;
      const [esgotadosLegado, estoqueItens] = precisaCatalogoEstruturado
        ? await Promise.all([obterEsgotadosLegado(), obterEstoqueItens()])
        : [[], {}];
      const esgotadosIds = Object.values(estoqueItens).filter((item) => item.esgotado).map((item) => item.id);
      const pizzaCatalog = temSelecaoPizzaEstruturada ? buildPizzaCatalog(menu, esgotadosLegado, esgotadosIds) : null;
      // Regra de canal no servidor: os IDs Copo/Jarra só existem no catálogo
      // usado por uma sessão REAL do Salão. Pedido vindo do link público,
      // mesmo que adultere productId/price manualmente, continua resolvendo
      // contra o escopo público e é rejeitado pelo resolver.
      const simpleCatalog = temSelecaoSimplesEstruturadaAlgumItem
        ? buildSimpleCatalog(menu, esgotadosLegado, esgotadosIds, sessaoSalao ? "salao" : "public")
        : null;

      let itensResolvidos: { itemCanonico: ItemApp; linha: string; unitPrice: number | null; qty: number; motivo?: string }[];
      try {
        itensResolvidos = body.itens.map((item) => {
          if (temSelecaoDupla(item)) {
            return { itemCanonico: item, linha: "", unitPrice: null, qty: item.qty, motivo: "Seleção dupla (pizzaSelection e simpleSelection juntas)" };
          }
          if (temSelecaoEstruturada(item)) {
            const resolvido = resolverItemComSelecaoEstruturada(item, pizzaCatalog!);
            if (!resolvido.ok) return { itemCanonico: item, linha: "", unitPrice: null, qty: item.qty, motivo: resolvido.error };
            return {
              itemCanonico: resolvido.item,
              linha: formatItem(resolvido.item),
              unitPrice: resolvido.item.price,
              qty: item.qty,
            };
          }
          if (temSelecaoSimplesEstruturada(item)) {
            const resolvido = resolverItemComSelecaoSimplesEstruturada(item, simpleCatalog!);
            if (!resolvido.ok) return { itemCanonico: item, linha: "", unitPrice: null, qty: item.qty, motivo: resolvido.error };
            return {
              itemCanonico: resolvido.item,
              linha: formatItem(resolvido.item),
              unitPrice: resolvido.item.price,
              qty: item.qty,
            };
          }
          const unitPriceLegado = item.kind === "promo" ? promoUnitPrice(item) : officialUnitPrice(item, menu as MenuPedidoApp);
          return {
            itemCanonico: item,
            linha: formatItem(item),
            unitPrice: unitPriceLegado,
            qty: item.qty,
            ...(unitPriceLegado === null ? { motivo: "Item legado (name/detail) não reconhecido no cardápio atual" } : {}),
          };
        });
      } catch (err) {
        console.error("[ChefeBot] Erro inesperado ao resolver itens do pedido:", err instanceof Error ? err.message : err);
        return NextResponse.json({ ok: false, error: "Item inválido" }, { status: 400 });
      }

      const itemInvalido = itensResolvidos.find((item) => item.unitPrice === null);
      if (itemInvalido) {
        console.error("[ChefeBot] Item de pedido rejeitado:", itemInvalido.motivo ?? "motivo não capturado");
        return NextResponse.json({ ok: false, error: "Item inválido", motivo: itemInvalido.motivo }, { status: 400 });
      }

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

      const itensRecompensaValidados = itensRecompensaMaterializados.map((item) => ({
        linha: formatItem(item),
        unitPrice: 0,
        qty: item.qty,
      }));
      itensDetalhadosFinais = [...itensResolvidos.map((r) => r.itemCanonico), ...itensRecompensaMaterializados];
      const itensValidadosFinais = [...itensResolvidos, ...itensRecompensaValidados];
      itens = itensValidadosFinais.map((item) => item.linha);
      subtotal = itensValidadosFinais.reduce((s, item) => s + item.unitPrice! * item.qty, 0);

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
        descontoFidelidade = Math.max(0, Math.min(reserva.valorDescontoMaximo, subtotal));
        if (descontoFidelidade <= 0) {
          return NextResponse.json({ ok: false, error: "Pedido não atinge o valor mínimo para usar o resgate" }, { status: 400 });
        }
        resgateAplicado = { clienteId: clienteIdResgate, resgateId: reserva.resgateId };
      }

      taxa = computeTaxaApp(body.tipoEntrega, body.bairro, menu.neighborhoods as Array<{ name: string; fee: number }>);
      total = subtotal - descontoFidelidade + taxa;

      snapshotOficialCandidato = construirSnapshotOficial({
        itens: [
          ...itensResolvidos.map((resolvido, i) =>
            construirSnapshotItem({
              kind: resolvido.itemCanonico.kind,
              nome: resolvido.itemCanonico.name,
              detalhe: resolvido.itemCanonico.detail,
              quantidade: resolvido.qty,
              precoUnitarioReais: resolvido.unitPrice!,
              selecao: body.itens[i].pizzaSelection ?? body.itens[i].simpleSelection,
            })
          ),
          ...itensRecompensaMaterializados.map((item) =>
            construirSnapshotItem({
              kind: item.kind,
              nome: item.name,
              detalhe: item.detail,
              quantidade: item.qty,
              precoUnitarioReais: 0,
            })
          ),
        ],
        subtotalReais: subtotal,
        descontoReais: descontoFidelidade,
        taxaReais: taxa,
        tipoEntrega: body.tipoEntrega,
        bairro: body.bairro,
        pagamento: body.pagamento,
        criadoEm: new Date().toISOString(),
      });

      try {
        pizzasCount = contarPizzasPagasParaFidelidade(itensDetalhadosFinais);
      } catch (err) {
        console.error("[ChefeBot] Erro ao contar pizzas para fidelidade (ignorado):", err);
      }
    }

    const endereco = buildEnderecoApp({ tipoEntrega: body.tipoEntrega, rua: body.rua, numero: body.numero, bairro: body.bairro });

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

    let pedidoId: string;
    if (attemptRecuperado) {
      pedidoId = attemptRecuperado.pedidoId;
    } else {
      try {
        pedidoId = await gerarIdPedidoUnico();
      } catch (err) {
        logSurvivalErro("idempotencia_pedido", "pedido_id", "gerar_id_falhou", err);
        return respostaClaimIncerto();
      }
    }

    let valorPixEsperadoSnapshot: number | undefined;

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
        }
        return respostaAindaProcessando();
      }
      claimAdquirido = true;

      const pricingCandidato: SnapshotFinanceiroAttempt = {
        total,
        subtotal,
        taxaEntrega: taxa,
        descontoFidelidade,
        ...(temPixNoPagamento(body.pagamento) ? { valorPixEsperado: valorPixEsperado(body.pagamento, total) } : {}),
        pricingFingerprint: "",
      };
      pricingCandidato.pricingFingerprint = calcularPricingFingerprint(pricingCandidato);

      const checkoutCandidato: ChecklistOficialAttempt = {
        itens,
        itensDetalhados: itensDetalhadosFinais as ItemOficialAttempt[],
        ...(resgateAplicado ? { resgateId: resgateAplicado.resgateId } : {}),
        ...(recompensaJornadaId ? { recompensaJornadaId } : {}),
        checklistFingerprint: "",
      };
      checkoutCandidato.checklistFingerprint = calcularChecklistFingerprint(checkoutCandidato);

      const attempt = await obterOuCriarAttempt(clientRequestId, requestFingerprint, pedidoId, pricingCandidato, checkoutCandidato);
      if (attempt.tipo === "conflito_fingerprint") {
        await liberarClaimSeAdquirido(clientRequestId, ownerToken, requestFingerprint, claimAdquirido);
        return respostaConflitoFingerprint();
      }
      if (attempt.tipo === "incerto") {
        return respostaClaimIncerto();
      }
      pedidoId = attempt.pedidoId;
      total = attempt.pricing.total;
      subtotal = attempt.pricing.subtotal;
      taxa = attempt.pricing.taxaEntrega;
      descontoFidelidade = attempt.pricing.descontoFidelidade;
      valorPixEsperadoSnapshot = attempt.pricing.valorPixEsperado;
      itens = attempt.checkout.itens;
      itensDetalhadosFinais = attempt.checkout.itensDetalhados.map((item) => ({ ...item }));
    }

    if (temDinheiroNoPagamento(body.pagamento) && body.troco?.trim() && !/sem\s*troco/i.test(body.troco)) {
      const valorTroco = parseFloat(body.troco.replace(",", ".").replace(/[^0-9.]/g, ""));
      const baseTroco = valorDinheiroEsperado(body.pagamento, total);
      if (isNaN(valorTroco) || valorTroco < baseTroco) {
        await liberarClaimSeAdquirido(clientRequestId, ownerToken, requestFingerprint, claimAdquirido);
        return NextResponse.json({ ok: false, error: "Valor de troco insuficiente para a parte em dinheiro" }, { status: 400 });
      }
    }

    if (recompensaJornadaId && clienteIdJornada) {
      try {
        await confirmarReservaNoPedido(clienteIdJornada, recompensaJornadaId, pedidoId);
      } catch (err) {
        console.error("[ChefeBot] Erro ao vincular presente da Jornada do Chef ao pedido:", err);
        await liberarClaimSeAdquirido(clientRequestId, ownerToken, requestFingerprint, claimAdquirido);
        return NextResponse.json({ ok: false, error: "Nao foi possivel confirmar o presente. Tente novamente." }, { status: 409 });
      }
    }

    let numeroPedido: number;
    let statusToken: string;
    let pix: PixMetadata | undefined;

    if (valorPixEsperadoSnapshot !== undefined) {
      const valorPixRecalculado = temPixNoPagamento(body.pagamento) ? valorPixEsperado(body.pagamento, total) : undefined;
      const divergiu =
        valorPixRecalculado === undefined || Math.round(valorPixRecalculado * 100) !== Math.round(valorPixEsperadoSnapshot * 100);
      if (divergiu) {
        logSurvivalErro("pedido_app", "snapshot_financeiro", "valor_pix_divergente");
        return respostaClaimIncerto();
      }
    }

    const snapshotOficial =
      snapshotOficialCandidato && snapshotOficialCandidato.totalCents === Math.round(total * 100)
        ? snapshotOficialCandidato
        : undefined;

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
        ...(clientRequestId && requestFingerprint
          ? {
              survivalClientRequestIdHash: hashClientRequestId(clientRequestId),
              survivalRequestFingerprint: requestFingerprint,
              survivalState: (resgateAplicado ? "pending_critical_confirmation" : "completed") satisfies SurvivalPedidoState,
            }
          : {}),
        itens,
        total,
        status: "novo" as const,
        horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
        endereco,
        data: new Date().toLocaleDateString("pt-BR"),
        origem: origemDoPedido(sessaoAdmin),
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
        itensDetalhados: itensDetalhadosFinais,
        ...(snapshotOficial ? { snapshotOficial } : {}),
        revision: 1,
      };

      await mutarPedidos<unknown, void>((pedidosFrescos) => ({
        persistir: true,
        pedidos: [...pedidosFrescos, novoPedido],
        resultado: undefined,
      }));
      pedidoIdCriado = pedidoId;
    } catch (err) {
      if (clientRequestId) {
        const reconciliacao = await reconciliarIdentidadeCompletaAposFalha(
          pedidoId,
          hashClientRequestId(clientRequestId),
          requestFingerprint ?? ""
        );
        if (reconciliacao.tipo === "incerto") {
          logSurvivalErro("pedido_app", "reconciliacao_persistencia", "leitura_incerta", err);
          return respostaClaimIncerto();
        }
        if (reconciliacao.tipo === "inconsistente") {
          logSurvivalErro("pedido_app", "reconciliacao_persistencia", "identidade_inconsistente", err);
          return respostaClaimIncerto();
        }
        if (reconciliacao.tipo === "encontrado") {
          pedidoIdCriado = pedidoId;
          numeroPedido = typeof reconciliacao.pedido.numero === "number" ? reconciliacao.pedido.numero : 0;
          statusToken = typeof reconciliacao.pedido.statusToken === "string" ? reconciliacao.pedido.statusToken : "";
          pix = reconciliacao.pedido.pix;
        } else {
          if (recompensaJornadaId && clienteIdJornada) {
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

    let resultadoGravado = false;

    if (resgateAplicado) {
      try {
        await confirmarResgatePontos(resgateAplicado.clienteId, resgateAplicado.resgateId, pedidoId);
      } catch (err) {
        console.error("[ChefeBot] Erro ao confirmar resgate de fidelidade — tentando reverter o pedido:", err);
        try {
          await mutarPedidos<unknown, void>((pedidosFrescos) => ({
            persistir: true,
            pedidos: pedidosFrescos.filter((pedido) => (pedido as { id?: unknown } | null)?.id !== pedidoId),
            resultado: undefined,
          }));
          await liberarClaimSeAdquirido(clientRequestId, ownerToken, requestFingerprint, claimAdquirido);
          return NextResponse.json({ ok: false, error: "Nao foi possivel confirmar o resgate. Tente novamente." }, { status: 409 });
        } catch (errRollback) {
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
        await marcarAttemptComoCompleted(clientRequestId, requestFingerprint);
      }
    }

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

    if (body.tipoEntrega === "delivery" && body.rua?.trim()) {
      try {
        await registrarRuaConhecida(body.rua);
      } catch (err) {
        console.error("[ChefeBot] Erro ao registrar rua conhecida (ignorado):", err);
      }
    }

    if (process.env.NODE_ENV !== "test") try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://chefebot-pjif.vercel.app";
      const firstName = body.cliente.split(" ")[0];
      const itensResumo = itens.slice(0, 2).join(", ") + (itens.length > 2 ? "..." : "");
      await fetch(`${baseUrl}/api/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(1500),
        body: JSON.stringify({
          action: "notify",
          title: `Pedido #${numeroPedido} (site) — ${firstName} 🍕`,
          message: itensResumo,
        }),
      });
    } catch {}

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
    if (pedidoIdCriado) {
      logSurvivalErro("pedido_app", "pos_persistencia", "excecao_nao_tratada_apos_persistir", error);
      return respostaClaimIncerto();
    }
    await liberarClaimSeAdquirido(clientRequestId, ownerToken, requestFingerprint, claimAdquirido);
    console.error("Erro ao salvar pedido do site:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
