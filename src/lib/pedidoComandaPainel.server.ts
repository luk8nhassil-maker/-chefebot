export type RodadaComandaPainel = {
  numero: number;
  pedidoId?: string;
};

export type ComandaPainelVinculavel = {
  id: string;
  numero: number;
  mesa?: string;
  complemento?: string;
  pedidoId?: string;
  rodadas?: RodadaComandaPainel[];
};

export type VinculoComandaPainel = {
  comandaId: string;
  comandaNumero: number;
  rodadaNumero: number;
  comandaMesa?: string;
  comandaComplemento?: string;
};

/**
 * Vincula pedidos oficiais do Salão à comanda pela identidade durável já
 * gravada nas rodadas. Não usa nome do cliente, observação nem parsing de
 * texto: dois pedidos só viram "família" quando a própria comanda aponta
 * explicitamente para os respectivos pedidoIds.
 *
 * Comandas antigas, anteriores a `rodadas`, continuam reconhecidas pelo
 * `pedidoId` histórico da Rodada 1. A função é somente leitura e nunca altera
 * pedido/comanda persistidos.
 */
export function enriquecerPedidosComComanda<T extends { id: string }>(
  pedidos: T[],
  comandas: ComandaPainelVinculavel[],
): Array<T & Partial<VinculoComandaPainel>> {
  const vinculos = new Map<string, VinculoComandaPainel>();

  for (const comanda of comandas) {
    const base = {
      comandaId: comanda.id,
      comandaNumero: comanda.numero,
      ...(comanda.mesa ? { comandaMesa: comanda.mesa } : {}),
      ...(comanda.complemento ? { comandaComplemento: comanda.complemento } : {}),
    };

    if (Array.isArray(comanda.rodadas) && comanda.rodadas.length > 0) {
      for (const rodada of comanda.rodadas) {
        if (!rodada.pedidoId) continue;
        vinculos.set(rodada.pedidoId, {
          ...base,
          rodadaNumero: rodada.numero,
        });
      }
      continue;
    }

    if (comanda.pedidoId) {
      vinculos.set(comanda.pedidoId, {
        ...base,
        rodadaNumero: 1,
      });
    }
  }

  return pedidos.map((pedido) => {
    const vinculo = vinculos.get(pedido.id);
    return vinculo ? { ...pedido, ...vinculo } : pedido;
  });
}
