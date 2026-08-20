export type PedidoAgrupavelPainel = {
  id: string;
  numero?: number;
  cliente: string;
  telefone: string;
  status: string;
  bairro?: string;
  pagamento?: string;
  escalonado?: boolean;
  cancelamentoSolicitado?: boolean;
  pixConfirmado?: boolean;
  comandaId?: string;
  comandaNumero?: number;
  rodadaNumero?: number;
  comandaMesa?: string;
  comandaComplemento?: string;
};

export type FiltroPedidosPainel =
  | "todos"
  | "tempo_real"
  | "arquivados"
  | "novo"
  | "em_preparo"
  | "saiu_entrega"
  | "entregue"
  | "cancelado";

const STATUS_BUSCA: Record<string, string> = {
  novo: "novo",
  em_preparo: "fazendo preparo",
  saiu_entrega: "na rua saiu entrega",
  entregue: "entregue pronto",
  cancelado: "cancelado",
};

function prioridade(p: PedidoAgrupavelPainel): number {
  if (p.escalonado) return 0;
  if (p.cancelamentoSolicitado) return 1;
  if (p.status === "novo" && (p.pagamento || "").toLowerCase().includes("pix") && !p.pixConfirmado) return 2;
  if (p.status === "novo") return 3;
  if (p.status === "em_preparo") return 4;
  if (p.status === "saiu_entrega") return 5;
  return 6;
}

function numeroOrdenacao(p: PedidoAgrupavelPainel): number {
  const porNumero = typeof p.numero === "number" ? p.numero : Number.NaN;
  if (Number.isFinite(porNumero)) return porNumero;
  const porId = Number.parseInt(p.id, 10);
  return Number.isFinite(porId) ? porId : Number.MAX_SAFE_INTEGER;
}

function compararOperacional(a: PedidoAgrupavelPainel, b: PedidoAgrupavelPainel): number {
  const pa = prioridade(a);
  const pb = prioridade(b);
  if (pa !== pb) return pa - pb;
  return numeroOrdenacao(a) - numeroOrdenacao(b);
}

function correspondeFiltro(p: PedidoAgrupavelPainel, filtro: FiltroPedidosPainel): boolean {
  return filtro === "todos" || filtro === "tempo_real" || filtro === "arquivados" || p.status === filtro;
}

function correspondeBusca(p: PedidoAgrupavelPainel, buscaNorm: string): boolean {
  if (!buscaNorm) return true;
  const buscaDigitos = buscaNorm.replace(/\D/g, "");
  const numeroPedido = String(p.numero ?? "");
  const numeroComanda = String(p.comandaNumero ?? "");
  const status = STATUS_BUSCA[p.status] || p.status;
  const textoComanda = p.comandaNumero != null ? `comanda ${p.comandaNumero}` : "";
  const textoMesa = p.comandaMesa ? `mesa ${p.comandaMesa}` : "";

  return (
    p.cliente.toLowerCase().includes(buscaNorm) ||
    (!!buscaDigitos && p.telefone.replace(/\D/g, "").includes(buscaDigitos)) ||
    (p.bairro || "").toLowerCase().includes(buscaNorm) ||
    numeroPedido.includes(buscaNorm) ||
    numeroComanda.includes(buscaNorm) ||
    textoComanda.includes(buscaNorm) ||
    textoMesa.toLowerCase().includes(buscaNorm) ||
    (p.comandaComplemento || "").toLowerCase().includes(buscaNorm) ||
    status.includes(buscaNorm) ||
    (p.pagamento || "").toLowerCase().includes(buscaNorm)
  );
}

type Bloco<T> = {
  pedidos: T[];
  indiceOriginal: number;
};

/**
 * A unidade visual do Salão é a comanda, mas cada rodada continua sendo um
 * pedido oficial independente. Uma família aparece inteira quando QUALQUER
 * rodada satisfaz o filtro e QUALQUER rodada satisfaz a busca; assim buscar
 * um número de pedido nunca "desmembra" a comanda no painel.
 *
 * Pedidos sem `comandaId` mantêm exatamente o comportamento individual.
 */
export function selecionarPedidosPainel<T extends PedidoAgrupavelPainel>(
  pedidos: T[],
  filtro: FiltroPedidosPainel,
  busca: string,
): T[] {
  const buscaNorm = busca.toLowerCase().trim();
  const familias = new Map<string, Bloco<T>>();
  const avulsos: Bloco<T>[] = [];

  pedidos.forEach((pedido, indice) => {
    if (pedido.comandaId) {
      const existente = familias.get(pedido.comandaId);
      if (existente) existente.pedidos.push(pedido);
      else familias.set(pedido.comandaId, { pedidos: [pedido], indiceOriginal: indice });
      return;
    }
    avulsos.push({ pedidos: [pedido], indiceOriginal: indice });
  });

  const blocos = [...familias.values(), ...avulsos]
    .filter((bloco) =>
      bloco.pedidos.some((pedido) => correspondeFiltro(pedido, filtro)) &&
      bloco.pedidos.some((pedido) => correspondeBusca(pedido, buscaNorm)),
    )
    .map((bloco) => ({
      ...bloco,
      pedidos: [...bloco.pedidos].sort((a, b) => {
        if (a.comandaId && b.comandaId) {
          const ra = a.rodadaNumero ?? Number.MAX_SAFE_INTEGER;
          const rb = b.rodadaNumero ?? Number.MAX_SAFE_INTEGER;
          if (ra !== rb) return ra - rb;
        }
        return compararOperacional(a, b);
      }),
    }))
    .sort((a, b) => {
      const melhorA = [...a.pedidos].sort(compararOperacional)[0];
      const melhorB = [...b.pedidos].sort(compararOperacional)[0];
      const ordem = compararOperacional(melhorA, melhorB);
      return ordem !== 0 ? ordem : a.indiceOriginal - b.indiceOriginal;
    });

  return blocos.flatMap((bloco) => bloco.pedidos);
}

export function mapearFamiliasVisiveis<T extends PedidoAgrupavelPainel>(pedidos: T[]): Map<string, T[]> {
  const familias = new Map<string, T[]>();
  for (const pedido of pedidos) {
    if (!pedido.comandaId) continue;
    const familia = familias.get(pedido.comandaId) || [];
    familia.push(pedido);
    familias.set(pedido.comandaId, familia);
  }
  return familias;
}
