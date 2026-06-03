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
    return `Olá! 🍕 Obrigado por entrar em contato com a *${config.nomePizzaria}*!\n\nInfelizmente já encerramos as operações de hoje. 😔\n\n⏰ Nosso horário de funcionamento é:\n*Todos os dias das ${config.horaAbertura}h às ${config.horaFechamento}h*\n\nAmanhã estaremos aqui para te atender! Até lá! 😊`;
  }
  return `Olá! 🍕 Obrigado por entrar em contato com a *${config.nomePizzaria}*!\n\nAinda não abrimos hoje. 😔\n\n⏰ Nosso horário de funcionamento é:\n*Todos os dias das ${config.horaAbertura}h às ${config.horaFechamento}h*\n\nVolte mais tarde e faremos uma pizza incrível para você! 😊`;
}

async function salvarPedido(session: BotSession, phone: string, config: ConfigPizzaria) {
  const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
  const itens = session.cart.map((item) => {
    const border = item.border !== "Sem borda" ? ` + ${item.border}` : "";
    return `Pizza ${item.flavor} ${item.size}${border}`;
  });
  const total =
    session.cart.reduce((sum, item) => sum + item.price, 0) +
    session.deliveryFee;
  const endereco =
    session.deliveryType === "delivery"
      ? `${session.address} — ${session.neighborhood}`
      : "Retirada na loja";
  const novoPedido: Pedido = {
    id: Date.now().toString(),
    cliente: session.customerName || phone,
    telefone: phone,
    itens,
    total,
    status: "novo",
    horario: new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
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
  const jaExiste = pedidos.some(
    (p) => p.telefone === phone && p.escalonado === true
  );
  if (jaExiste) return;
  const novoPedido: Pedido = {
    id: Date.now().toString(),
    cliente: session.customerName || phone,
    telefone: phone,
    itens: ["⚠️ Cliente solicitou atendimento humano"],
    total: 0,
    status: "novo",
    horario: new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    endereco: "—",
    escalonado: true,
  };
  await redis.set("pedidos", [...pedidos, novoPedido]);
}

async function enviarMensagem(phone: string, message: string) {
  const url = `https://${process.env.EVOLUTION_API_URL}/message/sendText/chefebot`;
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

    // Lê configurações
    const config = await getConfig();

    // Verifica horário de funcionamento
    if (!estaAberto(config)) {
      const jaAvisado = await redis.get<boolean>(`fechado:${phone}`);
      if (!jaAvisado) {
        await enviarMensagem(phone, mensagemFechado(config));
        await redis.set(`fechado:${phone}`, true, { ex: 3600 });
      }
      return NextResponse.json({ ok: true });
    }

    // Limpa flag de fechado quando abre
    await redis.del(`fechado:${phone}`);

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
          `Olá de novo, *${firstName}*! 👋\n\nSeu último pedido foi: *${ultimoPedido}*\n\nQuer fazer um novo pedido?\n\n  1. Sim, quero pedir\n  2. Não, obrigado`
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
      (messageText.trim() === "1" ||
        messageText.trim().toLowerCase() === "sim")
    ) {
      await salvarPedido(currentSession, phone, config);
    }

    if (result.escalar) {
      await salvarEscalonamento(phone, currentSession);
      await redis.set(`manual:${phone}`, true, { ex: 3600 });
    }

    await redis.set(sessionKey, result.session, { ex: 1800 });

    for (const msg of result.messages) {
      // Substitui chave Pix hardcoded pela configuração
      const msgFinal = config.chavePix
        ? msg.replace("11999999999", config.chavePix)
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