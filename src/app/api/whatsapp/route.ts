import { NextRequest, NextResponse } from "next/server";
import { processMessage, createInitialSession, createReturningSession, BotSession, ClienteHistorico } from "@/lib/bot";
import { redis } from "@/lib/redis";
import { interpretarMensagem } from "@/lib/claude";
import { log } from "@/lib/logger";
import { analisarComprovantePix } from "@/lib/analisarComprovante";

type Pedido = {
  id: string;
  cliente: string;
  telefone: string;
  itens: string[];
  total: number;
  status: "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado";
  horario: string;
  endereco: string;
  escalonado?: boolean;
  cancelamentoSolicitado?: boolean;
  observacao?: string;
  pixConfirmado?: boolean;
};

type ConfigPizzaria = {
  nomePizzaria: string;
  horaAbertura: number;
  horaFechamento: number;
  chavePix: string;
  nomeTitularPix: string;
  limitePico: number;
};

const CONFIG_PADRAO: ConfigPizzaria = {
  nomePizzaria: "Chefe da Pizza",
  horaAbertura: 18,
  horaFechamento: 23,
  chavePix: "",
  nomeTitularPix: "",
  limitePico: 0,
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
  const palavras = ["nao obrigado", "nao preciso", "pode ser", "ta bom", "tudo bem", "obrigado", "valeu", "ok", "beleza", "nao precisa", "so isso", "era isso", "resolvido", "sim obrigado", "nao mais", "chega", "tranquilo", "por enquanto nao", "nao obg", "obg", "vlw", "tmj", "ajudou", "ajudou muito", "era isso mesmo", "ja ta bom", "pode fechar", "encerrar", "nao quero mais nada", "so queria isso", "era so isso", "foi isso", "e isso", "isso mesmo", "perfeito obrigado", "muito obrigado", "mto obg", "mt obg", "grato", "agradeco", "esta tudo certo", "ta tudo certo", "tudo certo", "tudo ok", "ficou otimo", "ficou bom", "muito bom", "perfeito", "esta otimo", "ta otimo", "otimo obg", "otimo valeu"];
  return palavras.some(p => n.includes(p));
}

