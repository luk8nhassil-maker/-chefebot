import { NextRequest, NextResponse } from "next/server";
import { mutarPedidos, type ResultadoMutacaoPedidos } from "@/lib/pedidosConcorrencia";
import type { PedidoRedis } from "@/types/pedidoRedis";
import {
  EDICAO_DURACAO_MS,
  adquirirMutexEdicao,
  liberarMutexEdicao,
  criarSessaoEdicao,
  tokensIguais,
  lockEdicaoAtivo,
  limparEdicaoExpiradaSeNecessario,
  pedidoAguardandoAceite,
  pagamentoJaConfirmado,
} from "@/lib/pedidoEdicao";

type ResultadoIniciarEdicao =
  | { tipo: "nao_encontrado" }
  | { tipo: "ja_aceito" }
  | { tipo: "pagamento_confirmado" }
  | { tipo: "lock_ativo" }
  | { tipo: "ok"; pedido: PedidoRedis; editSessionId: string; editExpiresAt: string }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { statusToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }
  const statusToken = (body.statusToken || "").trim();
  if (!id || !statusToken) {
    return NextResponse.json({ ok: false, error: "id e statusToken obrigatórios" }, { status: 400 });
  }

  // Duas travas distintas e nunca invertidas em ordem no resto do código: o
  // mutex por pedido (serializa tentativas de edição do MESMO pedido) é
  // adquirido primeiro; o lock GLOBAL de "pedidos" (ver
  // src/lib/pedidosConcorrencia.ts, protege a leitura-modificação-escrita do
  // array inteiro contra QUALQUER outro escritor) é adquirido depois, só
  // dentro da seção crítica.
  const mutexToken = await adquirirMutexEdicao(id);
  if (!mutexToken) {
    return NextResponse.json({ ok: false, error: "Não foi possível iniciar a edição agora. Tente de novo." }, { status: 409 });
  }

  try {
    const resultado = await mutarPedidos<PedidoRedis, ResultadoIniciarEdicao>((pedidosFrescos) => {
      const index = pedidosFrescos.findIndex((p) => p.id === id);
      if (index < 0 || !tokensIguais(pedidosFrescos[index].statusToken, statusToken)) {
        return { persistir: false, resultado: { tipo: "nao_encontrado" } };
      }

      let pedido = pedidosFrescos[index];
      const limpeza = limparEdicaoExpiradaSeNecessario(pedido);
      if (limpeza.mudou) pedido = limpeza.pedido;

      const comLimpezaSeMudou = (
        tipo: "ja_aceito" | "pagamento_confirmado" | "lock_ativo"
      ): ResultadoMutacaoPedidos<PedidoRedis, ResultadoIniciarEdicao> => {
        if (!limpeza.mudou) return { persistir: false, resultado: { tipo } };
        const atualizados = [...pedidosFrescos];
        atualizados[index] = pedido;
        return { persistir: true, pedidos: atualizados, resultado: { tipo } };
      };

      if (!pedidoAguardandoAceite(pedido)) return comLimpezaSeMudou("ja_aceito");
      if (pagamentoJaConfirmado(pedido)) return comLimpezaSeMudou("pagamento_confirmado");
      if (lockEdicaoAtivo(pedido)) return comLimpezaSeMudou("lock_ativo");

      const agora = Date.now();
      const editSessionId = criarSessaoEdicao();
      const editExpiresAt = new Date(agora + EDICAO_DURACAO_MS).toISOString();
      const atualizado: PedidoRedis = {
        ...pedido,
        editStatus: "editing",
        editSessionId,
        editStartedAt: new Date(agora).toISOString(),
        editExpiresAt,
        editHistory: [
          ...(pedido.editHistory || []),
          { tipo: "iniciado", horario: new Date(agora).toISOString(), revisaoAnterior: pedido.revision ?? 1 },
        ],
      };
      const atualizados = [...pedidosFrescos];
      atualizados[index] = atualizado;
      return { persistir: true, pedidos: atualizados, resultado: { tipo: "ok", pedido: atualizado, editSessionId, editExpiresAt } };
    });

    if (resultado.tipo === "nao_encontrado") {
      return NextResponse.json({ ok: false, error: "Pedido não encontrado" }, { status: 404 });
    }
    if (resultado.tipo === "ja_aceito") {
      return NextResponse.json(
        { ok: false, error: "Este pedido acabou de ser aceito pela loja e não pode mais ser alterado." },
        { status: 409 }
      );
    }
    if (resultado.tipo === "pagamento_confirmado") {
      return NextResponse.json(
        { ok: false, error: "O pagamento deste pedido já foi confirmado. Para alterar o pedido, fale diretamente com a loja." },
        { status: 409 }
      );
    }
    if (resultado.tipo === "lock_ativo") {
      return NextResponse.json(
        { ok: false, error: "Este pedido já está sendo editado. Aguarde a edição atual terminar." },
        { status: 409 }
      );
    }

    const { pedido: atualizado, editSessionId, editExpiresAt } = resultado;
    return NextResponse.json({
      ok: true,
      editSessionId,
      revision: atualizado.revision ?? 1,
      editExpiresAt,
      pedido: {
        id: atualizado.id,
        numero: atualizado.numero,
        cliente: atualizado.cliente,
        telefone: atualizado.telefone,
        itens: atualizado.itens,
        itensDetalhados: atualizado.itensDetalhados || null,
        total: atualizado.total,
        tipoEntrega: atualizado.tipoEntrega,
        bairro: atualizado.bairro,
        rua: atualizado.rua,
        enderecoNumero: atualizado.enderecoNumero,
        referencia: atualizado.referencia,
        endereco: atualizado.endereco,
        pagamento: atualizado.pagamento,
        troco: atualizado.troco,
        observacao: atualizado.observacao,
      },
    });
  } finally {
    await liberarMutexEdicao(id, mutexToken);
  }
}
