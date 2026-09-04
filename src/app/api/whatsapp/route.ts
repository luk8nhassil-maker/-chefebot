import { NextRequest, NextResponse, after } from "next/server";
import { processMessage, createInitialSession, createReturningSession, montarSaudacaoRetorno, mensagemSaudacaoPadrao, garantirLinkCardapioEmMensagens, LINK_CARDAPIO_DIGITAL, BotSession, ClienteHistorico, setMenuDinamico, setConfigDinamica, setEsgotados, setHorarioFuncionamento, temPixNoPagamento, valorPixEsperado } from "@/lib/bot";
import { criarOuReutilizarTokenCardapio, anexarTokenAoLinkCardapio } from "@/lib/cardapioToken";
import { getMENUDinamico } from "@/lib/menu.server";
import { redis } from "@/lib/redis";
import { obterEsgotadosEfetivos } from "@/lib/estoque";
import { interpretarMensagem, gerarRespostaGuardiao } from "@/lib/claude";
import { registrarMensagem, ultimasMensagensRelevantes } from "@/lib/conversa";
import { atualizarRascunhoAtendimentoTempoReal } from "@/lib/rascunhoAtendimentoTempoReal";
import { analisarConversaParaRetomada, validarRespostaIA } from "@/lib/conversationBrain";
import { resolverFallbackInteligente, pareceFallbackSeco, avaliarHandoffPorConfusao, deveMarcarPrioridadePosPedido, houveAvancoReal } from "@/lib/fallbackInteligente";
import { resumirCasoParaAprendizado, registrarCasoPendente, consumirCasoPendente, avaliarResultadoDaRetomada, salvarCasoResolvido, anonimizarConversaId } from "@/lib/learningMemory";
import { log } from "@/lib/logger";
import { analisarComprovantePix } from "@/lib/analisarComprovante";
import { transcreverAudio } from "@/lib/transcribeAudio";
import { gerarIdPedidoUnico, proximoNumeroPedido } from "@/lib/numeracao";
import { salvarStatusConexao, StatusConexao } from "@/lib/conexaoWhatsapp";
import { ehConfirmacaoPedido } from "@/lib/confirmacaoPedido";
import { escolherStepDeRetomada, detectarConversaMorta } from "@/lib/reviverConversa";
import { clientePediuChavePixManual, confirmarPixMetadata, criarPixMetadata, marcarPixRevisaoOuSuspeito, montarMensagensChavePixManual, montarMensagensPixMercadoPagoWhatsApp, prepararPixProviderMercadoPago, registrarPixEvidencia, serializarPixCliente, type PixCliente, type PixEvidenciaOrigem, type PixMetadata } from "@/lib/pix";
import { chaveDedupIdentificadorComprovantePix, extrairIdentificadorComprovantePix, normalizarIdentificadorComprovantePix, PIX_COMPROVANTE_E2E_TTL_SEGUNDOS, type PixComprovanteIdentificador } from "@/lib/pixComprovanteEvidencia";
import { chaveDedupComprovantePix, gerarHashComprovantePixMidia, gerarHashComprovantePixTexto, PIX_COMPROVANTE_DEDUP_TTL_SEGUNDOS } from "@/lib/pixComprovanteHash";
import { avaliarHorarioComprovantePix, extrairDataHoraComprovantePix, FUSO_OPERACIONAL_PIX, type PixComprovanteHorarioExtraido, type ResultadoHorarioComprovantePix } from "@/lib/pixComprovanteHorario";
import { avaliarEvidenciaPix, type ResultadoEvidenciaPix } from "@/lib/pixComprovanteAvaliacao";
import { encontrarPedidoPixPendentePorTelefone } from "@/lib/pixPedidoMatching";
import { telefonesCorrespondem } from "@/lib/telefone";
import { creditarPontosPedidoEntregue } from "@/lib/fidelidade";
import { itensJornadaDoCarrinhoWhatsApp, processarConclusaoPedidoJornada } from "@/lib/jornadaChef";
import { buildCatalog } from "@/lib/catalog/adapter";
import { norm, type ItemApp } from "@/lib/pedidoAppItens";
import type { Menu } from "@/lib/menu";
import type { BotStep } from "@/lib/bot";
import { ehEventoQrAtualizado, extrairQrBase64, obterConfigEvolution } from "@/lib/evolutionApi";
import { extrairTelefoneIndividualDaChave } from "@/lib/whatsappJid";
import { limparQrAtual, persistirQrAtual } from "@/lib/whatsappQrCache";
import { enviarTextoWhatsApp } from "@/lib/whatsappMensagem";
import { ehEcoPainel, validarMessageId } from "@/lib/conversaEcoPainel";
import {
  CanaryInboundRetryableError,
  ehEcoOutboundCanario,
  processarPossivelInboundCanario,
} from "@/lib/whatsappCanary";
import { marcarInboundRecebido, marcarOutboundConfirmado, marcarUpsertDescartado, marcarWebhookRecebido } from "@/lib/whatsappDiag";
import { sanitizeErrorMessage } from "@/lib/sanitizeLog";
import { mutarPedidos } from "@/lib/pedidosConcorrencia";

export const maxDuration = 30;

type Pedido = {
  id: string;
  numero?: number;
  cliente: string;
  telefone: string;
  itens: string[];
  // Espelho estruturado (aditivo, Fase 7) de `itens` — IDs estáveis do
  // catálogo oficial quando resolvíveis. `itens` (string[]) continua sendo
  // a fonte que Pix/impressão leem, sem nenhuma mudança; este campo é só
  // para consumidores que já sabem ler seleção estruturada (ex.: futura
  // Fidelidade por item). Ver construirItensDetalhadosWhatsApp abaixo.
  itensDetalhados?: ItemApp[];
  total: number;
  status: "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado";
  horario: string;
  data?: string;
  endereco: string;
  escalonado?: boolean;
  horarioEscalonado?: number;
  cancelamentoSolicitado?: boolean;
  observacao?: string;
  pixConfirmado?: boolean;
  pix?: PixMetadata;
  tipoEntrega?: string;
  horarioInicio?: string;
  pagamento?: string;
  troco?: string;
  clienteId?: string;
  taxaEntrega?: number;
  // Origem/canal do pedido (Nível 6.6A) — só é gravada em pedidos criados
  // por salvarPedido() aqui no webhook do WhatsApp. Pedidos de app/site e
  // pedidos antigos (sem o campo) nunca são tratados como WhatsApp por
  // quem depende deste campo (ex.: notificação pós-conciliação Pix).
  origem?: "whatsapp";
};

type ConfigPizzaria = {
  nomePizzaria: string;
  horaAbertura: number;
  horaFechamento: number;
  chavePix: string;
  nomeTitularPix: string;
  limitePico: number;
  tempoEntregaDelivery?: string;
  tempoEntregaRetirada?: string;
};

const CONFIG_PADRAO: ConfigPizzaria = {
  nomePizzaria: "Chefe da Pizza",
  horaAbertura: 18,
  horaFechamento: 23,
  chavePix: "",
  nomeTitularPix: "",
  limitePico: 0,
  tempoEntregaDelivery: "40-60 minutos",
  tempoEntregaRetirada: "20-30 minutos",
};

async function getConfig(): Promise<ConfigPizzaria> {
  const config = await redis.get<ConfigPizzaria>("config:pizzaria");
  return config ?? CONFIG_PADRAO;
}

function estaAberto(config: ConfigPizzaria): boolean {
  const agora = new Date();
  const brasilia = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const hora = brasilia.getHours();
  return hora >= config.horaAbertura && hora < config.horaFechamento;
}

function mensagemFechado(config: ConfigPizzaria): string {
  const agora = new Date();
  const brasilia = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const hora = brasilia.getHours();
  if (hora >= config.horaFechamento) {
    return `Ola! Obrigado por entrar em contato com a *${config.nomePizzaria}*!\n\nInfelizmente ja encerramos as operacoes de hoje.\n\nNosso horario de funcionamento e:\n*Todos os dias das ${config.horaAbertura}h as ${config.horaFechamento}h*\n\nAmanha estaremos aqui para te atender!`;
  }
  return `Ola! Obrigado por entrar em contato com a *${config.nomePizzaria}*!\n\nAinda nao abrimos hoje.\n\nNosso horario de funcionamento e:\n*Todos os dias das ${config.horaAbertura}h as ${config.horaFechamento}h*\n\nVolte mais tarde e faremos uma pizza incrivel para voce!`;
}

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function eSaudacao(texto: string): boolean {
  const n = normalizar(texto);
  const palavras = ["boa noite", "boa tarde", "bom dia", "oi", "ola", "hello", "oi boa noite", "oi boa tarde", "oi bom dia", "boa", "oii", "oiii", "ei", "hey", "iae", "eai", "e ai", "tudo bem", "tudo bom"];
  return palavras.some(p => n === p || n.startsWith(p + " ") || n.endsWith(" " + p));
}

function querCancelar(texto: string): boolean {
  const n = normalizar(texto);
  const palavras = ["cancelar", "cancela", "cancelamento", "desisti", "desistir", "nao quero mais", "esquece", "deixa pra la", "nao quero", "cancelem", "cancele", "nao vai mais", "mudei de ideia", "mudei de opiniao"];
  return palavras.some(p => n.includes(p));
}

function resolvido(texto: string): boolean {
  const n = normalizar(texto);
  const palavras = ["nao obrigado", "nao preciso", "pode ser", "ta bom", "tudo bem", "obrigado", "valeu", "ok", "beleza", "nao precisa", "so isso", "era isso", "resolvido", "sim obrigado", "nao mais", "chega", "tranquilo", "por enquanto nao", "nao obg", "obg", "vlw", "tmj", "ajudou", "era isso mesmo", "ja ta bom", "pode fechar", "encerrar", "nao quero mais nada", "era so isso", "foi isso", "e isso", "isso mesmo", "perfeito obrigado", "muito obrigado", "mto obg", "grato", "agradeco", "esta tudo certo", "ta tudo certo", "tudo certo", "tudo ok", "ficou otimo", "ficou bom", "muito bom", "perfeito", "esta otimo", "ta otimo", "otimo obg", "otimo valeu"];
  return palavras.some(p => n.includes(p));
}

function eDespedida(texto: string): boolean {
  const n = normalizar(texto);
  const palavras = ["tchau", "flw", "ate mais", "ate logo", "fui", "adeus", "xau", "abraco", "bjs", "beijinho", "tchauzinho", "tchauuu", "xauzinho", "ta bom obrigado", "valeu obrigado", "ok obrigado", "nao obrigado", "nao, obrigado", "nao precisa obrigado", "ta otimo", "ok valeu", "beleza obrigado", "obrigado tchau", "obrigado ate mais", "valeu tchau", "tudo bem obrigado", "ja ta bom", "nao obg", "obg tchau", "vlw tchau", "falou", "flw obg", "obg flw", "ate", "ajudou muito obg", "ajudou obg", "era isso obg", "foi otimo", "adorei", "perfeito tchau", "esta tudo certo", "ta tudo certo", "tudo certo obg", "tudo certo valeu", "esta tudo bem", "ta tudo bem"];
  return palavras.some(p => n.includes(p));
}

function getOpcoesPorStep(step: string): string[] {
  const opcoes: Record<string, string[]> = {
    category: ["pizza", "lanche", "bebida", "suco"],
    size: ["Pequena", "Media", "Grande", "Familia"],
    add_more: ["mais uma pizza", "outro produto", "nao pode fechar"],
    delivery_type: ["entrega", "retirada"],
    payment: ["Pix", "Dinheiro", "Cartao"],
    confirm: ["sim confirmar", "nao retirar"],
    border_escolha: ["Catupiry", "Chocolate", "Cheddar", "Catupiry com Cheddar", "sem borda"],
    returning: ["repetir o mesmo", "quero outra coisa"],
  };
  return opcoes[step] || [];
}

type PedidoSalvoResultado = {
  pedidoId: string;
  pixCliente?: PixCliente;
};

// Fase 7 — WhatsApp: espelho estruturado (aditivo) do carrinho do bot, com
// IDs estáveis do catálogo oficial quando resolvíveis. Não importamos o tipo
// `CartItem` de `@/lib/bot` para não acoplar este módulo à lógica
// conversacional (mesmo princípio de itensJornadaDoCarrinhoWhatsApp em
// @/lib/jornadaChef) — só a forma estrutural mínima necessária.
export type ItemCarrinhoParaDetalhes = { category: string; name: string; size?: string; flavor?: string; border?: string; price: number };