function eDespedida(texto: string): boolean {
  const n = normalizar(texto);
  const palavras = ["tchau", "flw", "ate mais", "ate logo", "fui", "adeus", "xau", "abraco", "bjs", "beijinho", "tchauzinho", "tchauuu", "xauzinho", "ta bom obrigado", "valeu obrigado", "ok obrigado", "nao obrigado", "nao, obrigado", "nao precisa obrigado", "ta otimo", "ok valeu", "beleza obrigado", "obrigado tchau", "obrigado ate mais", "valeu tchau", "tudo bem obrigado", "ja ta bom", "nao obg", "obg tchau", "vlw tchau", "tmj tchau", "falou", "flw obg", "obg flw", "ate", "ate mais nao", "ajudou muito obg", "ajudou obg", "era isso obg", "foi otimo", "adorei", "perfeito tchau", "esta tudo certo", "ta tudo certo", "tudo certo obg", "tudo certo valeu", "esta tudo bem", "ta tudo bem"];
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

async function salvarPedido(session: BotSession, phone: string, config: ConfigPizzaria): Promise<string> {
  const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
  const itens = session.cart.map((item) => {
    const border = item.border && item.border !== "Sem borda" ? ` + ${item.border}` : "";
    const size = item.size ? ` ${item.size}` : "";
    const flavor = item.flavor ? ` ${item.flavor}` : "";
    return `${item.name}${size}${flavor}${border}`;
  });
  const total = session.cart.reduce((sum, item) => sum + item.price, 0) + session.deliveryFee;
  const endereco = session.deliveryType === "delivery" ? `${session.address} - ${session.neighborhood}` : "Retirada na loja";
  const pedidoId = Date.now().toString();
  const novoPedido = {
    id: pedidoId,
    cliente: session.customerName || phone,
    telefone: phone,
    itens,
    total,
    status: "novo" as const,
    horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    endereco,
    data: new Date().toLocaleDateString("pt-BR"),
    ...(session.observacao ? { observacao: session.observacao } : {}),
  };
  await redis.set("pedidos", [...pedidos, novoPedido]);
  const historico: ClienteHistorico = { nome: session.customerName || phone, ultimoPedido: itens, ultimoTotal: total };
  await redis.set(`cliente:${phone}`, historico, { ex: 30 * 24 * 60 * 60 });
  return pedidoId;
}

async function salvarEscalonamento(phone: string, session: BotSession) {
  const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
  const jaExisteAberto = pedidos.some((p) => p.telefone === phone && p.escalonado === true && p.status === "novo");
  if (jaExisteAberto) return;
  const novoPedido: Pedido = {
    id: Date.now().toString(),
    cliente: session.customerName || phone,
    telefone: phone,
    itens: ["Cliente precisa de atendimento humano"],
    total: 0,
    status: "novo",
    horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    endereco: "-",
    escalonado: true,
  };
  await redis.set("pedidos", [...pedidos, novoPedido]);
}

async function salvarCancelamentoSolicitado(phone: string, session: BotSession, pedidoId: string) {
  const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
  const index = pedidos.findIndex(p => p.id === pedidoId);
  if (index === -1) return;
  pedidos[index] = { ...pedidos[index], cancelamentoSolicitado: true };
  await redis.set("pedidos", pedidos);
}

async function fecharEscalonamento(phone: string) {
  const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
  const atualizados = pedidos.map(p =>
    p.telefone === phone && p.escalonado === true && p.status === "novo"
      ? { ...p, status: "entregue" as const, escalonado: false }
      : p
  );
  await redis.set("pedidos", atualizados);
}

async function enviarMensagem(phone: string, message: string) {
  const url = `https://${process.env.EVOLUTION_API_URL}/message/sendText/chefe`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY! },
    body: JSON.stringify({ number: phone, text: message }),
  });
}

async function enviarImagem(phone: string, imageUrl: string) {
  try {
    const url = `https://${process.env.EVOLUTION_API_URL}/message/sendMedia/chefe`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY! },
      body: JSON.stringify({ number: phone, mediatype: "image", media: imageUrl, caption: "" }),
    });
  } catch (err) {
    console.error("[ChefeBot] Erro ao enviar imagem:", err);
  }
}

