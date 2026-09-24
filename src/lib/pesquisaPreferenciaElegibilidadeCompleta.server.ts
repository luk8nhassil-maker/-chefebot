import { derivarClienteIdPorTelefone } from "./fidelidade";
import {
  avaliarElegibilidadeContatoPesquisa,
  type ContextoSupressaoPesquisa,
  type ResultadoElegibilidadeContatoPesquisa,
} from "./pesquisaPreferenciaContato";
import {
  listarContatosPesquisaPorTelefone,
  type ContatoPesquisaPersistido,
} from "./pesquisaPreferenciaContatosRedis";
import { clienteTemOptOutPesquisa } from "./pesquisaPreferenciaOptOutRedis";
import { clienteTemPesquisaPendente } from "./pesquisaPreferenciaRespostaRedis";
import { redis } from "./redis";

/**
 * O ledger de contatos começou prospectivamente no merge do PR #439.
 * Pedidos terminais sem exposição registrada recebem um contato potencial
 * conservador no gate durante a janela de 90 dias. Nada é escrito como backfill.
 */
export const CONTATOS_PESQUISA_PROSPECTIVOS_DESDE_MS =
  Date.parse("2026-09-24T21:58:50.000Z");

type PedidoPesquisaOperacional = {
  id?: string;
  telefone?: string;
  status?: string;
  statusAtualizadoEm?: string;
  origem?: string;
  whatsappVinculado?: boolean;
  pagamento?: string;
  pixConfirmado?: boolean;
  pix?: { status?: string } | null;
  entregaProblema?: unknown;
  escalonado?: boolean;
};

type SessaoWhatsappPesquisa = {
  step?: string;
};

export type SinaisControladosPesquisa = {
  /**
   * O checkout web ainda é client-side e não possui heartbeat server-side.
   * No primeiro piloto, esta confirmação humana fecha somente essa lacuna.
   */
  checkoutWebEmAndamento?: boolean;
  /**
   * Não existe hoje um domínio genérico de disputa/estorno aberto no ChefeBot.
   * O piloto exige confirmação explícita desta fonte externa.
   */
  disputaOuEstornoExternoAberto?: boolean;
};

export type DiagnosticoElegibilidadePesquisa = {
  fontesOperacionaisCompletas: boolean;
  pedidosCorrespondentes: number;
  contatosPersistidos: number;
  contatosBootstrapConservador: number;
  identidadeConfirmada: boolean;
  checkoutWhatsappEmAndamento: boolean;
  checkoutWebSinalInformado: boolean;
  disputaExternaSinalInformado: boolean;
  botAtivo: boolean;
  atendimentoManualAtivo: boolean;
};

export type ResultadoElegibilidadePesquisaCompleta = {
  elegibilidade: ResultadoElegibilidadeContatoPesquisa;
  diagnostico: DiagnosticoElegibilidadePesquisa;
};

function clienteIdDoPedido(pedido: PedidoPesquisaOperacional): string | undefined {
  return derivarClienteIdPorTelefone(pedido.telefone);
}

function statusAtivo(status?: string): boolean {
  return status === "novo" || status === "em_preparo" || status === "saiu_entrega";
}

function statusTerminal(status?: string): boolean {
  return status === "entregue" || status === "cancelado";
}

function pedidoTemPix(pedido: PedidoPesquisaOperacional): boolean {
  return /\bpix\b/i.test(String(pedido.pagamento || "")) || !!pedido.pix;
}

function pedidoPixConfirmado(pedido: PedidoPesquisaOperacional): boolean {
  return pedido.pixConfirmado === true || pedido.pix?.status === "confirmado";
}

function timestampContatoPotencialPreLedger(
  pedido: PedidoPesquisaOperacional
): number | null {
  const statusAtualizado = Date.parse(String(pedido.statusAtualizadoEm || ""));
  if (Number.isFinite(statusAtualizado) && statusAtualizado > 0) {
    // Depois do início prospectivo, ausência de exposição significa ausência
    // de envio confirmado. O ledger já é a fonte da verdade e não deve ser
    // substituído por uma suposição conservadora.
    if (statusAtualizado >= CONTATOS_PESQUISA_PROSPECTIVOS_DESDE_MS) {
      return null;
    }
    return statusAtualizado;
  }

  // Pedido legado sem carimbo confiável: só aqui usamos o instante
  // imediatamente anterior ao início prospectivo. Isso protege a lacuna
  // histórica sem contaminar o período em que já existe telemetria confiável.
  return CONTATOS_PESQUISA_PROSPECTIVOS_DESDE_MS - 1;
}

