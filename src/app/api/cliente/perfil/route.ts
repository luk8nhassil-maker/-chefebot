import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente, lerSessaoClienteDiagnosticada } from "@/lib/clienteAuth";
import { buscarClientePorId, normalizarNomeCliente, ativarFidelidadeCliente } from "@/lib/clientes";
import { redis } from "@/lib/redis";

const TRACE_RE = /^P3-[A-Z0-9]{6}$/;

type PedidoResumo = {
  id: string;
  clienteId?: string;
  numero?: number;
  data?: string;
  horario?: string;
  total?: number;
  status?: string;
};

export async function GET(req: NextRequest) {
  // Sessão via cookie HttpOnly ou, em navegadores sem cookie confiável
  // (WhatsApp no iPhone), via Authorization: Bearer com sessão opaca.
  const payload = await lerSessaoCliente(req);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  // Desacoplado por incidente: este endpoint NUNCA consulta fidelidade —
  // uma falha de pontos não pode derrubar o perfil nem parecer logout.
  let ultimosPedidos: PedidoResumo[] = [];
  try {
    const pedidos = (await redis.get<PedidoResumo[]>("pedidos")) || [];
    ultimosPedidos = pedidos
      .filter((p) => p.clienteId === cliente.clienteId)
      .slice(-5)
      .reverse()
      .map((p) => ({ id: p.id, numero: p.numero, data: p.data, total: p.total, status: p.status }));
  } catch (err) {
    console.error("[ChefeBot] Erro ao buscar pedidos do cliente:", err);
  }

  return NextResponse.json({
    cliente: { nome: cliente.nome ?? null, telefone: cliente.telefone },
    ultimosPedidos,
  });
}

// PATCH /api/cliente/perfil — completa o cadastro do próprio dono da sessão
// (só o nome; o telefone é sempre o da sessão autenticada, nunca do body).
// Usado pela tela de Pontos logo após o OTP, quando o cliente ainda não tem
// nome salvo.
export async function PATCH(req: NextRequest) {
  // Sessão via cookie HttpOnly ou, em navegadores sem cookie confiável
  // (WhatsApp no iPhone), via Authorization: Bearer — sessão portátil (JWE)
  // ou, em compatibilidade, a sessão opaca legada. A validação da sessão em
  // si já não depende de leitura de Redis (ver lerSessaoCliente).
  //
  // Diagnóstico TEMPORÁRIO (Perfil 3.0): usa lerSessaoClienteDiagnosticada em
  // vez de lerSessaoCliente só para poder registrar, quando a autenticação
  // falhar, EM QUAL ETAPA ela falhou — nunca o conteúdo do cookie/Bearer. A
  // resposta ao navegador continua idêntica (genérica, sem detalhe nenhum).
  const { payload, diagnostico } = await lerSessaoClienteDiagnosticada(req);
  if (!payload) {
    const traceBruto = req.headers.get("x-chefebot-trace");
    const trace = typeof traceBruto === "string" && TRACE_RE.test(traceBruto) ? traceBruto : "-";
    console.log(
      `[ChefeBot] perfil3-auth trace=${trace} cookie_presente=${diagnostico.cookiePresente ? 1 : 0} cookie_valido=${diagnostico.cookieValido ? 1 : 0} authorization_presente=${diagnostico.authorizationPresente ? 1 : 0} formato_bearer=${diagnostico.formatoBearer} jwe_valido=${diagnostico.jweValido ? 1 : 0} opaco_valido=${diagnostico.opacoValido ? 1 : 0} fonte=${diagnostico.fonte}`
    );
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  // Sem gate de leitura do registro do cliente por clienteId: o telefone já
  // vem autenticado no próprio payload da sessão. Um incidente em produção
  // provou esse gate rejeitando o PATCH (401) mesmo com sessão válida, por
  // atraso de réplica do Redis logo após o OTP escrever o registro.
  try {
    const body = await req.json();
    const nome = normalizarNomeCliente(body?.nome);
    if (nome.length < 2) {
      return NextResponse.json({ ok: false, error: "Digite seu nome" }, { status: 400 });
    }
    // Primeira ativação: grava nome + fidelidadeAtivadaEm na mesma escrita.
    const atualizado = await ativarFidelidadeCliente(payload.telefone, nome);
    return NextResponse.json({ ok: true, next: "points", cliente: { nome: atualizado.nome ?? null } });
  } catch (error) {
    console.error("[ChefeBot] Erro ao atualizar nome do cliente:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
