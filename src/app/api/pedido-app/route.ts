import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { redis } from "@/lib/redis";
import { proximoNumeroPedido } from "@/lib/numeracao";
import { getMENUDinamico } from "@/lib/menu";
import { computeTaxaApp, buildEnderecoApp } from "@/lib/pedidoAppLogic";
import { criarPixMetadata, prepararPixProviderMercadoPago, serializarPixCliente } from "@/lib/pix";
import { PROMOS_KEY, catalogoDoMenu, dentroDaJanela, precoFinalPromocao, promocaoIndisponivel, type Promocao } from "@/lib/promocoes";
import { validarTokenCardapio } from "@/lib/cardapioToken";
import { temDinheiroNoPagamento, valorDinheiroEsperado } from "@/lib/bot";
import { verificarTokenCliente, CLIENTE_COOKIE } from "@/lib/clienteAuth";
import { buscarClientePorId, sanitizeTelefoneCliente } from "@/lib/clientes";
import { calcularPontosElegiveisPedido, registrarMovimentoPontosIdempotente, construirEventoIdPontos, derivarClienteIdPorTelefone, obterReservasResgatePontos, confirmarResgatePontos } from "@/lib/fidelidade";
import { type ItemApp, type MenuPedidoApp, formatItem, officialUnitPrice, makePromoUnitPrice, contarPizzasPagasParaFidelidade } from "@/lib/pedidoAppItens";
import { prepararResgateParaPedido, confirmarReservaNoPedido, liberarVinculoRecompensaPedidoNaoCriado, type EscolhaRecompensaJornada } from "@/lib/jornadaChef";
import { survivalModeEnabled } from "@/survival/flags";
import { sanitizeClientRequestId } from "@/survival/clientRequestId";
import {
  chaveIdempotenciaPedido,
  ehMarcadorProcessando,
  MARCADOR_PEDIDO_PROCESSANDO,
  PEDIDO_IDEMPOTENCIA_POLL_INTERVALO_MS,
  PEDIDO_IDEMPOTENCIA_POLL_TENTATIVAS,
  PEDIDO_IDEMPOTENCIA_TTL_SEGUNDOS,
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

function criarTokenPublicoAcompanhamento(): string {
  return randomUUID().replace(/-/g, "");
}

async function getConfigPix(): Promise<ConfigPizzariaPix> {
  return (await redis.get<ConfigPizzariaPix>("config:pizzaria")) || {};
}

// Espera limitada (~1.8s no pior caso) por uma requisição concorrente com o
// MESMO clientRequestId terminar de criar o pedido. Nunca cria nada aqui —
// só observa a chave até deixar de ser o marcador "processando" ou esgotar
// as tentativas. Bem dentro do maxDuration=20s da rota.
async function aguardarResultadoConcorrente(claimKey: string): Promise<Record<string, unknown> | null> {
  for (let tentativa = 0; tentativa < PEDIDO_IDEMPOTENCIA_POLL_TENTATIVAS; tentativa++) {
    await new Promise((resolve) => setTimeout(resolve, PEDIDO_IDEMPOTENCIA_POLL_INTERVALO_MS));
    const atual = await redis.get<Record<string, unknown>>(claimKey).catch(() => null);
    if (atual && !ehMarcadorProcessando(atual)) return atual;
  }
  return null;
}

export async function POST(req: NextRequest) {
  // Declarados fora do try/catch/finally para ficarem visíveis no `finally`
  // (limpeza da reivindicação de idempotência em caso de falha/validação).
  let clientRequestId: string | null = null;
  let idempotenciaReivindicada = false;
  let pedidoCriado = false;
  let idempotenciaFinalizada = false;

  try {
    const body = (await req.json()) as PedidoApp;

    // Modo Sobrevivência (Etapa 1) — idempotência de criação de pedido.
    // Desligada por padrão (SURVIVAL_MODE_ENABLED=false): zero mudança de
    // comportamento, zero comando Redis extra. Ligada, um clientRequestId
    // já visto devolve o MESMO resultado da primeira criação em vez de criar
    // um segundo pedido — cobre tanto o retry após timeout de rede quanto
    // duas requisições concorrentes com o mesmo identificador (double-tap,
    // duas abas). Ver docs/architecture/MODO_SOBREVIVENCIA_1_0.md.
    clientRequestId = survivalModeEnabled() ? sanitizeClientRequestId(body.clientRequestId) : null;
    if (clientRequestId) {
      const claimKey = chaveIdempotenciaPedido(clientRequestId);
      try {
        // SET NX: só uma requisição consegue gravar o marcador "processando"
        // para esta chave — a outra vê o SET falhar (chave já existe) e
        // nunca chega a criar um segundo pedido. Mesmo padrão de lock já
        // usado em src/lib/mercadoPagoReconciliacao.ts.
        const reivindicado = await redis.set(claimKey, MARCADOR_PEDIDO_PROCESSANDO, {
          nx: true,
          ex: PEDIDO_IDEMPOTENCIA_TTL_SEGUNDOS,
        });
        if (reivindicado) {
          idempotenciaReivindicada = true;
        } else {
          const existente = await redis.get<Record<string, unknown>>(claimKey);
          if (existente && !ehMarcadorProcessando(existente)) {
            // Resultado final de uma criação anterior (mesma tentativa,
            // retry após timeout) — devolve o MESMO pedido, nunca duplica.
            return NextResponse.json(existente);
          }
          // existente === marcador "processando" (ou expirou entre o SET NX
          // falhar e este GET — janela mínima, tratada como concorrência):
          // outra requisição com o mesmo clientRequestId está criando o
          // pedido agora. Espera um resultado em vez de criar um segundo.
          const resolvidoPorConcorrencia = await aguardarResultadoConcorrente(claimKey);
          if (resolvidoPorConcorrencia) {
            return NextResponse.json(resolvidoPorConcorrencia);
          }
          return NextResponse.json(
            { ok: false, error: "Este pedido já está sendo processado. Aguarde alguns segundos e verifique antes de tentar de novo." },
            { status: 409 }
          );
        }
      } catch (err) {
        // Redis indisponível bem no momento da checagem de idempotência —
        // NUNCA bloqueia a criação do pedido por causa disso: prossegue
        // exatamente como se a flag estivesse desligada para esta tentativa
        // (idempotenciaReivindicada permanece false, então nada mais deste
        // mecanismo roda para esta requisição).
        console.error("[ChefeBot] Redis indisponível para idempotência de pedido (pedido segue sem essa proteção nesta tentativa):", err);
      }
    }

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
    // best-effort como o crédito de pontos).
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
      pedidoCriado = true;
    } catch (err) {
      // O pedido não chegou a ser persistido — libera só o vínculo desta
      // recompensa com este pedidoId (nunca reescreve a lista inteira de
      // "pedidos" como compensação, rule 6).
      if (recompensaJornadaId && clienteIdJornada) {
        await liberarVinculoRecompensaPedidoNaoCriado(clienteIdJornada, recompensaJornadaId, pedidoId).catch(() => {});
      }
      console.error("[ChefeBot] Erro ao persistir pedido do site:", err);
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
    }

    // Confirma o resgate (Etapa 5): se o debito nao persistir, o pedido com
    // desconto e revertido e a API nao devolve sucesso com estado inconsistente.
    if (resgateAplicado) {
      try {
        await confirmarResgatePontos(resgateAplicado.clienteId, resgateAplicado.resgateId, pedidoId);
      } catch (err) {
        const pedidosAtuais = (await redis.get<unknown[]>("pedidos")) || [];
        await redis.set(
          "pedidos",
          pedidosAtuais.filter((pedido) => (pedido as { id?: unknown } | null)?.id !== pedidoId)
        );
        console.error("[ChefeBot] Erro ao confirmar resgate de fidelidade; pedido com desconto revertido:", err);
        return NextResponse.json({ ok: false, error: "Nao foi possivel confirmar o resgate. Tente novamente." }, { status: 409 });
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

    const configPix = await getConfigPix();
    const pixCliente = serializarPixCliente(pix, configPix);
    const resposta = { ok: true, pedidoId, numero: numeroPedido, total, statusToken, ...(pixCliente ? { pix: pixCliente } : {}) };

    // Substitui o marcador "processando" pelo resultado final (best-effort:
    // o pedido já foi persistido antes deste ponto — uma falha aqui nunca
    // desfaz nem impede a resposta de sucesso ao cliente). Se esta gravação
    // falhar, o `finally` abaixo NUNCA apaga a reivindicação (só faria isso
    // se o pedido não tivesse sido criado) — o marcador "processando" fica
    // até o TTL expirar, então o pior caso de um retry nesse intervalo é um
    // 409 "aguarde e verifique", nunca um segundo pedido.
    if (idempotenciaReivindicada && clientRequestId) {
      await redis
        .set(chaveIdempotenciaPedido(clientRequestId), resposta, { ex: PEDIDO_IDEMPOTENCIA_TTL_SEGUNDOS })
        .then(() => { idempotenciaFinalizada = true; })
        .catch((err) => console.error("[ChefeBot] Falha ao gravar idempotência de pedido (ignorada):", err));
    }

    return NextResponse.json(resposta);
  } catch (error) {
    console.error("Erro ao salvar pedido do site:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  } finally {
    // Libera a reivindicação SOMENTE se nenhum pedido chegou a ser criado
    // (ex.: falhou em alguma validação de negócio depois de reivindicar a
    // chave) — nesse caso o clientRequestId pode e deve ser reutilizado num
    // retry legítimo. Se o pedido FOI criado, nunca apagamos aqui: apagar
    // reabriria a janela para um retry duplicar um pedido que já existe.
    if (clientRequestId && idempotenciaReivindicada && !idempotenciaFinalizada && !pedidoCriado) {
      await redis.del(chaveIdempotenciaPedido(clientRequestId)).catch(() => {});
    }
  }
}
