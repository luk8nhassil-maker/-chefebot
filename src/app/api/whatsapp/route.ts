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

async function salvarPedido(session: BotSession, phone: string, config: ConfigPizzaria) {
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
  const novoPedido: Pedido = {
    id: Date.now().toString(),
    cliente: session.customerName || phone,
    telefone: phone,
    itens,
    total,
    status: "novo",
    horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    endereco,
  };
  await redis.set("pedidos", [...pedidos, novoPedido]);

  const historico: ClienteHistorico = {
    nome: session.customerName || phone,
    ultimoPedido: itens,
    ultimoTotal: total,
  };
  await redis.set(`cliente:${phone}`, historico, { ex: 30 * 24 * 60 * 60 });
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

async function enviarMensagem(phone: string, message: string) {
  const url = `https://${process.env.EVOLUTION_API_URL}/message/sendText/chefe`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.EVOLUTION_API_KEY!,
    },
    body: JSON.stringify({
      number: phone,
      text: message,
    }),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.event !== "messages.upsert") {
      return NextResponse.json({ ok: true });
    }

    const data = body.data;

    if (data?.key?.fromMe) {
      return NextResponse.json({ ok: true });
    }

    const phone = data?.key?.remoteJid?.replace("@s.whatsapp.net", "");
    const messageText =
      data?.message?.conversation ||
      data?.message?.extendedTextMessage?.text ||
      "";

    if (!phone || !messageText) {
      return NextResponse.json({ ok: true });
    }

    const botAtivo = await redis.get<boolean>("bot_ativo");
    if (botAtivo === false) {
      return NextResponse.json({ ok: true });
    }

    const emManual = await redis.get<boolean>(`manual:${phone}`);
    if (emManual === true) {
      return NextResponse.json({ ok: true });
    }

    const config = await getConfig();

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
          `Ei *${firstName}*, que saudade! Seu ultimo pedido foi: *${ultimoPedido}*\n\nVai querer pedir mais?\n\n  1. Sim, bora!\n  2. Nao, valeu`
        );
        await redis.set(sessionKey, currentSession, { ex: 1800 });
        return NextResponse.json({ ok: true });
      } else {
        currentSession = createInitialSession();
      }
    } else {
      currentSession = savedSession;
    }

    const result = processMessage(messageText, currentSession);

    if (
      currentSession.step === "confirm" &&
      (messageText.trim() === "1" || messageText.trim().toLowerCase() === "sim")
    ) {
      await salvarPedido(currentSession, phone, config);
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