export function montarContatosBootstrapConservador(params: {
  pedidos: readonly PedidoPesquisaOperacional[];
  clienteId: string;
  historicoPersistido: readonly ContatoPesquisaPersistido[];
  agoraMs: number;
}): Array<Pick<ContatoPesquisaPersistido, "sentAtMs">> {
  const exatos = new Set(
    params.historicoPersistido
      .filter((contato) => contato.origem === "avaliacao_pos_entrega")
      .map((contato) => contato.eventId)
  );
  const inicio90 = params.agoraMs - 90 * 24 * 60 * 60 * 1000;

  return params.pedidos
    .filter((pedido) => {
      if (!pedido.id || exatos.has(pedido.id)) return false;
      if (!statusTerminal(pedido.status)) return false;
      return clienteIdDoPedido(pedido) === params.clienteId;
    })
    .map((pedido) => timestampContatoPotencialPreLedger(pedido))
    .filter((sentAtMs): sentAtMs is number => sentAtMs !== null)
    .map((sentAtMs) => ({ sentAtMs }))
    .filter(
      (contato) =>
        contato.sentAtMs > inicio90 && contato.sentAtMs <= params.agoraMs
    );
}

function identidadeConfirmadaPorFonteReal(params: {
  pedidos: readonly PedidoPesquisaOperacional[];
  clienteId: string;
  historicoPersistido: readonly ContatoPesquisaPersistido[];
}): boolean {
  // Um outbound já confirmado pelo provider comprova que esta identidade
  // canônica já foi usada com sucesso pelo canal.
  if (params.historicoPersistido.length > 0) return true;

  // Para primeiro contato, exige origem de WhatsApp real ou link de cardápio
  // vinculado pelo token do WhatsApp. Telefone apenas digitado no checkout
  // não é promovido a "identidade confirmada" para pesquisa.
  return params.pedidos.some(
    (pedido) =>
      clienteIdDoPedido(pedido) === params.clienteId &&
      (pedido.origem === "whatsapp" || pedido.whatsappVinculado === true)
  );
}

function sessaoWhatsappEmAndamento(sessao: SessaoWhatsappPesquisa | null): boolean {
  if (!sessao) return false;
  return sessao.step !== "done";
}

function contextoFalhaTecnica(): ContextoSupressaoPesquisa {
  return {
    fontesOperacionaisCompletas: false,
    falhaTecnica: true,
    identidadeIncerta: true,
  };
}

/**
 * Gate server-side completo para o primeiro piloto controlado.
 *
 * Leitura apenas. Não envia WhatsApp, não altera pedido/Pix/fidelidade e não
 * grava Redis. As duas fontes que ainda não existem de forma automática
 * (checkout web e disputa externa) precisam ser informadas explicitamente no
 * piloto; se forem omitidas, o gate permanece fail-closed.
 */
