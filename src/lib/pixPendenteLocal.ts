// Referência mínima do "Pix pendente" persistida no navegador (Etapa 2 do
// fluxo de retomada). Guarda só o suficiente para localizar o pedido no
// backend — nunca QR Code, copia-e-cola, chave Pix ou qualquer valor vindo
// da metadata de pagamento. O backend é sempre a fonte da verdade: esta
// referência só serve como candidato a ser confirmado via
// GET /api/pedido-app/pagamento-pix, nunca como prova de pendência por si só.

export const PIX_PENDENTE_KEY = "cf_pix_pendente";

export type ReferenciaPixPendente = {
  pedidoId: string;
  statusToken: string;
  numero?: number;
  createdAt: number;
};

type ReferenciaRaw = {
  pedidoId?: unknown;
  statusToken?: unknown;
  numero?: unknown;
  createdAt?: unknown;
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function lerReferenciaPixPendente(raw: string | null): ReferenciaPixPendente | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ReferenciaRaw;
    if (!parsed || typeof parsed.pedidoId !== "string" || !parsed.pedidoId) return null;
    if (typeof parsed.statusToken !== "string" || !parsed.statusToken) return null;
    if (typeof parsed.createdAt !== "number") return null;
    return {
      pedidoId: parsed.pedidoId,
      statusToken: parsed.statusToken,
      ...(typeof parsed.numero === "number" ? { numero: parsed.numero } : {}),
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

export function lerReferenciaPixPendenteDoStorage(storage: StorageLike): ReferenciaPixPendente | null {
  try {
    return lerReferenciaPixPendente(storage.getItem(PIX_PENDENTE_KEY));
  } catch {
    return null;
  }
}

export function salvarReferenciaPixPendente(
  storage: StorageLike,
  ref: { pedidoId: string; statusToken: string; numero?: number }
): void {
  try {
    const registro: ReferenciaPixPendente = {
      pedidoId: ref.pedidoId,
      statusToken: ref.statusToken,
      ...(typeof ref.numero === "number" ? { numero: ref.numero } : {}),
      createdAt: Date.now(),
    };
    storage.setItem(PIX_PENDENTE_KEY, JSON.stringify(registro));
  } catch {
    // Armazenamento indisponível (modo privado, quota) — a barra global
    // simplesmente não aparece; nunca impede o fluxo de pagamento em si.
  }
}

export function limparReferenciaPixPendente(storage: StorageLike): void {
  try {
    storage.removeItem(PIX_PENDENTE_KEY);
  } catch {}
}

export type EstadoPagamentoPixResposta = "aguardando" | "confirmado" | "em_analise" | "indisponivel" | undefined;

// Regra central de quando a referência local deixa de valer — usada pelo
// hook usePixPendente (src/components/PixPendenteBar.tsx) depois de
// confirmar o estado real no backend via GET /api/pedido-app/pagamento-pix.
// "em_analise" (comprovante em avaliação) NÃO limpa: ainda não é uma
// pendência encerrada, só deixa de mostrar a barra "Pix pendente".
export function deveLimparReferenciaPixPendente(estado: EstadoPagamentoPixResposta): boolean {
  return estado === "confirmado" || estado === "indisponivel";
}

export type PixPendenteResolvido = {
  pedidoId: string;
  statusToken: string;
  numero?: number;
  /** Valor efetivamente pendente no Pix — vem só de `valorPix` (backend,
   * derivado de `pixCliente.valorEsperado`). Em pedido misto é a parcela do
   * Pix, nunca o total do pedido; em Pix integral, coincide com o total. */
  valorPix: number;
};

export type RespostaPagamentoPixSimplificada = {
  estado?: EstadoPagamentoPixResposta;
  numero?: number;
  valorPix?: number;
};

// Regra pura central do hook usePixPendente (src/components/PixPendenteBar.tsx):
// decide, a partir da referência local + resposta do backend, se a barra
// "Pix pendente" deve aparecer e se a referência local deve ser apagada.
// `resposta === null` representa token inválido/pedido não encontrado
// (404) — nunca mostra a barra e sempre limpa a referência.
export function resolverPixPendenteAPartirDaResposta(
  ref: { pedidoId: string; statusToken: string; numero?: number },
  resposta: RespostaPagamentoPixSimplificada | null
): { pendente: PixPendenteResolvido | null; deveLimpar: boolean } {
  if (!resposta) {
    return { pendente: null, deveLimpar: true };
  }
  if (resposta.estado === "aguardando" && typeof resposta.valorPix === "number") {
    return {
      pendente: {
        pedidoId: ref.pedidoId,
        statusToken: ref.statusToken,
        numero: resposta.numero ?? ref.numero,
        valorPix: resposta.valorPix,
      },
      deveLimpar: false,
    };
  }
  return { pendente: null, deveLimpar: deveLimparReferenciaPixPendente(resposta.estado) };
}

// Se existir mais de uma referência local válida (não deveria, hoje só
// gravamos uma por vez), a regra desta etapa é priorizar a mais recente —
// como só mantemos uma chave, isso já é garantido por sobrescrever sempre
// em salvarReferenciaPixPendente. Função exposta só para deixar a regra
// explícita e testável caso o formato evolua para lista no futuro.
export function maisRecente(refs: ReferenciaPixPendente[]): ReferenciaPixPendente | null {
  if (refs.length === 0) return null;
  return refs.reduce((mais, atual) => (atual.createdAt > mais.createdAt ? atual : mais));
}