export function construirItensDetalhadosWhatsApp(cart: ItemCarrinhoParaDetalhes[], menu: Menu): ItemApp[] {
  const catalog = buildCatalog(menu);
  const flavorId = (nome?: string) =>
    nome ? [...catalog.saltyFlavors, ...catalog.sweetFlavors].find((f) => norm(f.name) === norm(nome))?.id : undefined;
  const sizeId = (codigoOuLabel?: string) =>
    codigoOuLabel ? catalog.sizes.find((s) => norm(s.code) === norm(codigoOuLabel) || norm(s.label) === norm(codigoOuLabel))?.id : undefined;
  const borderId = (label?: string) =>
    label && label !== "Sem borda" ? catalog.borders.find((b) => norm(b.label) === norm(label))?.id : undefined;
  const productId = (nome?: string) =>
    nome ? [...catalog.lanches, ...catalog.bebidas, ...catalog.sucos].find((p) => norm(p.name) === norm(nome))?.id : undefined;

  return cart.map((item): ItemApp => {
    const borderTxt = item.border && item.border !== "Sem borda" ? ` + ${item.border}` : "";
    const sizeTxt = item.size ? ` ${item.size}` : "";
    const flavorTxt = item.flavor ? ` ${item.flavor}` : "";
    const name = `${item.name}${sizeTxt}${flavorTxt}${borderTxt}`.trim();

    if (item.category === "pizza" && item.flavor) {
      const fId = flavorId(item.flavor);
      const sId = sizeId(item.size);
      if (fId && sId) {
        const bId = borderId(item.border);
        return {
          kind: "pizza",
          name,
          price: item.price,
          qty: 1,
          pizzaSelection: { sizeId: sId, flavorIds: [fId], ...(bId ? { borderId: bId } : {}) },
        };
      }
    } else if (item.category !== "pizza") {
      const pId = productId(item.name);
      if (pId) {
        return { kind: "simple", name, price: item.price, qty: 1, simpleSelection: { productId: pId } };
      }
    }
    // Sabor/produto sem ID resolvível (cardápio mudou desde que o item foi
    // adicionado ao carrinho, ou item não coberto pelo catálogo oficial
    // ainda) — ItemApp válido só sem seleção estruturada. Nunca bloqueia o
    // salvamento do pedido.
    return { kind: item.category === "pizza" ? "pizza" : "simple", name, price: item.price, qty: 1 };
  });
}

async function salvarPedido(session: BotSession, phone: string, _config: ConfigPizzaria): Promise<PedidoSalvoResultado> {
  const itens = session.cart.map((item) => {
    const border = item.border && item.border !== "Sem borda" ? ` + ${item.border}` : "";
    const size = item.size ? ` ${item.size}` : "";
    const flavor = item.flavor ? ` ${item.flavor}` : "";
    return `${item.name}${size}${flavor}${border}`;
  });
  // Busca o cardápio dinâmico de novo aqui (em vez de receber por parâmetro):
  // salvarPedido é chamada a partir de vários pontos do arquivo, nem todos
  // com o Menu já em mãos — 1 leitura a mais no Redis num caminho que já faz
  // várias (Pix, numeração, lock de pedidos), nunca um caminho quente.
  const menuAtual = await getMENUDinamico();
  const itensDetalhados = construirItensDetalhadosWhatsApp(session.cart, menuAtual);
  const total = session.cart.reduce((sum, item) => sum + item.price, 0) + session.deliveryFee;
  const endereco = session.deliveryType === "delivery"
    ? `${session.address} - ${session.neighborhood}`
    : session.deliveryType === "dine_in"
    ? "Consumo no local"
    : "Retirada na loja";
  const pedidoId = await gerarIdPedidoUnico();
  const numeroPedido = await proximoNumeroPedido();
  const pixBase = criarPixMetadata(pedidoId, session.paymentMethod, total);
  const pix = await prepararPixProviderMercadoPago({
    pedidoId,
    pix: pixBase,
    clienteNome: session.customerName || phone,
  });
  const novoPedido = {
    id: pedidoId,
    numero: numeroPedido,
    cliente: session.customerName || phone,
    telefone: phone,
    origem: "whatsapp" as const,
    itens,
    itensDetalhados,
    total,
    status: "novo" as const,
    horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
    endereco,
    data: new Date().toLocaleDateString("pt-BR"),
    ...(session.observacao ? { observacao: session.observacao } : {}),
    ...(session.paymentMethod ? { pagamento: session.paymentMethod } : {}),
    ...(pix ? { pix } : {}),
    ...(session.troco ? { troco: session.troco } : {}),
    ...(session.deliveryFee ? { taxaEntrega: session.deliveryFee } : {}),
    ...(session.neighborhood ? { bairro: session.neighborhood } : {}),
    ...(session.deliveryType ? { tipoEntrega: session.deliveryType } : {}),
    // Jornada do Chef: captura os itens estruturados do carrinho do bot NO
    // MOMENTO da criação do pedido (nunca reconstruído depois por parsing de
    // texto livre) — ver contarPizzasElegiveisPedido em @/lib/jornadaChef.
    itensJornada: itensJornadaDoCarrinhoWhatsApp(session.cart),
  };
  // Lock GLOBAL só ao redor do append final (ver src/lib/pedidosConcorrencia.ts)
  // — nunca durante a preparação do Pix acima (chamada real ao Mercado Pago).
  await mutarPedidos<Pedido, void>((pedidosFrescos) => ({
    persistir: true,
    pedidos: [...pedidosFrescos, novoPedido],
    resultado: undefined,
  }));

  // Dispara Web Push para todos os dispositivos inscritos
  try {
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://chefebot-pjif.vercel.app";
    const firstName = (session.customerName || phone).split(" ")[0];
    const itensResumo = itens.slice(0, 2).join(", ") + (itens.length > 2 ? "..." : "");
    await fetch(`${baseUrl}/api/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "notify",
        title: `Pedido #${numeroPedido} — ${firstName} 🍕`,
        message: itensResumo,
      }),
    });
  } catch {}

  const histAnterior = await redis.get<ClienteHistorico>(`cliente:${phone}`);
  const totalPedidos = (histAnterior?.totalPedidos || 0) + 1;
  const historico: ClienteHistorico = { nome: session.customerName || phone, ultimoPedido: itens, ultimoTotal: total, ultimoCart: session.cart, ultimoDeliveryFee: session.deliveryFee, ultimoEndereco: session.address, ultimoNeighborhood: session.neighborhood, ultimoDeliveryType: session.deliveryType, ultimoPayment: session.paymentMethod, totalPedidos, ultimaVisita: Date.now() };
  await redis.set(`cliente:${phone}`, historico, { ex: 30 * 24 * 60 * 60 });
  return { pedidoId, pixCliente: serializarPixCliente(pix) };
}

async function salvarEscalonamento(phone: string, session: BotSession) {
  await mutarPedidos<Pedido, void>(async (pedidosFrescos) => {
    const jaExisteAberto = pedidosFrescos.some((p) => p.telefone === phone && p.escalonado === true && p.status === "novo");
    if (jaExisteAberto) return { persistir: false, resultado: undefined };

    // Se ja tem pedido ativo do cliente, marca ele como escalonado em vez de criar novo
    const indexPedidoAtivo = pedidosFrescos.findIndex((p) => p.telefone === phone && p.status === "novo" && !p.escalonado);
    if (indexPedidoAtivo !== -1) {
      const atualizados = [...pedidosFrescos];
      atualizados[indexPedidoAtivo] = { ...atualizados[indexPedidoAtivo], escalonado: true, horarioEscalonado: Date.now() };
      return { persistir: true, pedidos: atualizados, resultado: undefined };
    }

    const agora = Date.now();
    const pedidoId = await gerarIdPedidoUnico();
    const novoPedido: Pedido = {
      id: pedidoId,
      cliente: session.customerName || phone,
      telefone: phone,
      itens: ["Cliente precisa de atendimento humano"],
      total: 0,
      status: "novo",
      horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
      endereco: "-",
      escalonado: true,
      horarioEscalonado: agora,
    };
    return { persistir: true, pedidos: [...pedidosFrescos, novoPedido], resultado: undefined };
  });
}

async function salvarCancelamentoSolicitado(_phone: string, _session: BotSession, pedidoId: string) {
  await mutarPedidos<Pedido, void>((pedidosFrescos) => {
    const index = pedidosFrescos.findIndex(p => p.id === pedidoId);
    if (index === -1) return { persistir: false, resultado: undefined };
    const atualizados = [...pedidosFrescos];
    atualizados[index] = { ...atualizados[index], cancelamentoSolicitado: true };
    return { persistir: true, pedidos: atualizados, resultado: undefined };
  });
}

// NUNCA credita pontos de fidelidade aqui: "entregue" é reaproveitado só como
// marcador de "conversa resolvida" para um pedido que ficou parado em "novo"
// (nunca passou por preparo/entrega de verdade). Ver PR de ajuste da
// estrategia oficial de fidelidade — creditar aqui geraria pontos para
// pedidos que talvez nunca tenham sido realmente entregues.
async function fecharEscalonamento(phone: string) {
  await mutarPedidos<Pedido, void>((pedidosFrescos) => ({
    persistir: true,
    pedidos: pedidosFrescos.map(p =>
      p.telefone === phone && p.escalonado === true && p.status === "novo"
        ? { ...p, status: "entregue" as const, escalonado: false }
        : p
    ),
    resultado: undefined,
  }));
}

// Aplica um patch a UM pedido (por id) sob o lock global — relê "pedidos"
// FRESCO de dentro do lock (nunca reaproveita um `pedidoAtivo`/array
// capturado antes de uma chamada externa lenta, ex.: Claude analisando um
// comprovante) e revalida que o pedido ainda existe antes de persistir.
// Devolve `false` sem escrever nada se o pedido já não existir mais nesse
// momento (nunca finge sucesso). Usado por todos os pontos que confirmam ou
// marcam evidência de Pix — ver auditoria de lost update.
async function atualizarPedidoPorId(
  pedidoId: string,
  aplicar: (pedidoFresco: Pedido) => Partial<Pedido>
): Promise<boolean> {
  return mutarPedidos<Pedido, boolean>((pedidosFrescos) => {
    const index = pedidosFrescos.findIndex(p => p.id === pedidoId);
    if (index === -1) return { persistir: false, resultado: false };
    const atualizados = [...pedidosFrescos];
    atualizados[index] = { ...atualizados[index], ...aplicar(atualizados[index]) };
    return { persistir: true, pedidos: atualizados, resultado: true };
  });
}

export async function enviarMensagem(phone: string, message: string, ritmoRapido = false) {
  // Link do cardápio personalizado: injeta token opaco (?t=) que o site
  // resolve de volta para este phone. Best-effort — falha no Redis nunca
  // impede o envio (o link segue funcionando sem vínculo).
  if (message.includes(LINK_CARDAPIO_DIGITAL)) {
    try {
      const token = await criarOuReutilizarTokenCardapio(phone);
      message = anexarTokenAoLinkCardapio(message, token);
    } catch {}
  }
  // Delay "digitando" proporcional ao tamanho do texto (parece mais humano).
  // Cliente apressado (responde só com número) recebe respostas bem rápidas (~400ms).
  // Cliente calmo (digita por extenso) mantém o ritmo humano (~22ms por caractere).
  const delay = ritmoRapido
    ? Math.min(600, Math.max(400, message.length * 6))
    : Math.min(2500, Math.max(900, message.length * 22));
  // delay no topo (Evolution v2) + options.delay/presence (Evolution v1) p/ compatibilidade
  const resultado = await enviarTextoWhatsApp(phone, message, { delay });
  if (!resultado.ok) {
    if (resultado.motivo === "provider_not_configured") {
      console.error("[ChefeBot] Provider de WhatsApp não configurado — mensagem não enviada.");
    }
    // Envio não confirmado (provider ausente ou falha HTTP/rede): nunca registra
    // no histórico uma mensagem que o cliente pode não ter recebido de fato.
    return;
  }
  // Só registra no histórico (autor "bot") após confirmação de envio — usa o
  // texto FINAL (já com token de cardápio/substituições aplicadas), igual ao
  // que realmente chegou ao cliente. Centraliza aqui o que antes só
  // enviarRespostas() fazia, para que toda chamada de enviarMensagem() passe
  // a aparecer no histórico/painel.
  await registrarMensagem(phone, "bot", message);
  marcarOutboundConfirmado().catch(() => {});
}

async function enviarImagem(phone: string, imageUrl: string) {
  try {
    const config = obterConfigEvolution();
    if (!config) { console.error("[ChefeBot] Provider de WhatsApp não configurado — imagem não enviada."); return; }
    const url = `${config.baseUrl}/message/sendMedia/${config.instanceName}`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.apiKey },
      body: JSON.stringify({ number: phone, mediatype: "image", media: imageUrl, caption: "" }),
    });
  } catch (err) {
    console.error("[ChefeBot] Erro ao enviar imagem:", err);
  }
}

function existePedidoAbertoNaoPixDoTelefone(pedidos: Pedido[], phone: string): boolean {
  return pedidos.some(p =>
    p.status === "novo"
    && !p.escalonado
    && telefonesCorrespondem(p.telefone, phone)
    && !temPixNoPagamento(p.pagamento)
    && !p.pix
  );
}

async function encaminharComprovanteSemPedidoPix(phone: string, session: BotSession | null, origem: "texto" | "midia") {
  await enviarMensagem(phone, `Recebi seu comprovante, mas não consegui vincular automaticamente a um pedido Pix pendente. Vou encaminhar para conferência.`);
  await salvarEscalonamento(phone, session || { step: "done", cart: [], deliveryFee: 0, customerName: phone });
  await log("aviso", "Comprovante Pix sem pedido pendente correspondente", `Phone: ${phone} origem: ${origem}`);
}

async function bloquearComprovantePixReutilizado(phone: string, session: BotSession | null, pedidoAtivo: Pedido, origem: "texto" | "midia") {
  await enviarMensagem(phone, `⚠️ Este comprovante já foi utilizado anteriormente. Por favor, envie o comprovante correto ou entre em contato conosco.`);
  await salvarEscalonamento(phone, session || { step: "done", cart: [], deliveryFee: 0, customerName: pedidoAtivo.cliente });
  await log("aviso", "Comprovante Pix reutilizado detectado", `Phone: ${phone} origem: ${origem}`);
}

