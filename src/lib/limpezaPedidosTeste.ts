export type RegistroPedidoTeste = {
  id?: unknown;
  numero?: unknown;
  cliente?: unknown;
  total?: unknown;
  status?: unknown;
  telefone?: unknown;
  clienteId?: unknown;
  resgateId?: unknown;
  recompensaJornadaId?: unknown;
  itensJornada?: unknown;
  pizzasCount?: unknown;
};

export type RegistroComandaTeste = {
  id?: unknown;
  numero?: unknown;
  cliente?: unknown;
  status?: unknown;
};

// A limpeza é deliberadamente conservadora: só reconhece a palavra isolada
// "teste" ou "testes" (case-insensitive). Assim "Teste B" e "cliente testes"
// entram, mas nomes reais que apenas contêm a sequência, como "Testemunho",
// ficam de fora.
const PALAVRA_TESTE = /(^|[^\p{L}\p{N}_])testes?($|[^\p{L}\p{N}_])/iu;

export function ehNomeDeTeste(valor: unknown): boolean {
  if (typeof valor !== "string") return false;
  const nome = valor.normalize("NFKC").trim();
  return nome.length > 0 && PALAVRA_TESTE.test(nome);
}

export function selecionarPedidosDeTeste<T extends RegistroPedidoTeste>(pedidos: T[]): T[] {
  return pedidos.filter((pedido) => ehNomeDeTeste(pedido.cliente));
}

export function selecionarComandasDeTeste<T extends RegistroComandaTeste>(comandas: T[]): T[] {
  return comandas.filter((comanda) => ehNomeDeTeste(comanda.cliente));
}

export function totalDosPedidos(pedidos: RegistroPedidoTeste[]): number {
  return pedidos.reduce((soma, pedido) => {
    const total = typeof pedido.total === "number" && Number.isFinite(pedido.total) ? pedido.total : 0;
    return soma + total;
  }, 0);
}

export function faturamentoDosPedidosEntregues(pedidos: RegistroPedidoTeste[]): number {
  return totalDosPedidos(pedidos.filter((pedido) => pedido.status === "entregue"));
}

export function resumirRiscosLaterais(pedidos: RegistroPedidoTeste[]) {
  return {
    comTelefone: pedidos.filter((p) => typeof p.telefone === "string" && p.telefone.trim().length > 0).length,
    comClienteId: pedidos.filter((p) => typeof p.clienteId === "string" && p.clienteId.trim().length > 0).length,
    comResgate: pedidos.filter((p) => typeof p.resgateId === "string" && p.resgateId.trim().length > 0).length,
    comRecompensaJornada: pedidos.filter((p) => typeof p.recompensaJornadaId === "string" && p.recompensaJornadaId.trim().length > 0).length,
    comItensJornada: pedidos.filter((p) => Array.isArray(p.itensJornada) && p.itensJornada.length > 0).length,
    comPizzasFidelidade: pedidos.filter((p) => typeof p.pizzasCount === "number" && p.pizzasCount > 0).length,
  };
}
