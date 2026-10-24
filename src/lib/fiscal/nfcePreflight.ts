import type { PedidoSnapshotOficial } from "@/lib/pedidoSnapshot";

/**
 * Pré-conferência fiscal de LEITURA, sem criar nota e sem modificar pedidos.
 * Uma NFC-e exige classificação tributária aprovada e credenciamento externo.
 * É proibido inferir NCM/CFOP/CST/CSOSN a partir do nome do produto.
 */
export type PedidoParaNfce = {
  id: string;
  status: string;
  total: number;
  pagamento?: string;
  pixConfirmado?: boolean;
  comandaId?: string;
  snapshotOficial?: PedidoSnapshotOficial;
};

export type PreparoNfce = {
  documento: "NFC-e";
  emissor: "Focus NFe";
  podeEmitir: false;
  motivos: string[];
  resumo: {
    pedidoId: string;
    itens: Array<{ nome: string; quantidade: number; totalCentavos: number }>;
    subtotalCentavos: number;
    descontoCentavos: number;
    taxaEntregaCentavos: number;
    totalCentavos: number;
  } | null;
};

const dinheiroValido = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

export function prepararNfce(
  pedido: PedidoParaNfce,
  emissorConfigurado: boolean,
): PreparoNfce {
  const motivos: string[] = [];
  const snapshot = pedido.snapshotOficial;
  let resumo: PreparoNfce["resumo"] = null;

  if (pedido.status === "cancelado") motivos.push("Pedido cancelado: emissão indisponível.");
  else if (pedido.status !== "entregue") motivos.push("Conclua o pedido antes de preparar a nota.");

  if (pedido.comandaId || snapshot?.entrega?.tipo === "dine_in")
    motivos.push("Consumo no Salão exige conferir a conta inteira, não cada rodada separadamente.");

  if (/pix/i.test(pedido.pagamento ?? "") && pedido.pixConfirmado !== true)
    motivos.push("Pagamento Pix ainda sem confirmação registrada.");

  if (!emissorConfigurado)
    motivos.push("Emissor fiscal ainda não configurado para este estabelecimento.");

  if (!snapshot || !Array.isArray(snapshot.itens) || snapshot.itens.length === 0) {
    motivos.push("Pedido sem composição estruturada confiável para a nota.");
  } else {
    const valores = [
      snapshot.subtotalCents, snapshot.descontoFidelidadeCents,
      snapshot.taxaEntregaCents, snapshot.totalCents,
    ];
    const itensValidos = snapshot.itens.every(item =>
      typeof item.nome === "string" && item.nome.trim().length > 0 &&
      Number.isSafeInteger(item.quantidade) && item.quantidade > 0 &&
      dinheiroValido(item.precoUnitarioCents) && dinheiroValido(item.totalCents) &&
      item.totalCents === item.quantidade * item.precoUnitarioCents
    );
    const somaItens = snapshot.itens.reduce((soma, item) => soma + item.totalCents, 0);
    const totalPedidoCentavos = Number.isFinite(pedido.total) ? Math.round(pedido.total * 100) : -1;

    if (!valores.every(dinheiroValido) || !itensValidos ||
      !Number.isSafeInteger(somaItens) ||
      somaItens !== snapshot.subtotalCents ||
      snapshot.subtotalCents - snapshot.descontoFidelidadeCents + snapshot.taxaEntregaCents !== snapshot.totalCents ||
      totalPedidoCentavos !== snapshot.totalCents) {
      motivos.push("Totais divergentes ou inválidos: não é seguro preparar a emissão.");
    } else {
      resumo = {
        pedidoId: pedido.id,
        itens: snapshot.itens.map(item => ({
          nome: item.nome, quantidade: item.quantidade, totalCentavos: item.totalCents,
        })),
        subtotalCentavos: snapshot.subtotalCents,
        descontoCentavos: snapshot.descontoFidelidadeCents,
        taxaEntregaCentavos: snapshot.taxaEntregaCents,
        totalCentavos: snapshot.totalCents,
      };
    }
    if (snapshot.itens.some(item => !item.selecao)) {
      motivos.push("Há produtos sem identificação estruturada para classificação fiscal.");
    }
    if (snapshot.descontoFidelidadeCents > 0 || snapshot.taxaEntregaCents > 0)
      motivos.push("Desconto ou entrega exigem tratamento fiscal revisado pelo contador.");
  }

  // Ausentes na main: classificação NCM/CFOP/CST/CSOSN por item,
  // credenciamento SEFAZ/MA, certificado A1/CSC e aceite de homologação.
  // Não há caminho alternativo de emissão por PDF, cupom ou browser.
  motivos.push("Classificação fiscal e credenciamento precisam ser validados pelo contador e SEFAZ/MA.");
  motivos.push("Emissão real permanecerá desativada até homologação fiscal e autorização de operação.");

  return { documento: "NFC-e", emissor: "Focus NFe", podeEmitir: false, motivos, resumo };
}