function temIdentificadorComprovantePix(identificador: PixComprovanteIdentificador): boolean {
  return !!(identificador.e2eId || identificador.codigoAutenticacao);
}

function escolherIdentificadorComprovantePix(
  preferencial: PixComprovanteIdentificador,
  alternativo: PixComprovanteIdentificador
): PixComprovanteIdentificador {
  const normalizadoPreferencial = normalizarIdentificadorComprovantePix(preferencial);
  if (temIdentificadorComprovantePix(normalizadoPreferencial)) return normalizadoPreferencial;

  return normalizarIdentificadorComprovantePix(alternativo);
}

async function chaveE2EJaUsada(identificador: PixComprovanteIdentificador): Promise<string | undefined> {
  const chave = chaveDedupIdentificadorComprovantePix(identificador);
  if (!chave) return undefined;

  const jaUsado = await redis.get(chave);
  return jaUsado ? chave : undefined;
}

async function registrarDedupE2E(identificador: PixComprovanteIdentificador) {
  const chave = chaveDedupIdentificadorComprovantePix(identificador);
  if (!chave) return;

  await redis.set(chave, true, { ex: PIX_COMPROVANTE_E2E_TTL_SEGUNDOS });
}

function confirmarPixComEvidencia(
  pix: PixMetadata | undefined,
  identificador: PixComprovanteIdentificador,
  origem: PixEvidenciaOrigem,
  horario?: PixComprovanteHorarioExtraido
): PixMetadata {
  const confirmado = confirmarPixMetadata(pix, "comprovante");
  return registrarPixEvidencia(confirmado, {
    ...identificador,
    ...(horario?.dataHora ? { dataHoraPagamento: horario.dataHora } : {}),
    origem,
  });
}

// Persiste o snapshot auditavel da decisao de avaliarEvidenciaPix em pix.evidencia,
// preservando o restante do metadata (Etapa 2E).
function registrarAvaliacaoPixNoMetadata(
  pix: PixMetadata | undefined,
  avaliacao: ResultadoEvidenciaPix,
  identificador: PixComprovanteIdentificador,
  origem: PixEvidenciaOrigem,
  hash: string,
  horario?: PixComprovanteHorarioExtraido
): PixMetadata {
  return registrarPixEvidencia(pix || {}, {
    ...identificador,
    ...(horario?.dataHora ? { dataHoraPagamento: horario.dataHora } : {}),
    origem,
    hash,
    decisao: avaliacao.decisao,
    score: avaliacao.score,
    criterios: avaliacao.criterios,
    motivos: avaliacao.motivos,
    avaliadoEm: new Date().toISOString(),
  });
}

const PALAVRAS_STATUS_PENDENTE_MOTIVO = /agend|pendent|process|analise|conclu[ií]do fals|nao.?conclu|n[aã]o.?conclu|cancel/;

// Deriva um status de transacao aproximado a partir do "motivo" que a IA ja
// devolve hoje (nossos prompts nao extraem um campo de status separado).
// "ilegivel"/ausente vira sinal "ausente" (neutro); qualquer motivo indicando
// agendamento/pendencia vira "pendente_ou_agendado"; o resto e tratado como concluido.
function derivarStatusTransacaoPix(motivo: string | null | undefined): string | undefined {
  const normalizado = (motivo || "").trim().toLowerCase();
  if (!normalizado || normalizado === "ilegivel" || normalizado === "erro_leitura") return undefined;
  return PALAVRAS_STATUS_PENDENTE_MOTIVO.test(normalizado) ? "agendado" : "concluido";
}

// Legibilidade "baixa" apenas quando a propria IA relatou motivo "ilegivel"
// ou erro de leitura; caso contrario tratamos como alta (ela conseguiu extrair campos).
function derivarLegibilidadePix(motivo: string | null | undefined): "alta" | "baixa" | undefined {
  const normalizado = (motivo || "").trim().toLowerCase();
  if (!normalizado) return undefined;
  return normalizado === "ilegivel" || normalizado === "erro_leitura" ? "baixa" : "alta";
}

// Mensagens neutras, sem acusar o cliente de fraude — a distincao real
// (revisar vs suspeito) fica no log e no pix.evidencia para a Kellyne conferir.
const MSG_PIX_REVISAR = "Recebi seu comprovante! 🔍 Vou confirmar alguns detalhes com nossa equipe antes de liberar seu pedido. Só um instante!";
const MSG_PIX_SUSPEITO = "Recebi seu comprovante! 📄 Preciso que nossa equipe confirme esse pagamento antes de liberar seu pedido. Em instantes alguém te retorna.";

// A analise textual/visual (resultado.valido) e a avaliacao por evidencia (avaliarEvidenciaPix)
// sao independentes; a decisao final so aprova quando as duas concordam. Se a IA nao validou
// o comprovante mas o score achou evidencia forte, rebaixa para "revisar" em vez de aprovar —
// nunca o contrario, para nao tornar a aprovacao automatica mais agressiva que hoje.
function decisaoFinalPix(resultadoIAValido: boolean, avaliacao: ResultadoEvidenciaPix): ResultadoEvidenciaPix {
  if (avaliacao.decisao !== "aprovar" || resultadoIAValido) return avaliacao;
  return {
    ...avaliacao,
    decisao: "revisar",
    motivos: [...avaliacao.motivos, "Validacao direta da IA nao confirmou o comprovante."],
  };
}

async function tratarComprovantePixNaoAprovado(
  phone: string,
  session: BotSession | null,
  pedidoAtivo: Pedido,
  origem: PixEvidenciaOrigem,
  avaliacao: ResultadoEvidenciaPix
) {
  const mensagem = avaliacao.decisao === "suspeito" ? MSG_PIX_SUSPEITO : MSG_PIX_REVISAR;
  await enviarMensagem(phone, mensagem);
  await salvarEscalonamento(phone, session || { step: "done", cart: [], deliveryFee: 0, customerName: pedidoAtivo.cliente });
  await log(
    "aviso",
    `Comprovante Pix marcado como ${avaliacao.decisao}`,
    `Phone: ${phone} origem: ${origem} score: ${avaliacao.score} motivos: ${avaliacao.motivos.join("; ") || "-"}`
  );
}

function escolherHorarioComprovantePix(
  preferencial: PixComprovanteHorarioExtraido,
  alternativo: PixComprovanteHorarioExtraido
): PixComprovanteHorarioExtraido {
  if (preferencial.data || preferencial.hora) return preferencial;
  return alternativo;
}

function avaliarHorarioPedidoComprovante(
  pedido: Pedido,
  horario: PixComprovanteHorarioExtraido,
  textoComprovante?: string
): ResultadoHorarioComprovantePix {
  return avaliarHorarioComprovantePix({
    horarioPedido: pedido.horarioInicio || pedido.horario,
    dataPedido: pedido.data,
    dataHoraComprovante: horario.dataHora,
    dataComprovante: horario.data,
    horaComprovante: horario.hora,
    textoComprovante,
    fuso: FUSO_OPERACIONAL_PIX,
  });
}

async function bloquearComprovantePixAnterior(
  phone: string,
  session: BotSession | null,
  pedidoAtivo: Pedido,
  origem: PixEvidenciaOrigem,
  avaliacao: ResultadoHorarioComprovantePix
) {
  await atualizarPedidoPorId(pedidoAtivo.id, (pedidoFresco) => ({
    pix: registrarPixEvidencia(pedidoFresco.pix || {}, {
      origem,
      ...(avaliacao.pagamentoEm ? { dataHoraPagamento: avaliacao.pagamentoEm } : {}),
      motivo: avaliacao.motivo,
    }),
  }));
  await enviarMensagem(phone, `Recebi seu comprovante, mas não consegui validar automaticamente a data/horário do pagamento para este pedido. Vou encaminhar para conferência.`);
  await salvarEscalonamento(phone, session || { step: "done", cart: [], deliveryFee: 0, customerName: pedidoAtivo.cliente });
  await log("aviso", "Comprovante Pix anterior ao pedido", `Phone: ${phone} origem: ${origem} motivo: ${avaliacao.motivo}`);
}

// ── Etapa 2A: representação segura no histórico para entradas do cliente que
// hoje desviam para caminhos especiais (imagem, PDF, áudio) antes de chegar ao
// registro genérico de texto. Nunca inclui base64, payload bruto, URL
// temporária ou qualquer dado técnico — só um marcador curto + o texto real
// (legenda/nome de arquivo/transcrição) já extraído pelos campos do payload.

