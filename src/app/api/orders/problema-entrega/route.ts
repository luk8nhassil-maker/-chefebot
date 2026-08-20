import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { mutarPedidos } from "@/lib/pedidosConcorrencia";
import {
  classificarPendencia,
  modalidadePedidoOperacional,
  type PedidoLimpeza,
  type RegistroLimpeza,
} from "@/lib/limpezaOperacionalPedidos";
import {
  mensagemProblemaEntrega,
  motivoProblemaEntregaValido,
  MOTIVO_RETIRADA_ATRASADA,
  type MotivoProblemaEntrega,
  type RegistroProblemaEntrega,
} from "@/lib/problemaEntrega";
import { enviarTextoWhatsApp } from "@/lib/whatsappMensagem";

type AcaoProblemaEntrega = "adiar" | "contatar" | "registrar_sem_contato";
type ContextoAdiamento = "ainda_na_rua" | "cliente_respondeu" | "ainda_aguardando_retirada" | "ainda_aguardando_servir";

type PedidoEntrega = PedidoLimpeza & {
  id: string;
  status: string;
  cliente: string;
  telefone?: string;
  semTelefone?: boolean;
  entregaProblema?: RegistroProblemaEntrega;
};

type ResultadoPreparacao =
  | { ok: true; pedido: PedidoEntrega; contatoId?: string; tentativas: number }
  | { ok: false; status: number; erro: string };

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["atendente", "admin"].includes(payload.role as string)) return null;
  return payload;
}

function nomeOperador(auth: { name?: unknown; username?: unknown }): string {
  if (typeof auth.name === "string" && auth.name.trim()) return auth.name.trim();
  if (typeof auth.username === "string" && auth.username.trim()) return auth.username.trim();
  return "Atendente";
}

function telefoneWhatsApp(telefone?: string): string | null {
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  return digitos.startsWith("55") ? digitos : `55${digitos}`;
}

function tentativasRota(pedido: PedidoEntrega): number {
  const registro = pedido.limpezaOperacional;
  if (registro?.motivo !== "entrega_longa" || registro.acao !== "adiou") return 0;
  if (typeof registro.tentativas === "number" && Number.isFinite(registro.tentativas)) return Math.max(1, Math.floor(registro.tentativas));
  return 1;
}

function registroAdiamento(operador: string, agoraIso: string, tentativas: number): RegistroLimpeza {
  return { motivo: "entrega_longa", acao: "adiou", resolvidoEm: agoraIso, resolvidoPor: operador, tentativas };
}

function validarPendenciaRota(pedido: PedidoEntrega, agora: number): { ok: true } | { ok: false; erro: string } {
  if (pedido.status !== "saiu_entrega" || pedido.isArchived) return { ok: false, erro: "Este pedido não está mais na etapa de entrega." };
  const pendencia = classificarPendencia(pedido, agora);
  if (pendencia?.motivo !== "entrega_longa") return { ok: false, erro: "Este pedido ainda não precisa de uma decisão de entrega." };
  return { ok: true };
}

