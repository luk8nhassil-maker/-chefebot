import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente, lerSessaoClienteDiagnosticada, consumirTicketAtivacaoPerfil, criarTicketAtivacaoPerfil } from "@/lib/clienteAuth";
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
  const { payload: payloadSessao, diagnostico } = await lerSessaoClienteDiagnosticada(req);

  // Corpo lido cedo (antes da decisão de auth) porque o fallback abaixo
  // depende dele; corpo malformado nunca derruba a rota — cai para {} e o
  // fluxo normal decide o 400/401 apropriado.
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {}

  // Incidente P3-ABB28C: cookie e sessão portátil (JWE) emitidos juntos pelo
  // mesmo /api/cliente/verificar falharam aqui sem causa permanente provada
  // — um retry cego com a MESMA credencial rejeitada foi descartado por não
  // ser uma correção comprovada. Em vez disso, quando a sessão normal falha,
  // aceita SÓ o ticket de ativação do perfil (opaco, uso único, finalidade
  // exclusiva "perfil:ativar", nunca uma sessão geral — ver clienteAuth.ts).
  // Nunca aceita telefone/clienteId/waToken do corpo como autorização.
  // Nome validado ANTES de consumir o ticket: um corpo malformado ou nome
  // vazio não pode queimar um ticket de uso único à toa (o ticket é a única
  // credencial de recuperação quando cookie/JWE falham).
  const nome = normalizarNomeCliente(body.nome);
  if (nome.length < 2) {
    return NextResponse.json({ ok: false, error: "Digite seu nome" }, { status: 400 });
  }

  let payload = payloadSessao;
  const ativacaoTokenBruto = typeof body.ativacaoToken === "string" ? body.ativacaoToken : null;
  const ticketPresente = !!ativacaoTokenBruto;
  const autenticadoPorTicket = !payload && !!ativacaoTokenBruto;
  if (autenticadoPorTicket) {
    payload = await consumirTicketAtivacaoPerfil(ativacaoTokenBruto);
  }

  if (!payload) {
    const traceBruto = req.headers.get("x-chefebot-trace");
    const trace = typeof traceBruto === "string" && TRACE_RE.test(traceBruto) ? traceBruto : "-";
    console.log(
      `[ChefeBot] perfil3-auth trace=${trace} cookie_presente=${diagnostico.cookiePresente ? 1 : 0} cookie_valido=${diagnostico.cookieValido ? 1 : 0} cookie_erro=${diagnostico.cookieErro ?? "-"} authorization_presente=${diagnostico.authorizationPresente ? 1 : 0} formato_bearer=${diagnostico.formatoBearer} jwe_valido=${diagnostico.jweValido ? 1 : 0} jwe_erro=${diagnostico.jweErro ?? "-"} opaco_valido=${diagnostico.opacoValido ? 1 : 0} ticket_presente=${ticketPresente ? 1 : 0} fonte=${diagnostico.fonte}`
    );
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  // Sem gate de leitura do registro do cliente por clienteId: o telefone já
  // vem autenticado no próprio payload (sessão ou ticket de ativação). Um
  // incidente em produção provou esse gate rejeitando o PATCH (401) mesmo
  // com sessão válida, por atraso de réplica do Redis logo após o OTP
  // escrever o registro.
  try {
    // Primeira ativação: grava nome + fidelidadeAtivadaEm na mesma escrita.
    // O ticket de ativação SÓ autoriza exatamente esta operação — nunca vira
    // sessão geral, nunca autoriza outra rota.
    const atualizado = await ativarFidelidadeCliente(payload.telefone, nome);
    return NextResponse.json({ ok: true, next: "points", cliente: { nome: atualizado.nome ?? null } });
  } catch (error) {
    console.error("[ChefeBot] Erro ao atualizar nome do cliente:", error);
    // O ticket original já foi consumido (uso único) antes desta escrita
    // falhar. Sem compensação, o cliente fica sem QUALQUER credencial válida
    // — nem sessão (já tinha falhado), nem ticket (já apagado) — e trava na
    // tela do nome para sempre, só recuperável abrindo um link novo do
    // WhatsApp do zero. Reemite um ticket novo (mesma finalidade, TTL do
    // zero) só quando a autenticação desta chamada veio do ticket, para o
    // frontend poder tentar de novo sem reiniciar o OTP.
    const ativacaoToken = autenticadoPorTicket
      ? await criarTicketAtivacaoPerfil({ clienteId: payload.clienteId, telefone: payload.telefone })
      : undefined;
    return NextResponse.json({ ok: false, error: "Erro interno", ativacaoToken }, { status: 500 });
  }
}
