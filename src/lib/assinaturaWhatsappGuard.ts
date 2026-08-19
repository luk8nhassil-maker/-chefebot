import { assinaturaBloqueiaOperacao } from "./assinaturaChefeBot.server";
import { redis } from "./redis";

type PedidoMinimo = {
  telefone?: string;
  status?: string;
  data?: string;
};

function telefoneComparavel(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("55") ? digits.slice(2) : digits;
}

function dataHojeBrasil(): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

export async function deveSilenciarNovoAtendimentoWhatsapp(phone: string): Promise<boolean> {
  try {
    if (!(await assinaturaBloqueiaOperacao())) return false;

    const [sessao, pedidos] = await Promise.all([
      redis.get<unknown>(`session:${phone}`).catch(() => null),
      redis.get<PedidoMinimo[]>("pedidos").catch(() => null),
    ]);

    // Conversa ou pedido em andamento permanece protegido: a mensalidade
    // nunca interrompe Pix, cancelamento, entrega ou suporte já iniciado.
    if (sessao) return false;

    const telefone = telefoneComparavel(phone);
    const hoje = dataHojeBrasil();
    const pedidoProtegido = (pedidos || []).some((pedido) => {
      if (telefoneComparavel(pedido.telefone || "") !== telefone) return false;
      const emAndamento = !["entregue", "cancelado"].includes(String(pedido.status || ""));
      return emAndamento || pedido.data === hoje;
    });

    return !pedidoProtegido;
  } catch {
    // O subsistema de cobrança falha aberto para não derrubar o WhatsApp saudável.
    return false;
  }
}