function extrairTextoSeguro(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

// Remove caracteres de controle (quebra de linha, tab, BEL etc.) que
// quebrariam o formato do marcador, e limita o nome a um tamanho seguro.
function higienizarNomeArquivo(nome: unknown): string {
  const bruto = extrairTextoSeguro(nome).replace(/[\x00-\x1F\x7F]/g, "").trim();
  const LIMITE = 80;
  return bruto.length > LIMITE ? bruto.slice(0, LIMITE) : bruto;
}

// Payload do webhook é `unknown` (JSON externo, formato não confiável) —
// acesso a propriedades feito só através destes dois helpers, nunca com `any`.
function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

function obterCampo(valor: unknown, chave: string): unknown {
  return ehObjeto(valor) ? valor[chave] : undefined;
}

export function montarMarcadorImagem(data: unknown): string {
  const imageMessage = obterCampo(obterCampo(data, "message"), "imageMessage");
  const legenda = extrairTextoSeguro(obterCampo(imageMessage, "caption"));
  return legenda ? `[Imagem recebida] ${legenda}` : `[Imagem recebida]`;
}

export function montarMarcadorDocumento(data: unknown): string {
  const doc = obterCampo(obterCampo(data, "message"), "documentMessage");
  const nome = higienizarNomeArquivo(obterCampo(doc, "fileName"));
  const legenda = extrairTextoSeguro(obterCampo(doc, "caption"));
  if (nome && legenda) return `[Documento recebido: ${nome}] ${legenda}`;
  if (nome) return `[Documento recebido: ${nome}]`;
  if (legenda) return `[Documento PDF recebido] ${legenda}`;
  return `[Documento PDF recebido]`;
}

async function processarComprovanteTexto(phone: string, texto: string, config: ConfigPizzaria) {
  try {
    const sessionKey = `session:${phone}`;
    const session = await redis.get<BotSession>(sessionKey);
    let pedidos = await redis.get<Pedido[]>("pedidos") || [];
    let pedidoAtivo = encontrarPedidoPixPendentePorTelefone(pedidos, phone);

    const isAguardandoPix = session?.step === "aguardando_pix";
    if (isAguardandoPix && !pedidoAtivo && session) {
      await salvarPedido(session, phone, config);
      pedidos = await redis.get<Pedido[]>("pedidos") || [];
      pedidoAtivo = encontrarPedidoPixPendentePorTelefone(pedidos, phone);
    }
    if (!pedidoAtivo) {
      if (session && !isAguardandoPix && !temPixNoPagamento(session.paymentMethod)) return;
      if (existePedidoAbertoNaoPixDoTelefone(pedidos, phone)) return;
      await encaminharComprovanteSemPedidoPix(phone, session, "texto");
      return;
    }

    await enviarMensagem(phone, `Comprovante recebido! 🔍 Verificando o pagamento...`);
    const hashComprovante = gerarHashComprovantePixTexto(texto);
    const chaveHash = chaveDedupComprovantePix(hashComprovante);
    const jaUsado = await redis.get(chaveHash);
    if (jaUsado) {
      await bloquearComprovantePixReutilizado(phone, session, pedidoAtivo, "texto");
      return;
    }
    const identificadorTexto = extrairIdentificadorComprovantePix(texto);
    if (await chaveE2EJaUsada(identificadorTexto)) {
      await bloquearComprovantePixReutilizado(phone, session, pedidoAtivo, "texto");
      return;
    }
    const horarioTexto = extrairDataHoraComprovantePix(texto, pedidoAtivo.data);
    const avaliacaoHorarioTexto = avaliarHorarioPedidoComprovante(pedidoAtivo, horarioTexto, texto);
    if (avaliacaoHorarioTexto.bloquear) {
      await bloquearComprovantePixAnterior(phone, session, pedidoAtivo, "texto", avaliacaoHorarioTexto);
      return;
    }

    // Usa Claude para validar o comprovante em texto
    const client = new (await import("@anthropic-ai/sdk")).default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const agora = new Date();
    const dataHoje = agora.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const horaAtual = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    const horarioRef = pedidoAtivo.horarioInicio || pedidoAtivo.horario || horaAtual;

    const prompt = `Analise este comprovante de Pix (em formato de texto) e valide se é legítimo.

COMPROVANTE RECEBIDO:
${texto}

DADOS ESPERADOS:
- Valor: R$ ${valorPixEsperado(pedidoAtivo.pagamento, pedidoAtivo.total).toFixed(2)}
- Nome do destinatário deve conter: ${config.nomeTitularPix || config.nomePizzaria}
- Chave Pix: ${config.chavePix}
- Data: ${dataHoje}
- Horário mínimo: ${horarioRef}
- E2E ID Pix ou código de autenticação/transação, se estiver visível (não obrigatório)
- Data e hora do pagamento Pix, se estiverem visíveis (hora não obrigatória)
- Nome do destinatário ou chave Pix encontrado no comprovante, se estiver visível

A chave Pix pode aparecer formatada de outra forma (+55, parênteses, espaços, hífens, pontos); considere equivalente se os dígitos corresponderem.
Se data e hora do pagamento estiverem claras, o pagamento não pode ser anterior ao horário do pedido por mais de 8 minutos. Se apenas a data estiver visível ou o horário estiver ilegível, não reprove somente por falta de horário.

Responda APENAS em JSON:
{"valido": true/false, "valor": numero_ou_null, "beneficiario": "nome do destinatario encontrado ou null", "chave": "chave Pix do destinatario encontrada ou null", "e2eId": "E2E ou null", "codigoAutenticacao": "codigo ou null", "dataPagamento": "DD/MM/AAAA ou null", "horaPagamento": "HH:mm ou null", "dataHoraPagamento": "data e hora completa ou null", "motivo": "aprovado/valor_errado/data_errada/horario_anterior/nome_errado/nao_concluido/ilegivel"}`;

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 260,
      messages: [{ role: "user", content: prompt }],
    });

    const respText = response.content[0].type === "text" ? response.content[0].text : "";
    const clean = respText.replace(/```json|```/g, "").trim();
    const resultado = JSON.parse(clean);
    const identificadorAnalise = normalizarIdentificadorComprovantePix({
      e2eId: resultado.e2eId ?? resultado.e2e ?? resultado.endToEndId,
      codigoAutenticacao: resultado.codigoAutenticacao ?? resultado.codigo ?? resultado.codigoTransacao,
    });
    const identificador = escolherIdentificadorComprovantePix(identificadorTexto, identificadorAnalise);
    if (await chaveE2EJaUsada(identificador)) {
      await bloquearComprovantePixReutilizado(phone, session, pedidoAtivo, "texto");
      return;
    }
    const horarioAnalise = extrairDataHoraComprovantePix([
      resultado.dataHoraPagamento,
      [resultado.dataPagamento, resultado.horaPagamento ?? resultado.horarioPagamento].filter(Boolean).join(" "),
    ].filter(Boolean).join("\n"), pedidoAtivo.data);
    const horarioComprovante = escolherHorarioComprovantePix(horarioTexto, horarioAnalise);
    const avaliacaoHorario = avaliarHorarioPedidoComprovante(pedidoAtivo, horarioComprovante, texto);
    if (avaliacaoHorario.bloquear) {
      await bloquearComprovantePixAnterior(phone, session, pedidoAtivo, "texto", avaliacaoHorario);
      return;
    }

    const avaliacao = avaliarEvidenciaPix({
      valorEsperado: valorPixEsperado(pedidoAtivo.pagamento, pedidoAtivo.total),
      valorLido: typeof resultado.valor === "number" ? resultado.valor : null,
      chaveEsperada: config.chavePix,
      chaveLida: resultado.chave ?? resultado.chavePix ?? null,
      beneficiarioEsperado: config.nomeTitularPix || config.nomePizzaria,
      beneficiarioLido: resultado.beneficiario ?? resultado.destinatario ?? null,
      statusTransacao: derivarStatusTransacaoPix(resultado.motivo),
      horario: avaliacaoHorario,
      hashReutilizado: false,
      e2eId: identificador.e2eId,
      codigoAutenticacao: identificador.codigoAutenticacao,
      e2eReutilizado: false,
      origem: "texto",
      legibilidade: derivarLegibilidadePix(resultado.motivo),
    });

    const decisaoFinal = decisaoFinalPix(resultado.valido === true, avaliacao);

    if (decisaoFinal.decisao === "aprovar") {
      await atualizarPedidoPorId(pedidoAtivo!.id, (pedidoFresco) => ({
        pixConfirmado: true,
        pix: confirmarPixComEvidencia(
          registrarAvaliacaoPixNoMetadata(pedidoFresco.pix, decisaoFinal, identificador, "texto", hashComprovante, horarioComprovante),
          identificador,
          "texto",
          horarioComprovante
        ),
      }));
      const firstName = pedidoAtivo.cliente.split(" ")[0];
      const timeMsg = pedidoAtivo.tipoEntrega === "pickup" ? config.tempoEntregaRetirada : config.tempoEntregaDelivery;
      await enviarMensagem(phone, `Pagamento confirmado! ✅🎉

Obrigado, *${firstName}*! Seu pedido já foi pra cozinha. Sua pizza chega em *${timeMsg}* 🛵

Qualquer dúvida é só chamar. Bom apetite! 🍕`);
      await redis.set(chaveHash, true, { ex: PIX_COMPROVANTE_DEDUP_TTL_SEGUNDOS });
      await registrarDedupE2E(identificador);
      const sessionAtual = await redis.get<BotSession>(sessionKey);
      if (sessionAtual) await redis.set(sessionKey, { ...sessionAtual, step: "done" }, { ex: 1800 });
      await log("info", `Pix texto confirmado para ${firstName}`, `Valor: ${resultado.valor}`);
    } else {
      await atualizarPedidoPorId(pedidoAtivo!.id, (pedidoFresco) => ({
        pix: marcarPixRevisaoOuSuspeito(
          registrarAvaliacaoPixNoMetadata(pedidoFresco.pix, decisaoFinal, identificador, "texto", hashComprovante, horarioComprovante),
          decisaoFinal.decisao === "suspeito" ? "suspeito" : "em_revisao"
        ),
      }));
      await tratarComprovantePixNaoAprovado(phone, session, pedidoAtivo, "texto", decisaoFinal);
    }
  } catch (err) {
    await log("erro", "Erro ao processar comprovante texto", String(err));
  }
}

async function processarComprovante(phone: string, data: any, config: ConfigPizzaria, isImagem: boolean) {
  try {
    const sessionKey = `session:${phone}`;
    const session = await redis.get<BotSession>(sessionKey);
    const isAguardandoPix = session?.step === "aguardando_pix";
    let pedidos = await redis.get<Pedido[]>("pedidos") || [];
    let pedidoAtivo = encontrarPedidoPixPendentePorTelefone(pedidos, phone);
    console.log("[ChefeBot] pedidoPixPendente:", !!pedidoAtivo, "step:", session?.step, "pagamento:", pedidoAtivo?.pagamento);

    // Pedido ainda nao foi salvo — salva agora antes de validar
    if (isAguardandoPix && !pedidoAtivo && session) {
      await salvarPedido(session, phone, config);
      pedidos = await redis.get<Pedido[]>("pedidos") || [];
      pedidoAtivo = encontrarPedidoPixPendentePorTelefone(pedidos, phone);
    }
    console.log("[PEDIDO-CHECK]", pedidoAtivo ? pedidoAtivo.id : "NAO ENCONTRADO", "total:", pedidoAtivo?.total);
    if (!pedidoAtivo) {
      if (session && !isAguardandoPix && !temPixNoPagamento(session.paymentMethod)) return;
      if (existePedidoAbertoNaoPixDoTelefone(pedidos, phone)) return;
      await encaminharComprovanteSemPedidoPix(phone, session, "midia");
      return;
    }
    console.log("[COMP-INICIO] iniciando processamento phone:", phone);
    await enviarMensagem(phone, `Comprovante recebido! 🔍 Verificando o pagamento...`);
    let imagemBase64 = "";
    let mediaType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" = isImagem ? "image/jpeg" : "application/pdf";
    try {
      const configComprovante = obterConfigEvolution();
      if (!configComprovante) throw new Error("Provider de WhatsApp não configurado");
      const downloadUrl = `${configComprovante.baseUrl}/chat/getBase64FromMediaMessage/${configComprovante.instanceName}`;
      const msgPayload = { message: data?.data || data };
      const downloadRes = await fetch(downloadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: configComprovante.apiKey },
        body: JSON.stringify(msgPayload),
      });
      if (downloadRes.ok) {
        const downloadData = await downloadRes.json();
        imagemBase64 = downloadData.base64 || "";
        if (downloadData.mimetype) mediaType = downloadData.mimetype;
      } else {
        const errText = await downloadRes.text();
        await log("aviso", "Download comprovante falhou", errText.slice(0, 200));
      }
    } catch (err) {
      await log("aviso", "Erro ao baixar comprovante", String(err));
    }
    if (!imagemBase64) {
      await log("aviso", "Comprovante sem base64 — download falhou", `Phone: ${phone} mediaType: ${mediaType}`);
      await enviarMensagem(phone, `Comprovante recebido! 📄 Nossa equipe vai verificar em instantes. ✅`);
      await salvarEscalonamento(phone, session || { step: "done", cart: [], deliveryFee: 0, customerName: pedidoAtivo.cliente });
      return;
    }
    // Verifica se comprovante ja foi usado antes (anti-reutilizacao)
    const hashComprovante = gerarHashComprovantePixMidia(imagemBase64)
    const chaveHash = chaveDedupComprovantePix(hashComprovante)
    const jaUsado = await redis.get(chaveHash)
    if (jaUsado) {
      await bloquearComprovantePixReutilizado(phone, session, pedidoAtivo, "midia")
      return
    }

    const resultado = await analisarComprovantePix(
      imagemBase64, mediaType as any, valorPixEsperado(pedidoAtivo.pagamento, pedidoAtivo.total),
      config.chavePix, config.nomeTitularPix || config.nomePizzaria,
      pedidoAtivo.horarioInicio || pedidoAtivo.horario
    );
    const identificador = normalizarIdentificadorComprovantePix({
      e2eId: resultado.e2eId ?? undefined,
      codigoAutenticacao: resultado.codigoAutenticacao ?? undefined,
    });
    if (await chaveE2EJaUsada(identificador)) {
      await bloquearComprovantePixReutilizado(phone, session, pedidoAtivo, "midia")
      return
    }
    const horarioComprovante = extrairDataHoraComprovantePix([
      resultado.dataHoraPagamento,
      [resultado.dataPagamento, resultado.horaPagamento].filter(Boolean).join(" "),
    ].filter(Boolean).join("\n"), pedidoAtivo.data);
    const avaliacaoHorario = avaliarHorarioPedidoComprovante(pedidoAtivo, horarioComprovante);
    if (avaliacaoHorario.bloquear) {
      await bloquearComprovantePixAnterior(phone, session, pedidoAtivo, "midia", avaliacaoHorario)
      return
    }

    const avaliacao = avaliarEvidenciaPix({
      valorEsperado: valorPixEsperado(pedidoAtivo.pagamento, pedidoAtivo.total),
      valorLido: resultado.valorEncontrado,
      chaveEsperada: config.chavePix,
      chaveLida: resultado.chavePix,
      beneficiarioEsperado: config.nomeTitularPix || config.nomePizzaria,
      beneficiarioLido: resultado.beneficiario,
      statusTransacao: derivarStatusTransacaoPix(resultado.motivo),
      horario: avaliacaoHorario,
      hashReutilizado: false,
      e2eId: identificador.e2eId,
      codigoAutenticacao: identificador.codigoAutenticacao,
      e2eReutilizado: false,
      origem: mediaType === "application/pdf" ? "pdf" : "imagem",
      legibilidade: derivarLegibilidadePix(resultado.motivo),
    });
    const decisaoFinal = decisaoFinalPix(resultado.valido === true, avaliacao);

    if (decisaoFinal.decisao === "aprovar") {
      await atualizarPedidoPorId(pedidoAtivo.id, (pedidoFresco) => ({
        pixConfirmado: true,
        pix: confirmarPixComEvidencia(
          registrarAvaliacaoPixNoMetadata(pedidoFresco.pix, decisaoFinal, identificador, "midia", hashComprovante, horarioComprovante),
          identificador,
          "midia",
          horarioComprovante
        ),
      }));
      const firstName = pedidoAtivo.cliente.split(" ")[0];
      const timeMsg = pedidoAtivo.tipoEntrega === "pickup" ? config.tempoEntregaRetirada : config.tempoEntregaDelivery;
      await enviarMensagem(phone, `Pagamento confirmado! ✅🎉\n\nObrigado, *${firstName}*! Seu pedido já foi pra cozinha. Sua pizza chega em *${timeMsg}* 🛵\n\nQualquer dúvida é só chamar. Bom apetite! 🍕`);
      await redis.set(chaveHash, true, { ex: PIX_COMPROVANTE_DEDUP_TTL_SEGUNDOS })
      await registrarDedupE2E(identificador)
      await log("info", `Pix confirmado automaticamente para ${firstName}`, `Valor: R$ ${resultado.valorEncontrado}`);
    } else {
      await atualizarPedidoPorId(pedidoAtivo.id, (pedidoFresco) => ({
        pix: marcarPixRevisaoOuSuspeito(
          registrarAvaliacaoPixNoMetadata(pedidoFresco.pix, decisaoFinal, identificador, "midia", hashComprovante, horarioComprovante),
          decisaoFinal.decisao === "suspeito" ? "suspeito" : "em_revisao"
        ),
      }));
      await tratarComprovantePixNaoAprovado(phone, session, pedidoAtivo, "midia", decisaoFinal);
    }
  } catch (err) {
    await log("erro", "Erro ao processar comprovante", String(err));
    await enviarMensagem(phone, `Comprovante recebido! 📄 Nossa equipe vai verificar em instantes. ✅`);
  }
}