export async function avaliarElegibilidadeContatoPesquisaCompleta(params: {
  telefone?: string;
  agoraMs?: number;
  sinaisControlados?: SinaisControladosPesquisa;
}): Promise<ResultadoElegibilidadePesquisaCompleta> {
  const agoraMs = params.agoraMs ?? Date.now();
  const clienteId = derivarClienteIdPorTelefone(params.telefone);

  if (!clienteId) {
    const elegibilidade = avaliarElegibilidadeContatoPesquisa({
      agoraMs,
      contexto: {
        fontesOperacionaisCompletas: false,
        identidadeIncerta: true,
      },
      historicoContatos: [],
    });
    return {
      elegibilidade,
      diagnostico: {
        fontesOperacionaisCompletas: false,
        pedidosCorrespondentes: 0,
        contatosPersistidos: 0,
        contatosBootstrapConservador: 0,
        identidadeConfirmada: false,
        checkoutWhatsappEmAndamento: false,
        checkoutWebSinalInformado:
          typeof params.sinaisControlados?.checkoutWebEmAndamento === "boolean",
        disputaExternaSinalInformado:
          typeof params.sinaisControlados?.disputaOuEstornoExternoAberto ===
          "boolean",
        botAtivo: false,
        atendimentoManualAtivo: false,
      },
    };
  }

  try {
    const telefoneCanonico = clienteId.slice("cli_".length);
    const [
      pedidos,
      sessaoWhatsapp,
      botAtivo,
      atendimentoManualAtivo,
      optOut,
      pesquisaPendente,
      historicoPersistido,
    ] = await Promise.all([
      redis.get<PedidoPesquisaOperacional[]>("pedidos"),
      redis.get<SessaoWhatsappPesquisa>(`session:${telefoneCanonico}`),
      redis.get<boolean>("bot_ativo"),
      redis.get<boolean>(`manual:${telefoneCanonico}`),
      clienteTemOptOutPesquisa(params.telefone),
      clienteTemPesquisaPendente(params.telefone),
      listarContatosPesquisaPorTelefone({
        telefone: params.telefone,
        agoraMs,
      }),
    ]);

    const todosPedidos = pedidos || [];
    const pedidosCorrespondentes = todosPedidos.filter(
      (pedido) => clienteIdDoPedido(pedido) === clienteId
    );
    const ativos = pedidosCorrespondentes.filter((pedido) =>
      statusAtivo(pedido.status)
    );
    const checkoutWhatsappEmAndamento =
      sessaoWhatsappEmAndamento(sessaoWhatsapp);
    const checkoutWebSinalInformado =
      typeof params.sinaisControlados?.checkoutWebEmAndamento === "boolean";
    const disputaExternaSinalInformado =
      typeof params.sinaisControlados?.disputaOuEstornoExternoAberto ===
      "boolean";

    const bootstrap = montarContatosBootstrapConservador({
      pedidos: todosPedidos,
      clienteId,
      historicoPersistido,
      agoraMs,
    });
    const identidadeConfirmada = identidadeConfirmadaPorFonteReal({
      pedidos: pedidosCorrespondentes,
      clienteId,
      historicoPersistido,
    });

    const contexto: ContextoSupressaoPesquisa = {
      fontesOperacionaisCompletas:
        checkoutWebSinalInformado && disputaExternaSinalInformado,
      checkoutEmAndamento:
        checkoutWhatsappEmAndamento ||
        params.sinaisControlados?.checkoutWebEmAndamento === true,
      pesquisaPendenteResposta: pesquisaPendente,
      pagamentoPendente: ativos.some(
        (pedido) => pedidoTemPix(pedido) && !pedidoPixConfirmado(pedido)
      ),
      pedidoEmProducaoOuEntrega: ativos.length > 0,
      atendimentoHumanoOuBotPausado:
        botAtivo === false || atendimentoManualAtivo === true,
      problemaAberto: ativos.some(
        (pedido) => !!pedido.entregaProblema || pedido.escalonado === true
      ),
      disputaOuEstornoAberto:
        params.sinaisControlados?.disputaOuEstornoExternoAberto === true,
      optOut,
      identidadeIncerta: !identidadeConfirmada,
    };

    const elegibilidade = avaliarElegibilidadeContatoPesquisa({
      agoraMs,
      contexto,
      historicoContatos: [...historicoPersistido, ...bootstrap],
    });

    return {
      elegibilidade,
      diagnostico: {
        fontesOperacionaisCompletas: contexto.fontesOperacionaisCompletas === true,
        pedidosCorrespondentes: pedidosCorrespondentes.length,
        contatosPersistidos: historicoPersistido.length,
        contatosBootstrapConservador: bootstrap.length,
        identidadeConfirmada,
        checkoutWhatsappEmAndamento,
        checkoutWebSinalInformado,
        disputaExternaSinalInformado,
        botAtivo: botAtivo !== false,
        atendimentoManualAtivo: atendimentoManualAtivo === true,
      },
    };
  } catch {
    const elegibilidade = avaliarElegibilidadeContatoPesquisa({
      agoraMs,
      contexto: contextoFalhaTecnica(),
      historicoContatos: [],
    });
    return {
      elegibilidade,
      diagnostico: {
        fontesOperacionaisCompletas: false,
        pedidosCorrespondentes: 0,
        contatosPersistidos: 0,
        contatosBootstrapConservador: 0,
        identidadeConfirmada: false,
        checkoutWhatsappEmAndamento: false,
        checkoutWebSinalInformado:
          typeof params.sinaisControlados?.checkoutWebEmAndamento === "boolean",
        disputaExternaSinalInformado:
          typeof params.sinaisControlados?.disputaOuEstornoExternoAberto ===
          "boolean",
        botAtivo: false,
        atendimentoManualAtivo: false,
      },
    };
  }
}