async function prepararAcao(
  id: string,
  acao: AcaoProblemaEntrega,
  contexto: ContextoAdiamento | undefined,
  motivo: MotivoProblemaEntrega | undefined,
  operador: string,
  agora: number,
): Promise<ResultadoPreparacao> {
  const agoraIso = new Date(agora).toISOString();
  return mutarPedidos<PedidoEntrega, ResultadoPreparacao>((pedidos) => {
    const index = pedidos.findIndex((pedido) => pedido.id === id);
    if (index === -1) return { persistir: false, resultado: { ok: false, status: 404, erro: "Pedido não encontrado." } };
    const pedido = pedidos[index];
    const validacao = validarPendenciaRota(pedido, agora);
    if (!validacao.ok) return { persistir: false, resultado: { ok: false, status: 409, erro: validacao.erro } };

    const tentativasAtuais = tentativasRota(pedido);
    const modo = modalidadePedidoOperacional(pedido);

    if (acao === "adiar") {
      const clienteRespondeu = contexto === "cliente_respondeu";
      if (modo === "delivery" && !clienteRespondeu && tentativasAtuais >= 2) {
        return { persistir: false, resultado: { ok: false, status: 409, erro: "Agora informe o problema da entrega ou confirme que ela foi concluída." } };
      }
      if (modo === "retirada" && !clienteRespondeu && tentativasAtuais >= 2 && pedido.entregaProblema?.contatoStatus !== "enviado") {
        return { persistir: false, resultado: { ok: false, status: 409, erro: "Avise o cliente que o pedido está pronto ou confirme que ele já retirou." } };
      }
      if (clienteRespondeu && modo === "dine_in") {
        return { persistir: false, resultado: { ok: false, status: 409, erro: "Consumo no local é resolvido pela equipe do salão, sem contato externo." } };
      }
      if (clienteRespondeu && pedido.entregaProblema?.contatoStatus !== "enviado") {
        return { persistir: false, resultado: { ok: false, status: 409, erro: "Registre o contato com o cliente antes de informar que ele respondeu." } };
      }
      const proximasTentativas = clienteRespondeu ? Math.max(2, tentativasAtuais) : tentativasAtuais + 1;
      const atualizado: PedidoEntrega = { ...pedido, limpezaOperacional: registroAdiamento(operador, agoraIso, proximasTentativas) };
      const copia = [...pedidos];
      copia[index] = atualizado;
      return { persistir: true, pedidos: copia, resultado: { ok: true, pedido: atualizado, tentativas: proximasTentativas } };
    }

    if (tentativasAtuais < 1) return { persistir: false, resultado: { ok: false, status: 409, erro: "Primeiro confirme se a entrega ainda está na rua." } };
    if (modo === "dine_in") return { persistir: false, resultado: { ok: false, status: 409, erro: "Consumo no local não usa contato de entrega." } };

    const motivoEfetivo = modo === "retirada" ? MOTIVO_RETIRADA_ATRASADA : motivo;
    if (!motivoEfetivo) return { persistir: false, resultado: { ok: false, status: 400, erro: "Escolha o que aconteceu com a entrega." } };
    if (modo === "delivery" && motivoEfetivo === MOTIVO_RETIRADA_ATRASADA) return { persistir: false, resultado: { ok: false, status: 400, erro: "Motivo incompatível com entrega por motoboy." } };

    const tentativasContato = (pedido.entregaProblema?.tentativasContato ?? 0) + 1;
    if (acao === "registrar_sem_contato") {
      const atualizado: PedidoEntrega = {
        ...pedido,
        entregaProblema: {
          motivo: motivoEfetivo,
          registradoEm: agoraIso,
          registradoPor: operador,
          contatoStatus: "falhou",
          tentativasContato,
          erroContato: telefoneWhatsApp(pedido.telefone) ? "contato_manual" : "sem_telefone",
        },
        limpezaOperacional: registroAdiamento(operador, agoraIso, Math.max(2, tentativasAtuais)),
      };
      const copia = [...pedidos];
      copia[index] = atualizado;
      return { persistir: true, pedidos: copia, resultado: { ok: true, pedido: atualizado, tentativas: Math.max(2, tentativasAtuais) } };
    }

    const telefone = telefoneWhatsApp(pedido.telefone);
    if (!telefone || pedido.semTelefone) return { persistir: false, resultado: { ok: false, status: 422, erro: "Este pedido não tem um WhatsApp válido cadastrado." } };

    const anterior = pedido.entregaProblema;
    if (anterior?.contatoStatus === "enviando") return { persistir: false, resultado: { ok: false, status: 409, erro: "Existe um envio anterior sem confirmação. Para evitar mensagem duplicada, use o contato manual ou registre sem contato." } };
    if (anterior?.contatoStatus === "enviado" && anterior.motivo === motivoEfetivo) return { persistir: false, resultado: { ok: false, status: 409, erro: "A mensagem já foi enviada. Aguarde a resposta ou use o contato manual." } };

    const contatoId = randomUUID();
    const atualizado: PedidoEntrega = {
      ...pedido,
      entregaProblema: { motivo: motivoEfetivo, registradoEm: agoraIso, registradoPor: operador, contatoStatus: "enviando", tentativasContato, contatoId },
    };
    const copia = [...pedidos];
    copia[index] = atualizado;
    return { persistir: true, pedidos: copia, resultado: { ok: true, pedido: atualizado, contatoId, tentativas: tentativasAtuais } };
  });
}

