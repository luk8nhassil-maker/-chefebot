import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { redis } from "@/lib/redis";
import { proximoNumeroPedido } from "@/lib/numeracao";
import { getMENUDinamico } from "@/lib/menu";
import { computeTaxaApp, buildEnderecoApp } from "@/lib/pedidoAppLogic";
import { criarPixMetadata, prepararPixProviderMercadoPago, serializarPixCliente, type PixMetadata } from "@/lib/pix";
import { PROMOS_KEY, catalogoDoMenu, dentroDaJanela, precoFinalPromocao, promocaoIndisponivel, type Promocao } from "@/lib/promocoes";
import { validarTokenCardapio } from "@/lib/cardapioToken";
import { temDinheiroNoPagamento, valorDinheiroEsperado } from "@/lib/bot";
import { verificarTokenCliente, CLIENTE_COOKIE } from "@/lib/clienteAuth";
import { buscarClientePorId, sanitizeTelefoneCliente } from "@/lib/clientes";
import { calcularPontosElegiveisPedido, registrarMovimentoPontosIdempotente, construirEventoIdPontos, derivarClienteIdPorTelefone, obterReservasResgatePontos, confirmarResgatePontos } from "@/lib/fidelidade";
import { type ItemApp, type MenuPedidoApp, formatItem, officialUnitPrice, makePromoUnitPrice, contarPizzasPagasParaFidelidade } from "@/lib/pedidoAppItens";
import { prepararResgateParaPedido, confirmarReservaNoPedido, liberarVinculoRecompensaPedidoNaoCriado, type EscolhaRecompensaJornada } from "@/lib/jornadaChef";
import { survivalModeEnabled } from "@/survival/flags";
import { hashClientRequestId, sanitizeClientRequestId } from "@/survival/clientRequestId";
import { calcularRequestFingerprint } from "@/survival/requestFingerprint";
import { logSurvivalErro } from "@/survival/logging";
import {
  CLAIM_TTL_SEGUNDOS,
  LIBERAR_CLAIM_SE_DONO_SCRIPT,
  POLL_INTERVALO_MS,
  POLL_TENTATIVAS,
  RESULT_TTL_SEGUNDOS,
  chaveClaimPedido,
  chaveResultadoPedido,
  ehResultadoIdempotenciaValido,
  extrairFingerprintDoClaim,
  montarValorClaim,
  type ResultadoIdempotenciaPedido,
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

function survivalStateBloqueiaSucesso(estado: unknown): boolean {
  return typeof estado === "string" && estado !== ("completed" satisfies SurvivalPedidoState);
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
  if (survivalStateBloqueiaSucesso(busca.pedido.survivalState)) {
    // Pedido existe, mas ainda não passou por um efeito crítico posterior à
    // persistência (resgate) ou ficou em inconsistência que exige
    // intervenção — NUNCA reconstruído como sucesso (revisão de segurança,
    // ponto 1/5).
    return { tipo: "pendente_critico" };
  }
  const resposta = await montarRespostaAPartirDoPedido(busca.pedido, registro.pedidoId, registro.numero, registro.statusToken);
  return { tipo: "sucesso", resposta };
}

// Invalida (DEL) um :result stale SÓ se, numa leitura fresca imediatamente
// antes de apagar, ele ainda for exatamente o mesmo registro já examinado
// (mesmo pedidoId + mesmo createdAt) — nunca um DEL cego que poderia apagar
// o resultado de uma execução concorrente mais nova (revisão de segurança,
// ponto 4).
async function invalidarResultadoStaleSeAindaValido(
  clientRequestId: string,
  pedidoIdEsperado: string,
  createdAtEsperado: number
): Promise<void> {
  try {
    const atual = await redis.get(chaveResultadoPedido(clientRequestId));
    if (ehResultadoIdempotenciaValido(atual) && atual.pedidoId === pedidoIdEsperado && atual.createdAt === createdAtEsperado) {
      await redis.del(chaveResultadoPedido(clientRequestId));
    }
  } catch (err) {
    logSurvivalErro("idempotencia_pedido", "invalidacao_resultado_stale", "falhou", err);
  }
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
  if (survivalStateBloqueiaSucesso(pedidoEncontrado.survivalState)) return { tipo: "pendente_critico" };
  return { tipo: "encontrado", pedido: pedidoEncontrado };
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
    };
    await redis.set(chaveResultadoPedido(clientRequestId), registro, { ex: RESULT_TTL_SEGUNDOS });
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

  // Marcado assim que a persistência do pedido tiver sucesso — usado só
  // pelo catch externo para decidir 503 recuperável (pedido pode já existir,
  // nunca finge sucesso) vs. 500 comum (nada foi criado). Ver revisão de
  // segurança, ponto 5: qualquer exceção NÃO tratada localmente depois da
  // persistência é, por definição, um caso que nenhuma recuperação
  // específica já cobriu — nunca vira sucesso degradado às cegas.
  let pedidoIdCriado: string | null = null;

  try {
    const body = (await req.json()) as PedidoApp;

    // ---------------------------------------------------------------
    // Validações puras: nada aqui escreve dado, reserva recompensa, cria
    // Pix ou produz qualquer efeito externo — só validação e leitura. O
    // claim de idempotência (mais abaixo) só entra em cena DEPOIS de tudo
    // isto, para nunca gastar comandos Redis com um payload inválido.
    // ---------------------------------------------------------------

    if (!body.cliente || !body.itens || body.itens.length === 0) {
      return NextResponse.json({ ok: false, error: "Pedido inválido" }, { status: 400 });
    }
    // Vínculo com o WhatsApp: se veio token do link do cardápio, o telefone
    // resolvido SERVER-SIDE é a fonte principal do pedido — todo cliente já
    // começou a conversa pelo WhatsApp real, então o vínculo é automático.
    // O telefone do body (localStorage antigo, campo preenchido sozinho etc.)
    // é IGNORADO enquanto o token for válido, a menos que o cliente peça
    // explicitamente para usar outro WhatsApp (`usarOutroWhatsapp: true`) —
    // aí sim o telefone digitado vence e o pedido NÃO é tratado como vínculo
    // automático do token. Token inválido/expirado cai na regra normal de
    // telefone obrigatório digitado no checkout.
    const vinculoWhatsapp = body.whatsappToken ? await validarTokenCardapio(body.whatsappToken) : null;
    const telefoneDigitado = (body.telefone || "").trim();
    const usarOutroWhatsapp = !!body.usarOutroWhatsapp;
    const telefonePedido = vinculoWhatsapp && !usarOutroWhatsapp
      ? vinculoWhatsapp.phone
      : telefoneDigitado;
    const whatsappVinculado = !!vinculoWhatsapp && !usarOutroWhatsapp;
    if (!telefonePedido) {
      return NextResponse.json({ ok: false, error: "Telefone obrigatório" }, { status: 400 });
    }
    if (!body.pagamento || !body.pagamento.trim()) {
      return NextResponse.json({ ok: false, error: "Forma de pagamento obrigatória" }, { status: 400 });
    }

    if (temDinheiroNoPagamento(body.pagamento) && !body.troco?.trim()) {
      return NextResponse.json({ ok: false, error: "Troco obrigatorio para dinheiro" }, { status: 400 });
    }

    if (body.tipoEntrega === "delivery" && (!body.bairro?.trim() || !body.rua?.trim() || !body.numero?.trim())) {
      return NextResponse.json({ ok: false, error: "Endereco obrigatorio para entrega" }, { status: 400 });
    }

    const menu = await getMENUDinamico();
    const pedidos = (await redis.get<unknown[]>("pedidos")) || [];

    // O frontend NUNCA decide o que é gratuito (bloqueio econômico crítico):
    // `recompensaJornadaId` num item do carrinho não é mais um campo aceito
    // do cliente — só o servidor marca um item como presente da Jornada,
    // sempre a partir do snapshot da recompensa (ver bloco dedicado abaixo).
    // Qualquer item que chegue com este campo é rejeitado de imediato.
    if (body.itens.some((item) => Boolean((item as ItemApp & { recompensaJornadaId?: unknown }).recompensaJornadaId))) {
      return NextResponse.json({ ok: false, error: "Item inválido" }, { status: 400 });
    }

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

    // Presente da Jornada do Chef (rule 1/2/3): campo dedicado no payload —
    // o frontend só informa QUAL recompensa reservada usar e (só para pizza)
    // o sabor escolhido. Produto, preço, quantidade, tamanho e composição são
    // SEMPRE reconstruídos no servidor a partir do snapshot da própria
    // recompensa (nunca do carrinho) — ver `materializarItensRecompensa`.
    //
    // Autorização é SEMPRE pela sessão da Área do Cliente, nunca pelo
    // telefone digitado no checkout: o telefone do body/whatsappToken não
    // prova propriedade da recompensa (qualquer um pode digitar o telefone
    // de outra pessoa). Pedido comum sem presente continua funcionando como
    // convidado, sem exigir login.
    //
    // `prepararResgateParaPedido` é só leitura/validação — a vinculação real
    // (`confirmarReservaNoPedido`, primeiro efeito irreversível deste fluxo)
    // acontece mais abaixo, depois do claim de idempotência.
    let clienteIdJornada: string | undefined;
    let recompensaJornadaId: string | undefined;
    let itensRecompensaMaterializados: ItemApp[] = [];
    if (body.recompensaJornada && typeof body.recompensaJornada === "object") {
      recompensaJornadaId = String(body.recompensaJornada.recompensaId ?? "").trim();
      if (!recompensaJornadaId) {
        return NextResponse.json({ ok: false, error: "Presente da Jornada do Chef inválido ou já utilizado" }, { status: 400 });
      }

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

      const escolhaBruta = body.recompensaJornada.escolha;
      const escolha: EscolhaRecompensaJornada | undefined =
        escolhaBruta && typeof escolhaBruta === "object"
          ? { sabor: typeof escolhaBruta.sabor === "string" ? escolhaBruta.sabor : undefined }
          : undefined;
      const materializado = await prepararResgateParaPedido(clienteIdJornada, recompensaJornadaId, escolha);
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

    // Itens finais = itens normais do carrinho (preço sempre recalculado no
    // servidor acima) + itens do presente da Jornada, se houver (sempre
    // materializados no servidor, preço sempre 0). Formata como strings, no
    // MESMO padrão do fluxo do WhatsApp.
    const itensDetalhadosFinais: ItemApp[] = [...body.itens, ...itensRecompensaMaterializados];
    const itensValidadosFinais = [...itensValidados, ...itensRecompensaValidados];
    const itens = itensValidadosFinais.map((item) => item.linha);

    const subtotal = itensValidadosFinais.reduce((s, item) => s + item.unitPrice! * item.qty, 0);

    // Resgate de fidelidade (Etapa 5): desconto calculado EXCLUSIVAMENTE no
    // servidor, a partir de uma reserva já validada (nunca um valor vindo do
    // cliente). Identidade canônica é sempre o telefone do pedido — a mesma
    // regra usada para crédito/previsto. Reserva expirada, inexistente ou já
    // usada rejeita o pedido (isto é dinheiro, não um efeito colateral
    // best-effort como o crédito de pontos). `obterReservasResgatePontos` é
    // só leitura — a confirmação real (`confirmarResgatePontos`) acontece
    // depois da persistência do pedido, mais abaixo.
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

    const subtotalComDesconto = subtotal - descontoFidelidade;
    const taxa = computeTaxaApp(body.tipoEntrega, body.bairro, menu.neighborhoods as Array<{ name: string; fee: number }>);
    const total = subtotalComDesconto + taxa;

    // Troco (quando há dinheiro no pagamento, puro ou híbrido) é validado só
    // contra a parte em dinheiro — mesma regra do fluxo do WhatsApp (bot.ts).
    if (temDinheiroNoPagamento(body.pagamento) && body.troco?.trim() && !/sem\s*troco/i.test(body.troco)) {
      const valorTroco = parseFloat(body.troco.replace(",", ".").replace(/[^0-9.]/g, ""));
      const baseTroco = valorDinheiroEsperado(body.pagamento, total);
      if (isNaN(valorTroco) || valorTroco < baseTroco) {
        return NextResponse.json({ ok: false, error: "Valor de troco insuficiente para a parte em dinheiro" }, { status: 400 });
      }
    }

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

    const pedidoId = Date.now().toString();

    // ---------------------------------------------------------------
    // Fim das validações puras. A partir daqui, os próximos passos são
    // efeitos irreversíveis (vincular recompensa, gerar número, criar Pix,
    // persistir) — é aqui, e só aqui, que a idempotência entra em cena.
    // ---------------------------------------------------------------

    clientRequestId = survivalModeEnabled() ? sanitizeClientRequestId(body.clientRequestId) : null;

    if (clientRequestId) {
      const recompensaEscolhaSabor =
        body.recompensaJornada?.escolha && typeof body.recompensaJornada.escolha === "object"
          ? body.recompensaJornada.escolha.sabor
          : undefined;
      requestFingerprint = calcularRequestFingerprint({
        cliente: body.cliente,
        telefonePedido,
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
        recompensaEscolhaSabor,
      });

      const consultaRapida = await consultarResultadoExistente(clientRequestId, requestFingerprint);
      if (consultaRapida.tipo === "conflito_fingerprint") return respostaConflitoFingerprint();
      if (consultaRapida.tipo === "incerto") return respostaClaimIncerto();
      if (consultaRapida.tipo === "encontrado") {
        const reconstrucao = await reconstruirRespostaPedido(consultaRapida.registro);
        if (reconstrucao.tipo === "sucesso") return NextResponse.json(reconstrucao.resposta);
        if (reconstrucao.tipo === "pendente_critico") return respostaClaimIncerto();
        if (reconstrucao.tipo === "incerto") return respostaClaimIncerto();
        // "stale": :result existe mas o pedido comprovadamente não existe
        // mais — invalida (compare-and-delete por pedidoId+createdAt, nunca
        // um DEL cego) e segue como se :result nunca tivesse existido (ver
        // revisão de segurança, ponto 4).
        await invalidarResultadoStaleSeAindaValido(clientRequestId, consultaRapida.registro.pedidoId, consultaRapida.registro.createdAt);
      }
      // "nao_encontrado" (ou :result stale já invalidado) — antes de
      // reivindicar um novo claim, verifica se o PEDIDO REAL já existe (caso
      // em que o :result nunca chegou a ser gravado ou já expirou — ver
      // revisão de segurança, ponto 1). Nunca cria um segundo pedido quando
      // o hash bate.
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
        };
        await redis
          .set(chaveResultadoPedido(clientRequestId), registroRecriado, { ex: RESULT_TTL_SEGUNDOS })
          .catch((err) => logSurvivalErro("idempotencia_pedido", "recriacao_resultado", "set_falhou", err));
        return NextResponse.json(respostaRecuperada);
      }
      // "nao_encontrado" em ambos — segue para tentar reivindicar o claim.

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
    }

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

    const numeroPedido = await proximoNumeroPedido();
    const statusToken = criarTokenPublicoAcompanhamento();
    const pixBase = criarPixMetadata(pedidoId, body.pagamento, total);
    const pix = await prepararPixProviderMercadoPago({
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

    try {
      await redis.set("pedidos", [...pedidos, novoPedido]);
      pedidoIdCriado = pedidoId;
    } catch (err) {
      // O pedido não chegou a ser persistido — libera só o vínculo desta
      // recompensa com este pedidoId (nunca reescreve a lista inteira de
      // "pedidos" como compensação, rule 6), e libera o claim de idempotência
      // (nenhum pedido existe, retry legítimo deve poder tentar de novo).
      if (recompensaJornadaId && clienteIdJornada) {
        await liberarVinculoRecompensaPedidoNaoCriado(clienteIdJornada, recompensaJornadaId, pedidoId).catch(() => {});
      }
      await liberarClaimSeAdquirido(clientRequestId, ownerToken, requestFingerprint, claimAdquirido);
      console.error("[ChefeBot] Erro ao persistir pedido do site:", err);
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
    }

    // A partir daqui o pedido EXISTE de verdade, mas — se houver resgate —
    // ainda em estado "pending_critical_confirmation" (revisão de segurança,
    // ponto 1/2): o registro durável (:result) só é gravado DEPOIS de o
    // efeito crítico (débito do resgate) estar confirmado. Ordem segura:
    // persistir (já feito) → confirmar crítico → marcar completed →
    // gravar :result → liberar claim → só então responder sucesso. Pedidos
    // sem resgate não têm nada crítico pendente e seguem o caminho simples
    // (gravam :result imediatamente), mas passam pela MESMA função
    // `gravarResultadoDuravel` — uma regra única e auditável.
    let resultadoGravado = false;

    if (resgateAplicado) {
      // Confirma o resgate (Etapa 5): se o débito não persistir, o pedido
      // com desconto é revertido e a API não devolve sucesso com estado
      // inconsistente.
      try {
        await confirmarResgatePontos(resgateAplicado.clienteId, resgateAplicado.resgateId, pedidoId);
        if (clientRequestId) {
          await marcarSurvivalStateDoPedido(pedidoId, "completed");
        }
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
          // FALHA CRÍTICA (revisão de segurança, ponto 3): nem a confirmação
          // do resgate nem o rollback do pedido tiveram sucesso. O pedido
          // continua existindo em "pending_critical_confirmation" — NUNCA
          // devolve sucesso (nem degradado): a busca por hash/fast path já
          // trata esse estado como bloqueante (survivalStateBloqueiaSucesso),
          // então nenhum retry consegue criar um segundo pedido enquanto
          // isto não for resolvido operacionalmente. O claim NUNCA é
          // liberado aqui (liberar não ajudaria — a busca por hash já
          // bloqueia mesmo sem claim — e evita qualquer janela extra).
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
    }

    if (claimAdquirido && clientRequestId && requestFingerprint) {
      resultadoGravado = await gravarResultadoDuravel(clientRequestId, requestFingerprint, pedidoId, numeroPedido, statusToken);
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
    // partir daqui, então uma falha aqui NUNCA vira um 500 cru (ponto 5) —
    // devolve a confirmação real do pedido, sinalizando "degradado" e sem
    // fabricar dado de pagamento algum.
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
    // Revisão de segurança, ponto 5: removida a regra genérica de que toda
    // exceção depois da persistência vira sucesso degradado. As únicas
    // falhas que podem gerar `ok:true degradado` são secundárias e já
    // isoladas em seus próprios try/catch (push, pontos previstos,
    // getConfigPix/Pix) — nenhuma delas propaga exceção até aqui. Qualquer
    // exceção que ainda chegue neste catch DEPOIS da persistência
    // (`pedidoIdCriado` setado) é, por definição, um caso que nenhuma
    // recuperação local já cobriu (o rollback do resgate, por exemplo, já
    // trata sua própria falha crítica dentro do próprio bloco, sem nunca
    // relançar) — nunca finge sucesso: resposta recuperável, carrinho
    // preservado, log sanitizado para investigação.
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