export async function enviarRespostas(phone: string, messages: string[], config: ConfigPizzaria, ritmoRapido = false) {
  for (const msg of messages) {
    const msgFinal = config.chavePix ? msg.replace("(configurada pelo admin)", config.chavePix) : msg;
    // enviarMensagem() já registra a mensagem como "bot" após confirmação de
    // envio — não duplicar aqui.
    await enviarMensagem(phone, msgFinal, ritmoRapido);
    await new Promise(resolve => setTimeout(resolve, ritmoRapido ? 150 : 300));
  }
}

// Memória de Conversão: registra como PENDENTE um caso em que o Guardião usou IA
// (BECO/SAIDA). Será avaliado na próxima interação do cliente. Best-effort — nunca
// chama IA extra e nunca altera a sessão.
async function registrarCasoGuardiao(opts: {
  phone: string;
  path: "BECO" | "SAIDA";
  session: BotSession;
  mensagemCliente: string;
  ultimas: { autor?: string; texto: string }[];
  respostaIA: string;
}) {
  try {
    const caso = resumirCasoParaAprendizado({
      conversaId: opts.phone,
      path: opts.path,
      step: opts.session.step,
      mensagemCliente: opts.mensagemCliente,
      ultimasMensagens: opts.ultimas,
      carrinho: opts.session.cart,
      deliveryType: opts.session.deliveryType,
      respostaIA: opts.respostaIA,
      respostaFinal: opts.respostaIA,
      resultado: "PENDENTE",
    });
    await registrarCasoPendente(opts.phone, caso);
  } catch {}
}

// Atualiza o rascunho vivo (leitura da atendente) sem processar fluxo do bot e
// sem responder ao cliente. Usado quando o bot está pausado (global ou manual).
// Best-effort: qualquer falha aqui nunca quebra o webhook.
async function atualizarRascunhoVivo(phone: string, messageText: string) {
  try {
    const sessao = await redis.get<BotSession>(`session:${phone}`);
    if (sessao) {
      // Busca última mensagem da atendente para detectar perguntas de nome.
      const historico = await ultimasMensagensRelevantes(phone, 5);
      const ultimaAtendente = [...historico].reverse().find(m => m.autor === "atendente");
      const contexto = ultimaAtendente ? { ultimaMensagemAtendente: ultimaAtendente.texto } : undefined;
      const atualizada = atualizarRascunhoAtendimentoTempoReal(sessao, messageText, contexto);
      await redis.set(`session:${phone}`, atualizada, { ex: 1800 });
    }
  } catch {}
}