async function concluirContato(id: string, contatoId: string, operador: string, sucesso: boolean, motivoFalha?: string): Promise<void> {
  const agoraIso = new Date().toISOString();
  await mutarPedidos<PedidoEntrega, void>((pedidos) => {
    const index = pedidos.findIndex((pedido) => pedido.id === id);
    if (index === -1) return { persistir: false, resultado: undefined };
    const pedido = pedidos[index];
    if (pedido.entregaProblema?.contatoId !== contatoId) return { persistir: false, resultado: undefined };
    const problema: RegistroProblemaEntrega = {
      ...pedido.entregaProblema,
      contatoStatus: sucesso ? "enviado" : "falhou",
      ...(sucesso ? { contatoEm: agoraIso } : { erroContato: motivoFalha || "falha_envio" }),
    };
    const atualizado: PedidoEntrega = {
      ...pedido,
      entregaProblema: problema,
      ...(sucesso && pedido.status === "saiu_entrega" ? { limpezaOperacional: registroAdiamento(operador, agoraIso, Math.max(2, tentativasRota(pedido))) } : {}),
    };
    const copia = [...pedidos];
    copia[index] = atualizado;
    return { persistir: true, pedidos: copia, resultado: undefined };
  });
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // Preview pode compartilhar credenciais/Redis. Fora de Production esta rota
  // nunca escreve nem dispara WhatsApp real.
  if (process.env.VERCEL_ENV !== "production") return NextResponse.json({ error: "Ação real bloqueada fora de produção." }, { status: 403 });

  const body = await req.json().catch(() => null) as { id?: unknown; acao?: unknown; contexto?: unknown; motivo?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const acao = body?.acao;
  if (!id || !["adiar", "contatar", "registrar_sem_contato"].includes(String(acao))) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });

  const contextosValidos: ContextoAdiamento[] = ["ainda_na_rua", "cliente_respondeu", "ainda_aguardando_retirada", "ainda_aguardando_servir"];
  const contexto = contextosValidos.includes(body?.contexto as ContextoAdiamento) ? body?.contexto as ContextoAdiamento : "ainda_na_rua";
  const motivo = motivoProblemaEntregaValido(body?.motivo) ? body?.motivo : undefined;
  const operador = nomeOperador(auth);
  const preparado = await prepararAcao(id, acao as AcaoProblemaEntrega, contexto, motivo, operador, Date.now());
  if (!preparado.ok) return NextResponse.json({ error: preparado.erro }, { status: preparado.status });
  if (acao !== "contatar") return NextResponse.json({ ok: true, tentativas: preparado.tentativas });

  const telefone = telefoneWhatsApp(preparado.pedido.telefone);
  const contatoId = preparado.contatoId;
  const motivoContato = preparado.pedido.entregaProblema?.motivo;
  if (!telefone || !motivoContato || !contatoId) return NextResponse.json({ error: "Não foi possível preparar o contato." }, { status: 422 });

  const texto = mensagemProblemaEntrega(motivoContato, preparado.pedido.cliente);
  let resultado: Awaited<ReturnType<typeof enviarTextoWhatsApp>>;
  try {
    resultado = await enviarTextoWhatsApp(telefone, texto);
  } catch {
    await concluirContato(id, contatoId, operador, false, "network_error");
    return NextResponse.json({ error: "Não consegui enviar a mensagem ao cliente. Tente novamente ou use o contato manual." }, { status: 502 });
  }
  if (!resultado.ok) {
    await concluirContato(id, contatoId, operador, false, resultado.motivo);
    return NextResponse.json({ error: "Não consegui confirmar o envio ao cliente. Tente novamente ou use o contato manual." }, { status: 502 });
  }
  await concluirContato(id, contatoId, operador, true);
  return NextResponse.json({ ok: true, enviado: true, tentativas: Math.max(2, preparado.tentativas) });
}
