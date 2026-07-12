// Lógica pura da área "Meus pedidos" do cliente (/cliente/pedidos) — extraída
// da API e da tela para ser testável sem depender de Redis/DOM. Nada aqui
// decide autenticação (isso é `clienteAuth.ts`/`clientes.ts`); este arquivo só
// sabe filtrar/ordenar/sanitizar/buscar a partir de dados já carregados.

import { sanitizeTelefoneCliente } from "./clientes";

// ==================== Tipos ====================

// Formato mínimo do pedido como vem do Redis (chave "pedidos") — só os campos
// que esta área usa. O tipo completo (com Pix, tokens etc.) vive em cada rota
// que já o define; aqui não reexportamos nada sensível.
export type PedidoClienteFonte = {
  id: string;
  clienteId?: string;
  telefone?: string;
  numero?: number;
  cliente?: string;
  data?: string;
  horario?: string;
  total?: number;
  status?: string;
  tipoEntrega?: string;
  itens?: string[];
  pagamento?: string;
  bairro?: string;
  isArchived?: boolean;
};

// Resumo público retornado pela API — nunca inclui telefone, clienteId,
// tokens ou metadados internos.
export type PedidoClienteResumo = {
  id: string;
  numero?: number;
  cliente?: string;
  data?: string;
  horario?: string;
  total: number;
  status: string;
  tipoEntrega?: string;
  itens: string[];
  pagamento?: string;
  bairro?: string;
  isArchived?: boolean;
};

// ==================== Propriedade / dedupe ====================

// Um pedido pertence ao cliente autenticado se:
// - o clienteId bate diretamente (pedidos criados depois da Área do Cliente); ou
// - não tem clienteId (pedido antigo, anterior à Área do Cliente) mas o
//   telefone normalizado bate com o telefone já verificado por OTP.
// Nunca decide pertencimento por um dado vindo do navegador — telefone e
// clienteId aqui sempre vêm do payload do token já validado no servidor.
export function pedidoPertenceAoCliente(
  pedido: PedidoClienteFonte,
  clienteId: string,
  telefoneVerificado: string
): boolean {
  if (pedido.clienteId) return pedido.clienteId === clienteId;
  if (!pedido.telefone) return false;
  return sanitizeTelefoneCliente(pedido.telefone) === telefoneVerificado;
}

export function filtrarPedidosDoCliente(
  pedidos: PedidoClienteFonte[],
  clienteId: string,
  telefoneVerificado: string
): PedidoClienteFonte[] {
  const vistos = new Set<string>();
  const resultado: PedidoClienteFonte[] = [];
  for (const p of pedidos) {
    if (!p || !p.id) continue;
    if (vistos.has(p.id)) continue;
    if (!pedidoPertenceAoCliente(p, clienteId, telefoneVerificado)) continue;
    vistos.add(p.id);
    resultado.push(p);
  }
  return resultado;
}

// ==================== Ordenação ====================

// O id de todo pedido criado pelo app é `Date.now().toString()` (timestamp em
// ms) — por isso é o critério primário de ordenação. Quando o id não é
// puramente numérico (defensivo, nunca deveria acontecer com os fluxos atuais
// de criação), cai para data+horario (pt-BR) como fallback seguro; se nem
// isso der para interpretar, o pedido vai para o fim sem quebrar a ordenação
// dos demais.
export function timestampOrdenacaoPedido(p: PedidoClienteFonte): number {
  if (/^\d+$/.test(p.id)) return Number(p.id);

  if (p.data && p.horario) {
    const m = p.data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const h = p.horario.match(/^(\d{2}):(\d{2})$/);
    if (m && h) {
      const [, dd, mm, yyyy] = m;
      const [, hh, min] = h;
      const t = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min)).getTime();
      if (!Number.isNaN(t)) return t;
    }
  }
  return -Infinity;
}

export function ordenarPedidosMaisNovoPrimeiro<T extends PedidoClienteFonte>(pedidos: T[]): T[] {
  return [...pedidos].sort((a, b) => timestampOrdenacaoPedido(b) - timestampOrdenacaoPedido(a));
}

// ==================== Sanitização (fonte -> resumo público) ====================

export function paraResumoPublico(p: PedidoClienteFonte): PedidoClienteResumo {
  return {
    id: p.id,
    ...(p.numero != null ? { numero: p.numero } : {}),
    ...(p.cliente ? { cliente: p.cliente } : {}),
    ...(p.data ? { data: p.data } : {}),
    ...(p.horario ? { horario: p.horario } : {}),
    total: typeof p.total === "number" ? p.total : 0,
    status: p.status ?? "novo",
    ...(p.tipoEntrega ? { tipoEntrega: p.tipoEntrega } : {}),
    itens: Array.isArray(p.itens) ? p.itens : [],
    ...(p.pagamento ? { pagamento: p.pagamento } : {}),
    ...(p.bairro ? { bairro: p.bairro } : {}),
    ...(p.isArchived ? { isArchived: true } : {}),
  };
}

// ==================== Status -> informação visual ====================

export type PedidoStatusCor = "info" | "atencao" | "sucesso" | "neutro" | "perigo";