async function processarComprovante(phone: string, data: any, config: ConfigPizzaria, isImagem: boolean) {
  try {
    const pedidos = await redis.get<Pedido[]>("pedidos") || [];
    const pedidoAtivo = pedidos
      .filter(p => p.telefone === phone && p.status === "novo" && !p.escalonado)
      .sort((a, b) => b.id.localeCompare(a.id))[0];

    if (!pedidoAtivo) return;

    const sessionKey = `session:${phone}`;
    const session = await redis.get<BotSession>(sessionKey);
    const isPix = session?.paymentMethod === "Pix";
    if (!isPix) return;

    await enviarMensagem(phone, `Comprovante recebido! 🔍 Verificando o pagamento...`);

    let imagemBase64 = "";
    let mediaType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" = isImagem ? "image/jpeg" : "application/pdf";

    try {
      const downloadUrl = `https://${process.env.EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/chefe`;
      const downloadRes = await fetch(downloadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY! },
        body: JSON.stringify({ message: data.message }),
      });
      if (downloadRes.ok) {
        const downloadData = await downloadRes.json();
        imagemBase64 = downloadData.base64 || "";
        if (downloadData.mimetype) mediaType = downloadData.mimetype;
      }
    } catch (err) {
      await log("aviso", "Erro ao baixar comprovante", String(err));
    }

    if (!imagemBase64) {
      await enviarMensagem(phone, `Comprovante recebido! 📄 Nossa equipe vai verificar em instantes. ✅`);
      await salvarEscalonamento(phone, session || { step: "done", cart: [], deliveryFee: 0, customerName: pedidoAtivo.cliente });
      return;
    }

    const resultado = await analisarComprovantePix(
      imagemBase64,
      mediaType as any,
      pedidoAtivo.total,
      config.chavePix,
      config.nomeTitularPix || config.nomePizzaria
    );

    if (resultado.valido) {
      const pedidosAtualizados = pedidos.map(p =>
        p.id === pedidoAtivo.id ? { ...p, pixConfirmado: true } : p
      );
      await redis.set("pedidos", pedidosAtualizados);
      const firstName = pedidoAtivo.cliente.split(" ")[0];
      await enviarMensagem(phone, `Pagamento confirmado! ✅🎉\n\nObrigado, *${firstName}*! Seu pedido ja foi enviado para a cozinha. Aguarda que vem ai! 🍕`);
      await log("info", `Pix confirmado automaticamente para ${firstName}`, `Valor: R$ ${resultado.valorEncontrado}`);
    } else {
      await enviarMensagem(phone, `Comprovante recebido! 📄 Nossa equipe vai verificar o pagamento manualmente. Em instantes confirmamos! 😊`);
      await salvarEscalonamento(phone, session || { step: "done", cart: [], deliveryFee: 0, customerName: pedidoAtivo.cliente });
      await log("aviso", `Comprovante Pix nao validado automaticamente`, `Phone: ${phone}, Valor esperado: R$ ${pedidoAtivo.total}`);
    }
  } catch (err) {
    await log("erro", "Erro ao processar comprovante", String(err));
    await enviarMensagem(phone, `Comprovante recebido! 📄 Nossa equipe vai verificar em instantes. ✅`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.event !== "messages.upsert") return NextResponse.json({ ok: true });
    const data = body.data;
    if (data?.key?.fromMe) return NextResponse.json({ ok: true });
    const phone = data?.key?.remoteJid?.replace("@s.whatsapp.net", "");
    if (!phone) return NextResponse.json({ ok: true });

    const messageText =
      data?.message?.conversation ||
      data?.message?.extendedTextMessage?.text ||
      "";

    const config = await getConfig();

    // Detecta imagem ou PDF (comprovante Pix)
    const isImagem = !!data?.message?.imageMessage;
    const isPDF = !!data?.message?.documentMessage &&
      (data?.message?.documentMessage?.mimetype === "application/pdf" ||
       data?.message?.documentMessage?.fileName?.endsWith(".pdf"));

    if (isImagem || isPDF) {
      await processarComprovante(phone, data, config, isImagem);
      return NextResponse.json({ ok: true });
    }

    if (!messageText) return NextResponse.json({ ok: true });

    const botAtivo = await redis.get<boolean>("bot_ativo");
    if (botAtivo === false) return NextResponse.json({ ok: true });

    const emManual = await redis.get<boolean>(`manual:${phone}`);
    if (emManual === true) return NextResponse.json({ ok: true });

    const spamKey = `spam:${phone}`;
    const spamCount = await redis.get<number>(spamKey) || 0;
    if (spamCount >= 3) return NextResponse.json({ ok: true });
    await redis.set(spamKey, spamCount + 1, { ex: 1 });

    const resolvendo = await redis.get<boolean>(`resolvendo:${phone}`);
    if (resolvendo === true) {
      if (resolvido(messageText) || eDespedida(messageText)) {
        await redis.del(`resolvendo:${phone}`);
        await redis.del(`manual:${phone}`);
        await redis.del(`session:${phone}`);
        await fecharEscalonamento(phone);
        await enviarMensagem(phone, `Fico feliz em ter ajudado! 😊\n\nQualquer coisa e so chamar. Estamos sempre aqui! 🍕`);
      } else {
        await redis.del(`resolvendo:${phone}`);
        await redis.del(`manual:${phone}`);
        await redis.del(`session:${phone}`);
        await fecharEscalonamento(phone);
        const historico = await redis.get<ClienteHistorico>(`cliente:${phone}`);
        let novaSession: BotSession;
        if (historico) {
          novaSession = createReturningSession(historico);
          const firstName = historico.nome.split(" ")[0];
          const ultimoPedido = historico.ultimoPedido.join(", ");
          await enviarMensagem(phone, `Ei *${firstName}*! 😊 Da ultima vez voce pediu *${ultimoPedido}* - vai querer repetir ou montar um novo?\n\n  1. Repetir o mesmo\n  2. Quero outra coisa`);
        } else {
          novaSession = createInitialSession();
          await enviarMensagem(phone, `Oi! Bem-vindo a *Chefe da Pizza*! 👋\n\nMe fala seu nome pra gente comecar?`);
        }
        await redis.set(`session:${phone}`, novaSession, { ex: 1800 });
      }
      return NextResponse.json({ ok: true });
    }

    const aguardandoAvaliacao = await redis.get<boolean>(`avaliacao:${phone}`);
    if (aguardandoAvaliacao === true) {
      const nota = parseInt(messageText.trim());
      if (nota >= 1 && nota <= 5) {
        await redis.del(`avaliacao:${phone}`);
        const avaliacoes = await redis.get<Array<{phone: string, nota: number, data: string}>>('avaliacoes') || [];
        avaliacoes.push({ phone, nota, data: new Date().toISOString() });
        await redis.set('avaliacoes', avaliacoes);
        const mensagens = [
          `Obrigado pela avaliacao, *${nota}/5*! 😊\n\nSeu feedback e muito importante pra gente. Volte sempre! 🍕`,
          `Que bom saber! Obrigado por avaliar, *${nota}/5*! 🙏\n\nTe esperamos na proxima! 🍕`,
          `Valeu pelo feedback! *${nota}/5* anotado. 😊\n\nAte a proxima! 🍕`,
        ];
        await enviarMensagem(phone, mensagens[Math.floor(Math.random() * mensagens.length)]);
        return NextResponse.json({ ok: true });
      } else {
        await redis.del(`avaliacao:${phone}`);
      }
    }

    const sessionKey = `session:${phone}`;
    const savedSession = await redis.get<BotSession>(sessionKey);

    if (eSaudacao(messageText) && !savedSession) {
      const historico = await redis.get<ClienteHistorico>(`cliente:${phone}`);
      if (historico) {
        const firstName = historico.nome.split(" ")[0];
        const ultimoPedido = historico.ultimoPedido.join(", ");
        const currentSession = createReturningSession(historico);
        await enviarMensagem(phone, `Ei *${firstName}*! 😊 Da ultima vez voce pediu *${ultimoPedido}* - vai querer repetir ou montar um novo?\n\n  1. Repetir o mesmo\n  2. Quero outra coisa`);
        await redis.set(sessionKey, currentSession, { ex: 1800 });
        return NextResponse.json({ ok: true });
      } else {
        const currentSession = createInitialSession();
        await enviarMensagem(phone, `Ola! Seja bem-vindo a *Chefe da Pizza*! 🍕\n\nPra comecar, me fala seu nome?`);
        await redis.set(sessionKey, currentSession, { ex: 1800 });
        return NextResponse.json({ ok: true });
      }
    }

    if (eDespedida(messageText) && savedSession) {
      await redis.del(sessionKey);
      await enviarMensagem(phone, `Ate mais! Volte sempre! 😊🍕`);
      return NextResponse.json({ ok: true });
    }

    if (!estaAberto(config)) {
      await redis.del(sessionKey);
      await enviarMensagem(phone, mensagemFechado(config));
      return NextResponse.json({ ok: true });
    }

    let currentSession: BotSession;
    if (!savedSession) {
      const historico = await redis.get<ClienteHistorico>(`cliente:${phone}`);
      if (historico) {
        const firstName = historico.nome.split(" ")[0];
        const ultimoPedido = historico.ultimoPedido.join(", ");
        currentSession = createReturningSession(historico);
        await enviarMensagem(phone, `Ei *${firstName}*! 😊 Da ultima vez voce pediu *${ultimoPedido}* - vai querer repetir ou montar um novo?\n\n  1. Repetir o mesmo\n  2. Quero outra coisa`);
        await redis.set(sessionKey, currentSession, { ex: 1800 });
        return NextResponse.json({ ok: true });
      } else {
        currentSession = createInitialSession();
      }
    } else {
      currentSession = savedSession;
    }

    if (querCancelar(messageText) && currentSession.step === "done" && (currentSession as any).pedidoId) {
      const pedidoId = (currentSession as any).pedidoId;
      const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
      const pedido = pedidos.find(p => p.id === pedidoId);
      if (!pedido) {
        await enviarMensagem(phone, "Nao encontrei nenhum pedido ativo para cancelar. Se precisar de ajuda, e so chamar!");
        return NextResponse.json({ ok: true });
      }
      if (pedido.status === "novo") {
        await salvarCancelamentoSolicitado(phone, currentSession, pedidoId);
        await enviarMensagem(phone, `Entendido! Solicitei o cancelamento pra nossa equipe. Assim que confirmado voce recebe a mensagem aqui.`);
        return NextResponse.json({ ok: true });
      }
      if (pedido.status === "em_preparo") {
        await enviarMensagem(phone, `Que pena! Seu pedido ja esta em preparo e nao da pra cancelar agora.`);
        return NextResponse.json({ ok: true });
      }
      await enviarMensagem(phone, `Seu pedido ja esta em andamento e nao da pra cancelar. Qualquer duvida e so chamar!`);
      return NextResponse.json({ ok: true });
    }

    let mensagemProcessada = messageText;
    const resultTeste = processMessage(messageText, currentSession);
    const botConfuso = resultTeste.messages.some(m =>
      m.includes("nao entendi") || m.includes("nao achei") || m.includes("Ops") ||
      m.includes("Eita") || m.includes("Opa") || m.includes("nao peguei") ||
      m.includes("Hmm") || m.includes("nao tem isso")
    );

    if (botConfuso) {
      const opcoes = getOpcoesPorStep(currentSession.step);
      if (opcoes.length > 0) {
        const interpretado = await interpretarMensagem(messageText, currentSession.step, opcoes);
        if (interpretado) mensagemProcessada = interpretado;
      }
    }

    const stepAnterior = currentSession.step;
    const result = processMessage(mensagemProcessada, currentSession);

    if (currentSession.step === "confirm" &&
      (messageText.trim() === "1" || messageText.trim().toLowerCase() === "sim")) {
      const pedidoId = await salvarPedido(currentSession, phone, config);
      result.session = { ...result.session, pedidoId } as any;

      if (config.limitePico > 0) {
        const pedidosAtivos = (await redis.get<Pedido[]>("pedidos") || [])
          .filter(p => p.status === "em_preparo" && !p.escalonado).length;
        if (pedidosAtivos >= config.limitePico) {
          result.messages = result.messages.map(msg =>
            msg.includes("Pedido confirmado") ?
              msg + `\n\n🔥 *Estamos com bastante movimento agora!* Seu pedido pode demorar um pouquinho mais que o normal. Obrigado pela paciencia! 😊`
              : msg
          );
        }
      }
    }

    if (result.escalar) {
      await salvarEscalonamento(phone, currentSession);
      await redis.set(`manual:${phone}`, true, { ex: 3600 });
    }

    await redis.set(sessionKey, result.session, { ex: 1800 });

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
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
      } catch (err) {
        console.error("[ChefeBot] Erro ao buscar imagem:", err);
      }
    }

    for (const msg of result.messages) {
      const msgFinal = config.chavePix
        ? msg.replace("(configurada pelo admin)", config.chavePix)
        : msg;
      await enviarMensagem(phone, msgFinal);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    await log('erro', 'Erro no webhook WhatsApp', String(error));
    return NextResponse.json({ ok: true });
  }
}