import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
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
import { escreverPedidosCercado, executarComLockPedidos } from "@/lib/pedidosStore";

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

  const mutexToken = await adquirirMutexEdicao(id);
  if (!mutexToken) {
    return NextResponse.json({ ok: false, error: "Não foi possível iniciar a edição agora. Tente de novo." }, { status: 409 });
  }

  type ResultadoIniciar =
    | { ok: false; status: number; error: string }
    | { ok: true; editSessionId: string; revision: number; editExpiresAt: string; pedido: PedidoRedis };

  try {
    // Seção crítica roda sob o lock global do módulo central (além do mutex
    // por pedido já adquirido acima) — protege contra corrida com QUALQUER
    // outro writer de "pedidos" (painel, WhatsApp, webhooks), não só com
    // outra sessão de edição do MESMO pedido.
    const resultadoLock = await executarComLockPedidos<ResultadoIniciar>(async (token) => {
      const pedidos = (await redis.get<PedidoRedis[]>("pedidos")) || [];
      const index = pedidos.findIndex((p) => p.id === id);
      if (index < 0 || !tokensIguais(pedidos[index].statusToken, statusToken)) {
        return { ok: false, status: 404, error: "Pedido não encontrado" };
      }

      let pedido = pedidos[index];
      const limpeza = limparEdicaoExpiradaSeNecessario(pedido);
      if (limpeza.mudou) pedido = limpeza.pedido;

      // Limpeza best-effort do lock expirado: cercada (fenced) pelo token —
      // se o lock já não for mais nosso, a escrita é recusada em vez de
      // sobrescrever silenciosamente uma execução mais nova. Nunca impede a
      // resposta de erro abaixo (a limpeza é só otimização, não requisito).
      const gravarLimpezaSeNecessario = async () => {
        if (!limpeza.mudou) return true;
        pedidos[index] = pedido;
        const escrita = await escreverPedidosCercado(token, pedidos);
        return escrita !== "lock_perdido";
      };

      if (!pedidoAguardandoAceite(pedido)) {
        await gravarLimpezaSeNecessario();
        return { ok: false, status: 409, error: "Este pedido acabou de ser aceito pela loja e não pode mais ser alterado." };
      }

      if (pagamentoJaConfirmado(pedido)) {
        await gravarLimpezaSeNecessario();
        return { ok: false, status: 409, error: "O pagamento deste pedido já foi confirmado. Para alterar o pedido, fale diretamente com a loja." };
      }

      if (lockEdicaoAtivo(pedido)) {
        await gravarLimpezaSeNecessario();
        return { ok: false, status: 409, error: "Este pedido já está sendo editado. Aguarde a edição atual terminar." };
      }

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
      pedidos[index] = atualizado;
      const escritaFinal = await escreverPedidosCercado(token, pedidos);
      if (escritaFinal === "lock_perdido") {
        return { ok: false, status: 409, error: "Não foi possível iniciar a edição agora. Tente de novo." };
      }

      return { ok: true, editSessionId, revision: atualizado.revision ?? 1, editExpiresAt, pedido: atualizado };
    });

    if (resultadoLock.tipo !== "sucesso") {
      return NextResponse.json({ ok: false, error: "Não foi possível iniciar a edição agora. Tente de novo." }, { status: 409 });
    }
    const resultado = resultadoLock.valor;
    if (!resultado.ok) {
      return NextResponse.json({ ok: false, error: resultado.error }, { status: resultado.status });
    }

    const atualizado = resultado.pedido;
    return NextResponse.json({
      ok: true,
      editSessionId: resultado.editSessionId,
      revision: resultado.revision,
      editExpiresAt: resultado.editExpiresAt,
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
