import { NextRequest, NextResponse } from "next/server";
import { processMessage, createInitialSession, createReturningSession, BotSession, ClienteHistorico } from "@/lib/bot";
import { redis } from "@/lib/redis";
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
};
type ConfigPizzaria = {
  nomePizzaria: string;
  horaAbertura: number;
  horaFechamento: number;
  chavePix: string;
};
const CONFIG_PADRAO: ConfigPizzaria = {
  nomePizzaria: "Chefe da Pizza",
  horaAbertura: 18,
  horaFechamento: 23,
  chavePix: "",
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
function querCancelar(texto: string): boolean {
  const n = normalizar(texto);
  const palavras = [
    "cancelar", "cancela", "cancelamento", "desisti", "desistir",
    "nao quero mais", "esquece", "deixa pra la",
    "nao quero", "cancelem", "cancele",
    "nao vai mais", "mudei de ideia", "mudei de opiniao",
  ];
  return palavras.some(p => n.includes(p));
}
function resolvido(texto: string): boolean {
  const n = normalizar(texto);
  const palavras = [
    "nao", "nao obrigado", "nao preciso", "nao tenho", "pode ser",
    "ta bom", "tudo bem", "obrigado", "valeu", "ok", "beleza",
    "nao precisa", "so isso", "era isso", "resolvido", "sim obrigado",
    "nao mais", "chega", "tranquilo", "por enquanto nao",
  ];
  return palavras.some(p => n.includes(p));
}
function eDespedida(texto: string): boolean {
  const n = normalizar(texto);
  const palavras = [
    "tchau", "flw", "ate mais", "ate logo", "fui", "foi",
    "abraco", "bjs", "beijinho", "adeus", "xau",
    "ta bom obrigado", "valeu obrigado", "ok obrigado",
    "nao obrigado", "nao, obrigado", "nao precisa obrigado",
    "ta otimo", "ta certo", "ok valeu", "beleza obrigado",
    "obrigado tchau", "obrigado ate mais", "valeu tchau",
    "tudo bem obrigado", "ja ta bom", "pode ser isso",
  ];
  return palavras.some(p => n.includes(p));
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
  const endereco =
    session.deliveryType === "delivery"
      ? `${session.address} - ${session.neighborhood}`
      : "Retirada na loja";
  const pedidoId = Date.now().toString();
  const novoPedido: Pedido = {
    id: pedidoId,
    cliente: session.customerName || phone,
    telefone: phone,
    itens,
    total,
    status: "novo",
    horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    endereco,
    ...(session.observacao ? { observacao: session.observacao } : {}),
  };
  await redis.set("pedidos", [...pedidos, novoPedido]);
  const historico: ClienteHistorico = {
    nome: session.customerName || phone,
    ultimoPedido: itens,
    ultimoTotal: total,
  };
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
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.EVOLUTION_API_KEY!,
    },
    body: JSON.stringify({ number: phone, text: message }),
  });
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.event !== "messages.upsert") return NextResponse.json({ ok: true });
    const data = body.data;
    if (data?.key?.fromMe) return NextResponse.json({ ok: true });
    const phone = data?.key?.remoteJid?.replace("@s.whatsapp.net", "");
    const messageText =
      data?.message?.conversation ||
      data?.message?.extendedTextMessage?.text ||
      "";
    if (!phone || !messageText) return NextResponse.json({ ok: true });
    const botAtivo = await redis.get<boolean>("bot_ativo");
    if (botAtivo === false) return NextResponse.json({ ok: true });
    const emManual = await redis.get<boolean>(`manual:${phone}`);
    if (emManual === true) return NextResponse.json({ ok: true });
    // Verifica se esta aguardando resposta de encerramento
    const resolvendo = await redis.get<boolean>(`resolvendo:${phone}`);
    if (resolvendo === true) {
      if (resolvido(messageText)) {
        await redis.del(`resolvendo:${phone}`);
        await redis.del(`manual:${phone}`);
        await fecharEscalonamento(phone);
        await redis.del(`session:${phone}`);
        const config = await getConfig();
        await enviarMensagem(phone, `Disponha! Se precisar de mais alguma coisa e so chamar. 😊`);
      } else {
        await enviarMensagem(phone, "Pode falar! Estou aqui pra te ajudar. 😊");
      }
      return NextResponse.json({ ok: true });
    }
    const config = await getConfig();
    // Detector de despedida - responde levemente e nao abre nenhum fluxo
    if (eDespedida(messageText)) {
      await enviarMensagem(phone, `Ate mais! 😊`);
      return NextResponse.json({ ok: true });
    }
    if (!estaAberto(config)) {
      await redis.del(`session:${phone}`);
      await enviarMensagem(phone, mensagemFechado(config));
      return NextResponse.json({ ok: true });
    }
    const sessionKey = `session:${phone}`;
    const savedSession = await redis.get<BotSession>(sessionKey);
    let currentSession: BotSession;
    if (!savedSession) {
      const historico = await redis.get<ClienteHistorico>(`cliente:${phone}`);
      if (historico) {
        const firstName = historico.nome.split(" ")[0];
        const ultimoPedido = historico.ultimoPedido.join(", ");
        currentSession = createReturningSession(historico);
        await enviarMensagem(
          phone,
          `Ei *${firstName}*, que saudade! 😊 Seu ultimo pedido foi: *${ultimoPedido}*\n\nVai querer pedir mais?\n\n  1. Sim, bora!\n  2. Nao, valeu`
        );
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
        await enviarMensagem(phone, `Entendido! Solicitei o cancelamento pra nossa equipe. Assim que confirmado voce recebe a mensagem aqui. Qualquer duvida e so chamar!`);
        return NextResponse.json({ ok: true });
      }
      if (pedido.status === "em_preparo") {
        await enviarMensagem(phone, `Que pena! Seu pedido ja esta em preparo e nao da pra cancelar agora. Posso chamar a Kellyne pra te ajudar?`);
        return NextResponse.json({ ok: true });
      }
      await enviarMensagem(phone, `Seu pedido ja esta em andamento e nao da pra cancelar. Qualquer duvida e so chamar!`);
      return NextResponse.json({ ok: true });
    }
    const result = processMessage(messageText, currentSession);
    if (
      currentSession.step === "confirm" &&
      (messageText.trim() === "1" || messageText.trim().toLowerCase() === "sim")
    ) {
      const pedidoId = await salvarPedido(currentSession, phone, config);
      result.session = { ...result.session, pedidoId } as any;
    }
    if (result.escalar) {
      await salvarEscalonamento(phone, currentSession);
      await redis.set(`manual:${phone}`, true, { ex: 3600 });
    }
    await redis.set(sessionKey, result.session, { ex: 1800 });
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
    return NextResponse.json({ ok: true });
  }
}