export async function POST(req: NextRequest) {
  // Hoisted para fora do try: o catch abaixo precisa dele para reverter o
  // claim de idempotência quando o processamento falha depois da gravação
  // (ver comentário na chave `msg_processed:` mais abaixo).
  let msgId: string | undefined;
  try {
    const body = await req.json();

    // Telemetria de transporte (best-effort, nunca gate): registra que a
    // Evolution ENTREGOU um evento aqui, antes de qualquer filtro. É o que
    // separa "a Evolution parou de entregar" de "o evento chega e é
    // descartado" — `inboundLastSeenAt` sozinho não distingue os dois, porque
    // só é gravado depois do filtro de JID individual.
    marcarWebhookRecebido(body?.event).catch(() => {});

    // Evento de mudança de status da conexão do WhatsApp (Evolution API).
    // A Evolution envia "connection.update" com data.state podendo ser "open" (conectado),
    // "connecting" (conectando/QR pendente) ou "close" (desconectado).
    if (body.event === "connection.update") {
      const state = body.data?.state as string | undefined;
      const status: StatusConexao = state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected";
      await salvarStatusConexao(status);
      // "connecting" é o estado normal de QR pendente — só limpa o QR
      // persistido quando a conexão sai desse estado (abriu ou fechou de
      // vez), nunca durante o próprio pareamento.
      if (status !== "connecting") {
        const configConexao = obterConfigEvolution();
        if (configConexao) await limparQrAtual(configConexao.instanceName);
      }
      await log("info", `WhatsApp connection.update: ${state} -> ${status}`, "");
      return NextResponse.json({ ok: true });
    }

    // A Evolution reentrega a rotação do QR (a cada ~20s em Baileys, padrão
    // do protocolo) via este evento — nunca ignorar/descartar: é o que
    // mantém o QR exibido ao admin sempre igual ao QR realmente válido na
    // Evolution, em vez de um QR já expirado do lado do provider. Nunca
    // registra o payload do QR em log, só metadados sanitizados.
    if (ehEventoQrAtualizado(body.event)) {
      const configQr = obterConfigEvolution();
      const base64Qr = extrairQrBase64(body.data);
      if (configQr && base64Qr) {
        const registro = await persistirQrAtual(configQr.instanceName, base64Qr);
        console.log(
          "[WEBHOOK-QR] evento:", body.event,
          "hash:", registro.hash,
          "tamanho:", registro.size,
          "geracao:", registro.generationId
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (body.event !== "messages.upsert") return NextResponse.json({ ok: true });

    // Um messages.upsert real, entregue pela própria Evolution, já é prova de que o
    // canal de entrada está operacional — mesmo que whatsapp_connection_status no
    // Redis ainda guarde um status antigo (ex.: a reconexão já terminou, mas o
    // connection.update correspondente não chegou ou não foi processado a tempo).
    // Por isso NÃO pausamos mais a resposta com base só nesse status em cache: só
    // sincronizamos ele (best-effort, nunca derruba o webhook) e seguimos
    // processando normalmente. A confirmação real de que o canal de SAÍDA está
    // ativo continua sendo a resposta HTTP do /message/sendText em enviarMensagem
    // — nunca este status lido do Redis.
    try {
      await salvarStatusConexao("connected");
    } catch (err) {
      console.error("[ChefeBot] Falha ao sincronizar status de conexão a partir de messages.upsert (ignorada):", err);
    }

    const data = body.data;
    if (data?.key?.fromMe) {
      // Mensagem enviada pelo próprio número (celular ou API) — sempre
      // registrada como "atendente" no histórico, independente de
      // manual:{phone} ou bot_ativo (Etapa 2B): garante que qualquer resposta
      // dada pela Kellyne diretamente pelo WhatsApp Business apareça no
      // painel, mesmo com o bot ativo e a conversa não assumida. Exceção: se
      // este messageId já foi marcado como eco de um envio feito pelo painel
      // (/api/conversas/enviar-mensagem-humana confirma o envio pela
      // Evolution, cria a marca de eco e só então registra a mensagem no
      // histórico — nessa ordem, fechando a janela de corrida), não registra
      // de novo aqui: o webhook só consulta a marca (nunca apaga), para que
      // reentregas repetidas do mesmo webhook continuem suprimidas até o TTL
      // expirar. Só processa
      // conversa individual (`@s.whatsapp.net`) — `@lid` só é aceito quando
      // a Evolution fornece o telefone real em `remoteJidAlt`; grupos,
      // broadcasts e LID sem mapeamento são ignorados sem criar histórico/
      // sessão. Bot nunca responde — always early-return.
      try {
        const fromPhone = extrairTelefoneIndividualDaChave(data?.key);
        if (fromPhone) {
          const msgIdFrom = validarMessageId(data?.key?.id);
          const ecoDoPainel = msgIdFrom ? await ehEcoPainel(msgIdFrom) : false;
          const txtFrom =
            data?.message?.conversation ||
            data?.message?.extendedTextMessage?.text ||
            "";
          const ecoDoCanario = txtFrom ? ehEcoOutboundCanario(fromPhone, txtFrom) : false;
          if (!ecoDoPainel && !ecoDoCanario && txtFrom) await registrarMensagem(fromPhone, "atendente", txtFrom);
        }
      } catch {}
      return NextResponse.json({ ok: true });
    }
    const phone = extrairTelefoneIndividualDaChave(data?.key);
    if (!phone) {
      // Descarte legítimo (grupo, broadcast ou LID sem `remoteJidAlt`), mas
      // silencioso até aqui: nenhum log, nenhum marcador. Registra só o
      // SUFIXO do JID e os NOMES dos campos da chave — schema, nunca valor —
      // para o diagnóstico conseguir dizer se as mensagens estão sendo
      // engolidas por este filtro em vez de não chegarem.
      marcarUpsertDescartado(data?.key).catch(() => {});
      return NextResponse.json({ ok: true });
    }

    msgId = data?.key?.id as string | undefined;

    // Sinal de saúde best-effort (nunca gate), inclusive para o inbound do
    // canário que retorna antes do fluxo comercial normal.
    marcarInboundRecebido().catch(() => {});

    // Canário de diagnóstico (Etapa G): se o remetente for exatamente
    // WHATSAPP_CANARY_PHONE e o texto for exatamente o token do teste ativo,
    // trata como round-trip do canário e retorna — nunca cai no fluxo normal
    // do cliente (sem sessão, pedido, carrinho, bot_ativo/manual/spam gates).
    // Token reconhecível do número autorizado é sempre consumido, mesmo se
    // expirado/superseded; só texto comum ou outro telefone segue o bot.
    try {
      const textoCanario =
        data?.message?.conversation || data?.message?.extendedTextMessage?.text || "";
      const foiCanario = await processarPossivelInboundCanario(phone, textoCanario, msgId);
      if (foiCanario) return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof CanaryInboundRetryableError) {
        return NextResponse.json(
          { ok: false, retry: true },
          { status: 503, headers: { "Retry-After": String(Math.max(1, err.retryAfterSeconds)) } }
        );
      }
      console.error("[ChefeBot] Erro ao avaliar canário (sanitizado):", sanitizeErrorMessage(err));
    }

    // Idempotência global: ignora mensagens já processadas (Evolution pode reenviar webhooks).
    // Claim atômico (SET NX) em vez de get-then-set: duas entregas concorrentes do
    // MESMO messageId (retry do provedor correndo em paralelo com a 1a tentativa)
    // não podem mais passar as duas pelo mesmo `get` antes de qualquer `set` ter
    // efeito — só uma delas ganha a chave, a outra é tratada como duplicata.
    //
    // O claim acontece AQUI, antes de qualquer processamento real (criação de
    // sessão/pedido, envio da resposta). Se o processamento falhar depois
    // disso (exceção não tratada — Redis instável, bug, etc.), o catch global
    // no fim desta função (`catch (error)`) reverte este claim (`redis.del`)
    // antes de responder. Sem essa reversão, uma falha real DEPOIS do claim
    // deixava o evento marcado como "processado" por 24h mesmo sem ter gerado
    // nenhuma resposta ao cliente — e uma reentrega genuína do mesmo
    // messageId pela Evolution (retry ou resync de reconexão) era descartada
    // em silêncio pelo resto desse período, sem qualquer nova tentativa.
    if (msgId) {
      const idempotencyKey = `msg_processed:${msgId}`;
      const claimouProcessamento = await redis.set(idempotencyKey, 1, { ex: 86400, nx: true }); // 24h TTL
      if (!claimouProcessamento) return NextResponse.json({ ok: true });
    }

    const config = await getConfig();
    const menuDinamico = await getMENUDinamico();
    setMenuDinamico(menuDinamico);
    setConfigDinamica({ tempoEntregaDelivery: config.tempoEntregaDelivery, tempoEntregaRetirada: config.tempoEntregaRetirada });
    // Mesma fonte de horário usada por estaAberto/mensagemFechado (config:pizzaria
    // no Redis) — antes o bot tinha um horário próprio hardcoded ("22h") que nunca
    // acompanhava o horaFechamento real configurado pela pizzaria.
    setHorarioFuncionamento(`${config.horaFechamento}h`);
    const esgotadosLista = await obterEsgotadosEfetivos(menuDinamico);
    setEsgotados(esgotadosLista);
    console.log("[ChefeBot] Tamanhos carregados:", JSON.stringify(menuDinamico.sizes));

    

    // Detecta imagem ou PDF (comprovante Pix)
    // Detecta imagem/PDF pelo messageType do webhook (Evolution API v2.3.7)
    console.log("[WEBHOOK-FULL]", JSON.stringify(data).slice(0,800));
    const messageType = data?.data?.messageType || data?.messageType || "";
    const isImagem = !!(data?.message?.imageMessage || messageType === "imageMessage" || messageType === "image");
    const isPDF = !!(
      (data?.message?.documentMessage && (
        data?.message?.documentMessage?.mimetype === "application/pdf" ||
        data?.message?.documentMessage?.fileName?.endsWith(".pdf")
      )) ||
      messageType === "documentMessage" ||
      messageType === "document"
    );
    console.log("[PIX-DEBUG2] messageType:", messageType, "isImagem:", isImagem, "isPDF:", isPDF);
    if (isImagem || isPDF) {
      // Registra a entrada do cliente (marcador seguro, nunca base64/payload)
      // ANTES de processarComprovante() — garante que a mídia sempre apareça
      // no histórico, independente do resultado da validação de Pix.
      const marcadorMidia = isImagem ? montarMarcadorImagem(data) : montarMarcadorDocumento(data);
      await registrarMensagem(phone, "cliente", marcadorMidia);
      await processarComprovante(phone, data, config, isImagem);
      return NextResponse.json({ ok: true });
    }

    // Detecta comprovante Pix enviado como texto/cartao automatico
    const rawMsg = data?.data?.message || data?.message || {};
    const msgText = rawMsg?.conversation || rawMsg?.extendedTextMessage?.text || "";
    console.log("[DATA-KEYS]", JSON.stringify(Object.keys(data || {})), "[MSG-KEYS]", JSON.stringify(Object.keys(rawMsg)));
    console.log("[PIX-FULL-MSG]", JSON.stringify(data?.message || {}).slice(0,500));
    const isPixReceipt = msgText.length > 20 && (
      (msgText.toLowerCase().includes("pix") && (msgText.includes("R$") || msgText.includes("valor")) && msgText.includes("nome")) ||
      msgText.toLowerCase().includes("comprovante") ||
      msgText.toLowerCase().includes("transferência") ||
      msgText.toLowerCase().includes("pagamento confirmado") ||
      (msgText.toLowerCase().includes("destino") && msgText.toLowerCase().includes("origem"))
    );
    if (isPixReceipt) {
      console.log("[PIX-TEXT] Comprovante em texto detectado:", msgText.slice(0, 200));
      // Registra o texto original do cliente (mesmo caminho/limite do log
      // genérico de texto, aplicado dentro de registrarMensagem) antes de
      // processar a validação do comprovante — nunca adiciona marcador extra.
      await registrarMensagem(phone, "cliente", msgText);
      await processarComprovanteTexto(phone, msgText, config);
      return NextResponse.json({ ok: true });
    }

    // Detecta áudio
    const isAudio = !!data?.message?.audioMessage || !!data?.message?.pttMessage
    if (isAudio) {
      // Controla se a entrada do cliente já foi registrada nesta requisição,
      // para nunca duplicar caso a transcrição tenha sucesso mas o restante
      // do processamento caia no caminho de fallback (ex.: sessão ausente).
      let clienteAudioRegistrado = false
      try {
        const configAudio = obterConfigEvolution()
        if (!configAudio) throw new Error("Provider de WhatsApp não configurado")
        const downloadUrl = `${configAudio.baseUrl}/chat/getBase64FromMediaMessage/${configAudio.instanceName}`
        const downloadRes = await fetch(downloadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: configAudio.apiKey },
          body: JSON.stringify({ message: data.message }),
        })
        if (downloadRes.ok) {
          const downloadData = await downloadRes.json()
          const base64 = downloadData.base64 || ''
          const mimeType = downloadData.mimetype || 'audio/ogg'
          if (base64) {
            const transcricao = await transcreverAudio(base64, mimeType)
            if (transcricao) {
              // Registra a entrada do cliente (só o texto já transcrito, nunca
              // o áudio/base64 original) antes de qualquer resposta do bot,
              // inclusive o eco da transcrição abaixo.
              await registrarMensagem(phone, "cliente", `[Áudio transcrito] ${transcricao}`)
              clienteAudioRegistrado = true
              await enviarMensagem(phone, `🎤 _"${transcricao}"_`)
              // Processa o texto transcrito como se o cliente tivesse digitado
              // Continua o fluxo normalmente com o texto transcrito
              const sessionKey = `session:${phone}`
              const currentSession = await redis.get<BotSession>(sessionKey)
              if (currentSession) {
                const { processMessage: pm } = await import('@/lib/bot')
                const result = pm(transcricao, currentSession)
                await redis.set(sessionKey, result.session, { ex: 1800 })
                for (const msg of result.messages) {
                  const msgFinal = config.chavePix ? msg.replace('(configurada pelo admin)', config.chavePix) : msg
                  await enviarMensagem(phone, msgFinal)
                  await new Promise(r => setTimeout(r, 500))
                }
                return NextResponse.json({ ok: true })
              }
            }
          }
        }
      } catch {}
      // Não conseguiu transcrever (ou a transcrição não pôde ser usada) —
      // escala para Kellyne. Só registra o marcador de indisponibilidade se a
      // entrada do cliente ainda não foi registrada acima, para nunca duplicar.
      if (!clienteAudioRegistrado) {
        await registrarMensagem(phone, "cliente", "[Áudio recebido — transcrição indisponível]")
      }
      await enviarMensagem(phone, `Recebi seu áudio! 😊 Já chamo alguém para te atender melhor. Um instante!`)
      const sessionAudio = await redis.get<BotSession>(`session:${phone}`) || { step: "escalado" as any, cart: [], deliveryFee: 0 }
      await salvarEscalonamento(phone, sessionAudio)
      await redis.set(`postOrderPriority:${phone}`, true, { ex: 3600 })
      return NextResponse.json({ ok: true })
    }

    const messageText = data?.message?.conversation || data?.message?.extendedTextMessage?.text || "";
    if (!messageText) return NextResponse.json({ ok: true });
    await redis.set(`ultima_msg:${phone}`, messageText.slice(0, 200), { ex: 1800 });

    // Verifica se é entregador confirmando entrega
    const pedidoEntregadorId = await redis.get<string>(`entregador_aguardando:${phone}`)
    if (pedidoEntregadorId) {
      const msgNormalizada = messageText.trim()
      if (msgNormalizada === '1') {
        // Lock GLOBAL só ao redor da leitura fresca + validação de
        // pré-condição (status ainda "saiu_entrega") + mutação + persistência
        // — nunca durante os efeitos externos depois (WhatsApp, fidelidade,
        // Jornada), que continuam fora do lock como sempre.
        const resultadoEntrega = await mutarPedidos<Pedido, { pedido: Pedido; pedidosAtualizados: Pedido[] } | null>((pedidosFrescos) => {
          const index = pedidosFrescos.findIndex(p => p.id === pedidoEntregadorId)
          if (index === -1 || pedidosFrescos[index].status !== 'saiu_entrega') {
            return { persistir: false, resultado: null }
          }
          const atualizados = [...pedidosFrescos]
          atualizados[index] = { ...atualizados[index], status: 'entregue' }
          return { persistir: true, pedidos: atualizados, resultado: { pedido: atualizados[index], pedidosAtualizados: atualizados } }
        })
        if (resultadoEntrega) {
          const { pedido, pedidosAtualizados: pedidos } = resultadoEntrega

          // Fidelidade por pontos: idempotente por pedidoId, isolada em
          // try/catch proprio — falha aqui nunca pode impedir a confirmacao
          // de entrega, que ja foi salva acima.
          try {
            await creditarPontosPedidoEntregue({
              id: pedido.id,
              status: 'entregue',
              telefone: pedido.telefone,
              clienteId: pedido.clienteId,
              total: pedido.total,
              taxaEntrega: pedido.taxaEntrega,
            })
          } catch (err) {
            console.error('[ChefeBot] Erro ao creditar pontos de fidelidade (ignorado):', err)
          }

          // Jornada do Chef: hook centralizado, mesma função chamada em toda
          // transição oficial para "entregue" — nunca duplica a regra por rota.
          await processarConclusaoPedidoJornada(pedido).catch((err) =>
            console.error('[ChefeBot] Erro ao processar Jornada do Chef (ignorado):', err)
          )

          await redis.del(`entregador_aguardando:${phone}`)
          const firstName = pedido.cliente.split(' ')[0]
          await enviarMensagem(pedido.telefone, `*${firstName}*, pedido entregue! 😊\n\nEsperamos que tenha curtido muito. Volte sempre que quiser — estamos aqui! 🍕`)
          const chaveAvaliacao = `avaliacao_enviada:${pedido.id}`
          const jaEnviou = await redis.get(chaveAvaliacao)
          if (!jaEnviou) {
            await redis.set(chaveAvaliacao, true, { ex: 86400 })
            await redis.set(`avaliacao:${pedido.telefone}`, true, { ex: 3600 })
            await enviarMensagem(pedido.telefone, `*${firstName}*, como foi sua experiência hoje? 😊\n\nAvalia nossa pizza de 1 a 5:\n\n  ⭐ 1 — Ruim\n  ⭐⭐ 2 — Regular\n  ⭐⭐⭐ 3 — Bom\n  ⭐⭐⭐⭐ 4 — Muito bom\n  ⭐⭐⭐⭐⭐ 5 — Excelente\n\nÉ só digitar o número! 😄`)
          }
          const maisEntregas = pedidos.filter((p: any) => p.status === 'saiu_entrega' && p.entregador?.telefone?.replace(/\D/g, '') === phone.replace(/\D/g, ''))
          if (maisEntregas.length > 0) {
            const lista = maisEntregas.map((p: any, i: number) => `${i + 1}. *${p.cliente}* — ${p.endereco}\n💰 R$ ${p.total.toFixed(2).replace('.', ',')}`).join('\n\n')
            await enviarMensagem(phone, `✅ Entrega confirmada!\n\nVocê ainda tem *${maisEntregas.length}* entrega${maisEntregas.length > 1 ? 's' : ''} pendente${maisEntregas.length > 1 ? 's' : ''}:\n\n${lista}\n\nQual vai primeiro? Responda o número.`)
            await redis.set(`entregador_aguardando:${phone}`, maisEntregas[0].id, { ex: 3 * 60 * 60 })
            await redis.set(`entregador_escolhendo:${phone}`, JSON.stringify(maisEntregas.map((p: any) => p.id)), { ex: 3 * 60 * 60 })
          } else {
            await enviarMensagem(phone, `✅ Entrega confirmada!\n\n🎉 Todas as entregas concluídas! Pode voltar para a pizzaria. 🍕`)
          }
        }
        return NextResponse.json({ ok: true })
      }
      const escolhendoStr = await redis.get<string>(`entregador_escolhendo:${phone}`)
      if (escolhendoStr) {
        const ids = JSON.parse(escolhendoStr)
        const num = parseInt(messageText.trim()) - 1
        if (num >= 0 && num < ids.length) {
          await redis.set(`entregador_aguardando:${phone}`, ids[num], { ex: 3 * 60 * 60 })
          await redis.del(`entregador_escolhendo:${phone}`)
          const pedidos = await redis.get<any[]>('pedidos') || []
          const pedido = pedidos.find((p: any) => p.id === ids[num])
          if (pedido) {
            const troco = pedido.troco && pedido.troco !== 'Sem troco' ? `\n💵 ${pedido.troco}` : ''
            await enviarMensagem(phone, `👍 Próxima entrega:\n\n📍 *${pedido.cliente}* — ${pedido.endereco}\n💰 R$ ${pedido.total.toFixed(2).replace('.', ',')}${troco}\n\nResponda *1* quando entregar.`)
            const firstName = pedido.cliente.split(' ')[0]
            await enviarMensagem(pedido.telefone, `🛵 *${firstName}*, boa notícia!\n\nSeu pedido é o próximo da fila. Já já chega! 🍕`)
          }
        }
        return NextResponse.json({ ok: true })
      }
    }

    // Salva a mensagem do cliente antes de qualquer early-return de modo pausado/manual.
    // Garante que o painel Tempo Real veja a mensagem independentemente do estado do bot.
    await registrarMensagem(phone, "cliente", messageText);

    const botAtivo = await redis.get<boolean>("bot_ativo");
    if (botAtivo === false) {
      // Bot global pausado ("Você no comando"): NÃO processa fluxo, NÃO responde
      // ao pedido em si. Garante que a conversa apareça no Tempo Real mesmo sem
      // sessão prévia.
      const sessaoExistente = await redis.get<BotSession>(`session:${phone}`);
      if (!sessaoExistente) {
        await redis.set(
          `session:${phone}`,
          { step: "escalado", cart: [], deliveryFee: 0, escalado: true },
          { ex: 1800 }
        );
        // Primeira mensagem de uma conversa nova, mesmo com o bot pausado: o
        // cliente nunca deve ficar em silêncio total só porque ninguém assumiu
        // ainda — recebe a mesma saudação padrão do bot ligado, uma única vez.
        await enviarMensagem(phone, mensagemSaudacaoPadrao(config.nomePizzaria));
      }
      // Mantém o rascunho vivo atualizado para o Resumo rápido da atendente.
      await atualizarRascunhoVivo(phone, messageText);
      return NextResponse.json({ ok: true });
    }

    const emManual = await redis.get<boolean>(`manual:${phone}`);
    if (emManual === true) {
      // Conversa assumida: bot permanece PAUSADO, NÃO responde ao cliente.
      // Atualiza rascunho vivo e sinaliza nova mensagem para o painel.
      await atualizarRascunhoVivo(phone, messageText);
      await redis.set(`nova_msg_manual:${phone}`, true, { ex: 3600 });

      // Garante TTL em manual:{phone} e session:{phone}.
      // Regra: enquanto manual=true, qualquer mensagem do cliente renova ambos.
      // atualizarRascunhoVivo salva a sessão com 1800s — re-lemos aqui para
      // garantir que pegamos a versão atualizada (com rascunho) e salvamos com
      // 7200s (2h). manual:{phone} também recebe 7200s para suportar a janela
      // de abandono de 2h definida em permanenciaTempoReal.
      const sessaoAtual = await redis.get(`session:${phone}`);
      await redis.set(
        `session:${phone}`,
        sessaoAtual ?? { step: 'escalado', cart: [], deliveryFee: 0, escalado: true },
        { ex: 7200 },
      );
      await redis.set(`manual:${phone}`, true, { ex: 7200 });

      return NextResponse.json({ ok: true });
    }

    const spamKey = `spam:${phone}`;
    const spamCount = await redis.get<number>(spamKey) || 0;
    if (spamCount >= 3) return NextResponse.json({ ok: true });
    await redis.set(spamKey, spamCount + 1, { ex: 1 });

    // Modo pos-atendimento
    const resolvendo = await redis.get<boolean>(`resolvendo:${phone}`);
    if (resolvendo === true) {
      await redis.del(`resolvendo:${phone}`);
      await redis.del(`manual:${phone}`);
      await redis.del(`session:${phone}`);
      await fecharEscalonamento(phone);
      if (resolvido(messageText) || eDespedida(messageText)) {
        await enviarMensagem(phone, `Fico feliz em ter ajudado! 😊\n\nQualquer coisa e so chamar. Estamos sempre aqui! 🍕`);
        return NextResponse.json({ ok: true });
      }
      // Reinicia fluxo normalmente
    }

    // Captura avaliacao
    const aguardandoAvaliacao = await redis.get<boolean>(`avaliacao:${phone}`);
    if (aguardandoAvaliacao === true) {
      const nota = parseInt(messageText.trim());
      if (nota >= 1 && nota <= 5) {
        await redis.del(`avaliacao:${phone}`);
        const avaliacoes = await redis.get<Array<{phone: string, nota: number, data: string}>>('avaliacoes') || [];
        avaliacoes.push({ phone, nota, data: new Date().toISOString() });
        await redis.set('avaliacoes', avaliacoes);
        const msgs = [
          `Obrigado pela avaliacao, *${nota}/5*! 😊\n\nSeu feedback e muito importante pra gente. Volte sempre! 🍕`,
          `Que bom saber! Obrigado por avaliar, *${nota}/5*! 🙏\n\nTe esperamos na proxima! 🍕`,
          `Valeu pelo feedback! *${nota}/5* anotado. 😊\n\nAte a proxima! 🍕`,
        ];
        await enviarMensagem(phone, msgs[Math.floor(Math.random() * msgs.length)]);
        return NextResponse.json({ ok: true });
      } else {
        await redis.del(`avaliacao:${phone}`)
        if (!isNaN(parseInt(messageText.trim()))) {
          await redis.set(`avaliacao:${phone}`, true, { ex: 3600 })
          await enviarMensagem(phone, `Por favor, manda um número de 1 a 5! 😊`)
          return NextResponse.json({ ok: true })
        }
        await enviarMensagem(phone, `Posso te ajudar com mais alguma coisa? 😊`)
        await redis.set(`aguardando_resposta:${phone}`, true, { ex: 600 })
        return NextResponse.json({ ok: true })
      }
    }

    const aguardandoResposta = await redis.get<boolean>(`aguardando_resposta:${phone}`)
    if (aguardandoResposta === true) {
      await redis.del(`aguardando_resposta:${phone}`)
      const nResp = messageText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
      const querMais = ["sim", "quero", "pode", "vai", "bora", "oi", "ola", "bom dia", "boa tarde", "boa noite", "olá"].some(p => nResp.includes(p))
      if (querMais) {
        const cats = `O que vai ser hoje? 😊\n\n  1. Pizza\n  2. Lanches\n  3. Bebidas\n  4. Sucos e Vitaminas`
        // Reinício de pedido pós-avaliação — convite de pedido, passa pelo gate do link.
        await enviarMensagem(phone, garantirLinkCardapioEmMensagens([`Ótimo! 😄\n\n${cats}`], "category")[0])
        const newSession = createInitialSession()
        await redis.set(`session:${phone}`, { ...newSession, customerName: undefined }, { ex: 1800 })
      } else {
        await enviarMensagem(phone, `Até a próxima! Foi um prazer te atender. 🍕😊`)
      }
      return NextResponse.json({ ok: true })
    }

    const sessionKey = `session:${phone}`;
    let currentSession = await redis.get<BotSession>(sessionKey);

    // Prioridade pós-pedido: se o cliente voltou a falar após finalizar um
    // pedido (step 'done'), marca a flag no Redis para o painel exibir "Atender".
    // Saudações NÃO marcam — elas já disparam nova sessão de retorno logo abaixo.
    // manual=true permanece exclusivo para atendimento humano ativo.
    if (deveMarcarPrioridadePosPedido(currentSession?.step)) {
      await redis.set(`postOrderPriority:${phone}`, true, { ex: 3600 });
    }

    // ── RETOMADA INTELIGENTE PÓS-HANDOFF (Guardião de Venda) ──────────────────
    // Só dispara após uma NOVA mensagem real da cliente (devolver para o bot é
    // silencioso). O Guardião lê as duas últimas mensagens relevantes e decide se
    // o fluxo rígido responde sozinho ou se a IA precisa reorganizar o contexto.
    const armadaRetomada = await redis.get<boolean>(`retomada:${phone}`);
    if (armadaRetomada === true) {
      await redis.del(`retomada:${phone}`);
      if (currentSession) {
        // Mensagem já registrada no início do fluxo; pega as 3 mais recentes e
        // descarta a primeira (atual) para obter as 2 ANTERIORES como contexto.
        const ultimas = (await ultimasMensagensRelevantes(phone, 3)).slice(1);
        const decisao = analisarConversaParaRetomada({
          session: currentSession,
          mensagemAtual: messageText,
          ultimasMensagens: ultimas,
          voltouDoHandoff: true,
        });
        const sessaoRetomada = decisao.session ?? currentSession;
        let mensagensRetomada = decisao.safeReply ? [decisao.safeReply] : [];
        if (decisao.shouldUseAI && decisao.promptContexto) {
          const respostaIA = await gerarRespostaGuardiao(decisao.promptContexto);
          if (respostaIA && validarRespostaIA(respostaIA, sessaoRetomada)) {
            mensagensRetomada = [respostaIA];
            if (decisao.path === "BECO" || decisao.path === "SAIDA") {
              await registrarCasoGuardiao({
                phone, path: decisao.path, session: sessaoRetomada,
                mensagemCliente: messageText, ultimas, respostaIA,
              });
            }
          }
        }
        await redis.set(sessionKey, sessaoRetomada, { ex: 1800 });
        if (mensagensRetomada.length > 0) {
          // Retomada pós-handoff gera texto fora do processMessage (IA/safeReply) —
          // passa pelo gate central do link do cardápio antes do envio.
          mensagensRetomada = garantirLinkCardapioEmMensagens(mensagensRetomada, sessaoRetomada.step);
          await enviarRespostas(phone, mensagensRetomada, config, sessaoRetomada.ritmoRapido);
        }
        return NextResponse.json({ ok: true });
      }
      // Sem sessão ativa (expirou) — segue o fluxo normal, que recria a sessão.
    }

    // Sem sessao ativa — inicia nova.
    //
    // Cada ramo abaixo faz um claim atômico (SET NX) da sessão em vez de um
    // redis.set direto: duas mensagens reais e distintas do cliente chegando
    // quase juntas (2 execuções concorrentes desta rota, nenhuma com sessão
    // ainda gravada) não podem mais as duas cair em "sem sessão" — só a
    // primeira a gravar (o "claim") manda a saudação/inicia o pedido; a outra
    // encontra a sessão recém-criada e segue o fluxo normal do resto da
    // função com o texto que ela realmente recebeu. Isso fechou o bug
    // relatado: "oii" seguido de perto por "boa noite" (que também é
    // reconhecida por eSaudacao) fazia as duas mensagens reenviarem a
    // saudação completa de boas-vindas.
    if (!currentSession) {
      if (eDespedida(messageText)) return NextResponse.json({ ok: true });

      const historico = await redis.get<ClienteHistorico>(`cliente:${phone}`);
      if (historico) {
        const sessaoRetorno = createReturningSession(historico);
        const claimouRetorno = await redis.set(sessionKey, sessaoRetorno, { ex: 1800, nx: true });
        if (!claimouRetorno) {
          currentSession = (await redis.get<BotSession>(sessionKey)) ?? sessaoRetorno;
        } else {
          currentSession = sessaoRetorno;
          await enviarMensagem(phone, montarSaudacaoRetorno(historico));
          return NextResponse.json({ ok: true });
        }
      } else {
        if (!estaAberto(config)) {
          await enviarMensagem(phone, mensagemFechado(config));
          return NextResponse.json({ ok: true });
        }
        if (eSaudacao(messageText)) {
          // Sessão já nasce direto no step final "category" — nunca fica
          // persistida como "welcome" enquanto as mensagens de boas-vindas
          // são enviadas (essa janela intermediária era a 2a causa da
          // duplicidade: uma leitura concorrente via processMessage caindo
          // no case "welcome" reenviava a saudação para qualquer texto).
          const sessaoInicial = { ...createInitialSession(), step: "category" as const };
          const claimouInicial = await redis.set(sessionKey, sessaoInicial, { ex: 1800, nx: true });
          if (!claimouInicial) {
            currentSession = (await redis.get<BotSession>(sessionKey)) ?? sessaoInicial;
          } else {
            currentSession = sessaoInicial;
            await enviarMensagem(phone, mensagemSaudacaoPadrao(config.nomePizzaria));
            await enviarMensagem(phone, `O que vai ser hoje? Temos coisa boa te esperando! 😋\n\n  1. Pizza\n  2. Lanches\n  3. Bebidas\n  4. Sucos e Vitaminas`);
            return NextResponse.json({ ok: true });
          }
        } else {
          // Nao e saudacao — cliente ja mandou o pedido direto. Cria sessao no step category e processa.
          const sessaoDireta = { step: "category" as const, cart: [], deliveryFee: 0, tentativasInvalidas: 0 };
          const claimouDireta = await redis.set(sessionKey, sessaoDireta, { ex: 1800, nx: true });
          currentSession = claimouDireta ? sessaoDireta : ((await redis.get<BotSession>(sessionKey)) ?? sessaoDireta);
        }
      }
    }

    // Cliente em aguardando_pix mandou texto (nao imagem) — lembra de enviar comprovante
    if (currentSession.step === "aguardando_pix") {
      const pixIniciadoEm = (currentSession as any).pixIniciadoEm || Date.now();
      const cobrancas = (currentSession as any).pixCobrancas || 0;

      // Fluxo opcional (Nivel 6.7B): cliente pediu explicitamente a chave Pix
      // manual em vez do QR/copia-e-cola dinamico. Puramente informativo —
      // nao confirma nada sozinho, so troca o payload pela chave estatica e
      // segue exigindo o comprovante (mesmo caminho manual ja validado).
      if (clientePediuChavePixManual(messageText)) {
        const mensagensChaveManual = montarMensagensChavePixManual(config);
        if (mensagensChaveManual) {
          for (const msg of mensagensChaveManual) await enviarMensagem(phone, msg);
          await redis.set(sessionKey, { ...currentSession, pixIniciadoEm }, { ex: 1800 });
          return NextResponse.json({ ok: true });
        }
      }

      await enviarMensagem(phone, `Para confirmar seu pedido, preciso do comprovante do Pix! 📄\n\nSó enviar a imagem ou PDF aqui no chat. 😊`);
      await redis.set(sessionKey, { ...currentSession, pixIniciadoEm, pixCobrancas: cobrancas + 1 }, { ex: 1800 });
      if (cobrancas >= 1) {
        // 2a cobrança — escalona para Kellyne
        await salvarEscalonamento(phone, currentSession!);
        await enviarMensagem(phone, `Nossa equipe vai te ajudar a finalizar o pedido! Um instante. 😊`);
      }
      return NextResponse.json({ ok: true });
    }

    // Sessao concluida — se mandar saudacao, inicia novo pedido como recorrente
    if (currentSession.step === "done" && eSaudacao(messageText)) {
      const historico = await redis.get<ClienteHistorico>(`cliente:${phone}`);
      if (historico) {
        const newSession = createReturningSession(historico);
        await redis.set(sessionKey, newSession, { ex: 1800 });
        await enviarMensagem(phone, montarSaudacaoRetorno(historico));
        return NextResponse.json({ ok: true });
      }
    }

    // Sessao ativa
    if (eDespedida(messageText) && currentSession.step !== "confirm") {
      await redis.del(sessionKey);
      await enviarMensagem(phone, `Ate mais! Volte sempre! 😊🍕`);
      return NextResponse.json({ ok: true });
    }

    if (!estaAberto(config) && currentSession.step === "welcome") {
      await redis.del(sessionKey);
      await enviarMensagem(phone, mensagemFechado(config));
      return NextResponse.json({ ok: true });
    }

    // Cancelamento pos-pedido
    if (querCancelar(messageText) && currentSession.step === "done" && (currentSession as any).pedidoId) {
      const pedidoId = (currentSession as any).pedidoId;
      const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
      const pedido = pedidos.find(p => p.id === pedidoId);
      if (!pedido) {
        await enviarMensagem(phone, "Nao encontrei nenhum pedido ativo para cancelar.");
        return NextResponse.json({ ok: true });
      }
      if (pedido.status === "novo") {
        await salvarCancelamentoSolicitado(phone, currentSession, pedidoId);
        await enviarMensagem(phone, `Entendido! Solicitei o cancelamento pra nossa equipe.`);
        return NextResponse.json({ ok: true });
      }
      if (pedido.status === "em_preparo") {
        await enviarMensagem(phone, `Seu pedido ja esta em preparo e nao da pra cancelar agora.`);
        return NextResponse.json({ ok: true });
      }
      await enviarMensagem(phone, `Seu pedido ja esta em andamento e nao da pra cancelar.`);
      return NextResponse.json({ ok: true });
    }

    // Revive conversa travada (step "escalado" ou "done" com manual lock expirado).
    // Usa detectarConversaMorta para manter a lógica centralizada no helper.
    // Cooldown de 10 min evita loop de revival em caso de bug.
    if (currentSession) {
      const cooldownKey = `revive_cooldown:${phone}`;
      const cooldownAtivo = await redis.get(cooldownKey);
      const resultadoReviver = detectarConversaMorta(currentSession, {
        emManual: false,
        botAtivo: true,
        aguardandoPix: false, // early return em "aguardando_pix" já garantiu que não chegamos aqui
        cooldownAtivo: !!cooldownAtivo,
      });
      if (resultadoReviver.deveReviver && resultadoReviver.novoStep) {
        currentSession = { ...currentSession, step: resultadoReviver.novoStep as BotStep, escalado: false, stepAnteriorEscalado: undefined };
        await redis.set(sessionKey, currentSession, { ex: 1800 });
        await redis.set(cooldownKey, 1, { ex: 600 });
      }
    }

    // Processa mensagem
    let mensagemProcessada = messageText;
    const resultTeste = processMessage(messageText, currentSession);
    const botConfuso = resultTeste.messages.some(m =>
      m.includes("nao entendi") || m.includes("nao achei") || m.includes("Ops") ||
      m.includes("Eita") || m.includes("Opa") || m.includes("nao peguei") ||
      m.includes("Hmm") || m.includes("nao tem isso")
    );
    // Gatilho estrutural: cliente já errou 2x seguidas no MESMO step antes desta mensagem.
    // Mais robusto que checar texto de erro — não depende das mensagens do bot, e pega
    // o caso de "comportamento fora do fluxo" mesmo quando a resposta do bot não citar "não entendi".
    const errouRepetido = (currentSession.step === resultTeste.session?.step) && (currentSession.tentativasInvalidas || 0) >= 1;
    const precisaIA = botConfuso || errouRepetido;
    if (precisaIA) {
      const opcoes = getOpcoesPorStep(currentSession.step);
      if (opcoes.length > 0) {
        const interpretado = await interpretarMensagem(messageText, currentSession.step, opcoes);
        if (interpretado) mensagemProcessada = interpretado;
      }
    }

    if (!currentSession) return NextResponse.json({ ok: true });

    // Se cliente esta escolhendo delivery, injeta historico para reusar endereco
    if (currentSession && currentSession.step === "delivery_type" && !(currentSession as any).historico) {
      const histSalvo = await redis.get<ClienteHistorico>(`cliente:${phone}`);
      if (histSalvo?.ultimoEndereco && histSalvo?.ultimoNeighborhood) {
        currentSession = { ...currentSession, historico: histSalvo } as any;
      }
    }

    const stepAnterior = currentSession!.step;
    const result = processMessage(mensagemProcessada, currentSession!);

    // Pix chegando em aguardando_pix — cobre tanto a tela de confirmacao (delivery/dine_in)
    // quanto o fluxo de retirada, que fecha o pedido direto sem passar por "confirm"
    // (finalizarPedidoPickup, em bot.ts). Antes do Nivel 6.7, esse segundo caminho nunca
    // chamava salvarPedido() aqui — o pedido só era criado (e a cobranca Mercado Pago
    // só era tentada) quando o comprovante chegava, e o cliente via nesse meio-tempo
    // só a chave Pix estatica. Detectar a TRANSICAO para aguardando_pix (em vez de
    // depender do step anterior ser "confirm") cobre os dois fluxos com o mesmo código.
    const entrouEmAguardandoPixAgora = result.session?.step === "aguardando_pix" && !(result.session as any).pedidoId;
    if (entrouEmAguardandoPixAgora) {
      // Usa result.session (pós-processMessage), não currentSession — no fluxo de
      // retirada o pagamento é escolhido e o pedido fecha no MESMO turno, então
      // paymentMethod/cart/troco só existem na sessão já processada.
      const { pedidoId, pixCliente } = await salvarPedido(result.session, phone, config);
      result.session = { ...result.session, pedidoId, pixIniciadoEm: Date.now(), pixCobrancas: 0 } as any;
      // Só substitui a mensagem quando a cobranca Mercado Pago foi criada de fato —
      // nunca troca o texto de fallback manual (que já orienta a enviar comprovante).
      // 3 mensagens separadas (Nível 6.7A): aviso + payload Pix isolado (fácil de
      // copiar) + instrução final — enviarRespostas já manda cada item do array
      // como uma mensagem WhatsApp distinta, em ordem.
      const mensagensPixDinamico = montarMensagensPixMercadoPagoWhatsApp(pixCliente);
      if (mensagensPixDinamico) result.messages = mensagensPixDinamico;
    }

    // Salva pedido nao-Pix na confirmacao — pedidos Pix ja foram salvos acima,
    // no momento em que entraram em aguardando_pix (delivery/dine_in ou retirada).
    if (currentSession!.step === "confirm" && ehConfirmacaoPedido(messageText) && !temPixNoPagamento(currentSession!.paymentMethod)) {
      const { pedidoId } = await salvarPedido(currentSession!, phone, config);
      result.session = { ...result.session, pedidoId } as any;
      if (config.limitePico > 0) {
        const pedidosAtivos = (await redis.get<Pedido[]>("pedidos") || []).filter(p => p.status === "em_preparo" && !p.escalonado).length;
        if (pedidosAtivos >= config.limitePico) {
          result.messages = result.messages.map(msg =>
            msg.includes("Pedido confirmado") ? msg + `\n\n🔥 *Estamos com bastante movimento agora!* Seu pedido pode demorar um pouquinho mais. Obrigado pela paciencia! 😊` : msg
          );
        }
      }
    }

    if (result.escalar) {
      await salvarEscalonamento(phone, currentSession!);
      // TTL de 7200s (2h) alinhado com a janela de abandono de atendimento humano.
      await redis.set(`manual:${phone}`, true, { ex: 7200 });
      result.session = { ...result.session, clientePerdidoCount: 0 };
    } else {
      // Handoff automático por confusão consecutiva — 3 níveis:
      //   none  : resposta válida (zera) ou 1ª confusão. Bot conduz, sem alerta.
      //   alert : 2ª confusão. Painel destaca mas bot ainda conduz.
      //   urgent: 3ª confusão. Bot para; envia mensagem à cliente; painel exibe "Assumir agora".
      // Conta como dificuldade: fallback seco OU ausência de avanço real (step, cart,
      // campos operacionais) — captura repetições de orientação sem dado novo (ex: "Jjj"
      // em 'returning'). Sessão já em 'escalado' nunca acumula novo contador.
      const ehFallbackSeco = pareceFallbackSeco(result.messages);
      const semAvancoProblematico =
        currentSession!.step !== 'escalado' &&
        !houveAvancoReal(currentSession!, result.session);
      const perdidoEsteTurno = ehFallbackSeco || semAvancoProblematico;
      const { novoContador, nivel } = avaliarHandoffPorConfusao(
        currentSession!.clientePerdidoCount || 0,
        perdidoEsteTurno,
      );
      if (nivel === 'urgent') {
        result.messages = ['Vou chamar alguém da equipe para te ajudar melhor, tá bom? Um instante que já vamos continuar seu atendimento.'];
        result.session = { ...result.session, step: 'escalado', clientePerdidoCount: 0 };
        await redis.set(`postOrderPriority:${phone}`, true, { ex: 3600 });
        await redis.del(`conversationAlert:${phone}`);
      } else if (nivel === 'alert') {
        result.session = { ...result.session, clientePerdidoCount: novoContador };
        await redis.set(`conversationAlert:${phone}`, true, { ex: 3600 });
      } else {
        result.session = { ...result.session, clientePerdidoCount: novoContador };
        if (!perdidoEsteTurno) {
          // Resposta válida com avanço real: limpa o alerta de dificuldade anterior.
          await redis.del(`conversationAlert:${phone}`);
        }
      }
    }

    // Atualiza o rascunho vivo (leitura da atendente). Aditivo: preserva todos os
    // campos oficiais da sessão, só preenche result.session.rascunhoAtendimento.
    try {
      const historicoNormal = await ultimasMensagensRelevantes(phone, 5);
      const ultimaAtendenteNormal = [...historicoNormal].reverse().find(m => m.autor === "atendente");
      const contextoNormal = ultimaAtendenteNormal ? { ultimaMensagemAtendente: ultimaAtendenteNormal.texto } : undefined;
      result.session = atualizarRascunhoAtendimentoTempoReal(result.session, messageText, contextoNormal);
    } catch {}

    await redis.set(sessionKey, result.session, { ex: 1800 });

    // Memória de Conversão: se havia um caso PENDENTE (retomada da mensagem
    // anterior), avalia o resultado com base nesta interação e arquiva o caso.
    // Best-effort — não chama IA e não altera a sessão.
    try {
      const pendente = await consumirCasoPendente(phone);
      if (pendente) {
        const resultado = avaliarResultadoDaRetomada({
          pedidoFechado: result.session.step === "done" || result.session.step === "aguardando_pix",
          precisouHumano: !!result.escalar,
          abandonou: eDespedida(messageText) || querCancelar(messageText),
          continuou: stepAnterior !== result.session.step,
          stepAntes: pendente.step,
          stepDepois: result.session.step,
        });
        await salvarCasoResolvido({ ...pendente, resultado });
      }
    } catch {}

    // Envia imagem do cardapio
    const stepAtual = result.session.step;
    const stepsComImagem = ["size", "flavor", "lanche_escolha", "bebida_escolha", "suco_escolha"];
    const entrouNaCategoria = !stepsComImagem.includes(stepAnterior) && stepsComImagem.includes(stepAtual);
    if (entrouNaCategoria) {
      try {
        const imagens = await redis.get<{pizza?: string, lanche?: string, bebida?: string, suco?: string, ativo?: boolean}>("cardapio:imagens");
        if (imagens?.ativo !== false) {
          const categoria = result.session.currentCategory ?? "";
          const imagemUrl = imagens?.[categoria as keyof typeof imagens] as string | undefined;
          if (imagemUrl && typeof imagemUrl === "string") {
            await enviarImagem(phone, imagemUrl);
            await new Promise(resolve => setTimeout(resolve, 800));
          }
        }
      } catch {}
    }

    // ── FALLBACK INTELIGENTE UNIVERSAL ────────────────────────────────────────
    // Nunca envia resposta "seca" (Ops/não entendi/opção inválida). Quando o fluxo
    // rígido se perde e não houve escalonamento, troca o texto por uma resposta
    // natural (IA validada) ou pelo fallback determinístico humanizado. Substitui
    // APENAS o texto de saída — nunca altera sessão, carrinho, taxa ou pagamento.
    // Captura o estado ANTES da resolução — usado pelo MCP observer abaixo.
    const mcpFoiFallbackSeco = !result.escalar && pareceFallbackSeco(result.messages);
    if (!result.escalar && pareceFallbackSeco(result.messages)) {
      try {
        const ultimasCtx = await ultimasMensagensRelevantes(phone, 2);
        const fb = await resolverFallbackInteligente({
          mensagemAtual: messageText,
          session: result.session,
          mensagensFallback: result.messages,
          ultimasMensagens: ultimasCtx,
          jaEscalou: result.escalar,
        });
        if (fb.intervencao !== "nenhuma") {
          result.messages = fb.messages;
          // Memória: registra caso pendente quando a IA reorganizou (BECO/SAIDA).
          if (fb.usouIA && (fb.path === "BECO" || fb.path === "SAIDA")) {
            await registrarCasoGuardiao({
              phone, path: fb.path, session: result.session,
              mensagemCliente: messageText, ultimas: ultimasCtx, respostaIA: fb.messages[0],
            });
          }
        }
      } catch {}
    }

    await enviarRespostas(phone, result.messages, config, result.session.ritmoRapido);

    // ── MCP FASE 1: TELEMETRIA OBSERVADORA ────────────────────────────────────
    // Executa APÓS a resposta ao cliente usando after() — zero impacto de latência.
    // MCP_MODE=off (padrão) não executa nenhum código abaixo.
    // Qualquer falha é capturada e logada sem propagar para o fluxo principal.
    if (process.env.MCP_MODE === 'observador' && msgId) {
      const mcpEvento = {
        phoneHash: anonimizarConversaId(phone),
        msgId,
        stepAntes:        currentSession?.step ?? 'desconhecido',
        stepDepois:       result.session.step,
        houveMudancaStep: currentSession?.step !== result.session.step,
        cartLength:       result.session.cart.length,
        deliveryType:     result.session.deliveryType,
        precisouIA:       precisaIA,
        escalou:          !!result.escalar,
        foiFallbackSeco:  mcpFoiFallbackSeco,
        timestamp:        Date.now(),
      };
      const mcpTask = async () => {
        try {
          const { enfileirarEventoMcp } = await import('@/mcp/eventTap');
          await enfileirarEventoMcp(mcpEvento);
        } catch (err) {
          const { logErroMcp } = await import('@/mcp/logger/mcpLogger');
          logErroMcp('enfileirarEventoMcp', err).catch(() => {});
        }
      };
      try {
        after(mcpTask);
      } catch {
        // after() indisponível neste contexto (risco controlado: ~5ms de latência)
        mcpTask().catch(() => {});
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    return NextResponse.json({ ok: true });

  } catch (error) {
    console.error("Webhook error:", error);
    await log('erro', 'Erro no webhook WhatsApp', String(error));
    // Reverte o claim de idempotência (ver comentário em `msg_processed:`
    // acima): sem isso, esta mensagem ficaria marcada como "processada" por
    // 24h mesmo sem ter recebido resposta nenhuma. Best-effort — se o próprio
    // Redis estiver indisponível aqui, o TTL de 24h ainda expira sozinho.
    if (msgId) {
      await redis.del(`msg_processed:${msgId}`).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }
}