export type PedidoStatusVisual = {
  label: string;
  descricao: string;
  cor: PedidoStatusCor;
};

// `em_preparo` usa roxo (atenção), nunca amarelo — o amarelo é reservado para
// marca/ação em todo o ChefeBot (ver Skill chefebot-theme: "pendente/atenção
// usa roxo, nunca amarelo").
const STATUS_DELIVERY: Record<string, PedidoStatusVisual> = {
  novo: { label: "Pedido recebido", descricao: "Aguardando a pizzaria confirmar.", cor: "info" },
  em_preparo: { label: "Em preparo", descricao: "Seu pedido está sendo preparado.", cor: "atencao" },
  saiu_entrega: { label: "A caminho", descricao: "Seu pedido está na rua.", cor: "sucesso" },
  entregue: { label: "Entregue", descricao: "Pedido entregue.", cor: "neutro" },
  cancelado: { label: "Cancelado", descricao: "Pedido cancelado.", cor: "perigo" },
};

const STATUS_RETIRADA: Record<string, PedidoStatusVisual> = {
  novo: { label: "Pedido recebido", descricao: "Aguardando a pizzaria confirmar.", cor: "info" },
  em_preparo: { label: "Em preparo", descricao: "Seu pedido está sendo preparado.", cor: "atencao" },
  saiu_entrega: { label: "Pronto para retirada", descricao: "Pode vir buscar.", cor: "sucesso" },
  entregue: { label: "Retirado", descricao: "Pedido retirado.", cor: "neutro" },
  cancelado: { label: "Cancelado", descricao: "Pedido cancelado.", cor: "perigo" },
};

const STATUS_DINE_IN: Record<string, PedidoStatusVisual> = {
  novo: { label: "Pedido recebido", descricao: "Aguardando a pizzaria confirmar.", cor: "info" },
  em_preparo: { label: "Em preparo", descricao: "Seu pedido está sendo preparado.", cor: "atencao" },
  saiu_entrega: { label: "Pronto para servir", descricao: "Seu pedido está pronto.", cor: "sucesso" },
  entregue: { label: "Finalizado", descricao: "Pedido finalizado.", cor: "neutro" },
  cancelado: { label: "Cancelado", descricao: "Pedido cancelado.", cor: "perigo" },
};

// Status desconhecido nunca quebra a tela: cai num rótulo neutro usando o
// próprio valor técnico em vez de lançar erro.
export function statusVisualPedido(status: string, tipoEntrega?: string): PedidoStatusVisual {
  const mapa = tipoEntrega === "retirada" ? STATUS_RETIRADA : tipoEntrega === "dine_in" ? STATUS_DINE_IN : STATUS_DELIVERY;
  return mapa[status] ?? { label: status || "Status desconhecido", descricao: "", cor: "neutro" };
}

const TIPO_ENTREGA_LABEL: Record<string, string> = {
  delivery: "Entrega",
  retirada: "Retirada",
  dine_in: "Consumo no local",
};

export function tipoEntregaLabel(tipoEntrega?: string): string {
  if (!tipoEntrega) return "Entrega";
  return TIPO_ENTREGA_LABEL[tipoEntrega] ?? tipoEntrega;
}

// ==================== Busca ====================

// Normaliza para comparação: minúsculas, sem acento, "#" removido, "." vira
// "," (unifica separador de valor monetário: "45.90" e "45,90" comparam
// igual), pontuação vira espaço, espaços colapsados.
export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/#/g, "")
    .replace(/\./g, ",")
    .replace(/[^a-z0-9À-ÿ,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function money(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

// Monta uma única string pesquisável com todo campo público do resumo — nunca
// inclui id bruto sozinho sem contexto de token interno (o id em si é público
// aqui, usado só para navegação, nunca é um segredo).
export function campoBuscavelPedido(p: PedidoClienteResumo): string {
  const partes = [
    p.numero != null ? String(p.numero) : "",
    p.numero != null ? `#${p.numero}` : "",
    p.id,
    p.cliente ?? "",
    ...(p.itens ?? []),
    p.status,
    statusVisualPedido(p.status, p.tipoEntrega).label,
    p.data ?? "",
    p.horario ?? "",
    money(p.total),
    String(p.total),
    tipoEntregaLabel(p.tipoEntrega),
    p.pagamento ?? "",
    p.bairro ?? "",
  ];
  return normalizarBusca(partes.join(" "));
}

export function filtrarPedidosPorBusca(pedidos: PedidoClienteResumo[], termo: string): PedidoClienteResumo[] {
  const alvo = normalizarBusca(termo);
  if (!alvo) return pedidos;
  return pedidos.filter((p) => campoBuscavelPedido(p).includes(alvo));
}

// ==================== Login com retorno seguro ====================

// Allowlist explícita de destinos internos aceitos no parâmetro `next` do
// login da Área do Cliente — nunca aceitar URL externa/absoluta/protocol-
// relative aqui, para nunca virar open redirect.
const DESTINOS_NEXT_PERMITIDOS = ["/cliente/pedidos"] as const;

export function destinoNextPermitido(next: string | null | undefined): string | null {
  if (!next) return null;
  return (DESTINOS_NEXT_PERMITIDOS as readonly string[]).includes(next) ? next : null;
}
