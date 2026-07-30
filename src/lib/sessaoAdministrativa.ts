// Sessão administrativa — reconhecimento de que uma requisição veio de alguém
// autenticado no painel, e NUNCA de um campo enviado pelo cliente.
//
// Existe porque duas decisões da rota de criação de pedido dependem disso:
//
//  1. a ORIGEM gravada no pedido ("painel" x "site");
//  2. a proteção de idempotência do pedido administrativo, que fica ativa por
//     sessão em vez de depender da flag global do Modo Sobrevivência.
//
// Regra inegociável: a única prova aceita é o cookie de autenticação
// verificado no servidor. Um campo do corpo da requisição (`origemAdmin`,
// `origem`, cabeçalho customizado) jamais é consultado — se fosse, qualquer
// visitante do cardápio público poderia se declarar atendente.

import { verifyToken } from "./auth";

export const COOKIE_AUTH = "auth-token";

/** Papéis que operam o painel. `entregador` e `contador` NÃO criam pedido. */
export const PAPEIS_ADMINISTRATIVOS = ["admin", "atendente", "dev"] as const;
export type PapelAdministrativo = (typeof PAPEIS_ADMINISTRATIVOS)[number];

export type SessaoAdministrativa = {
  username: string;
  nome: string;
  role: PapelAdministrativo;
};

/** Origem gravada no pedido. Conjunto fechado, decidido só no servidor. */
export const ORIGEM_PAINEL = "painel";
export const ORIGEM_SITE = "site";

export function ehPapelAdministrativo(role: unknown): role is PapelAdministrativo {
  return typeof role === "string" && (PAPEIS_ADMINISTRATIVOS as readonly string[]).includes(role);
}

/** Forma mínima da requisição — só o que este módulo precisa ler. */
type RequisicaoComCookies = {
  cookies?: { get?: (nome: string) => { value?: string } | undefined };
};

/**
 * Devolve a sessão administrativa da requisição, ou `null`.
 *
 * Nunca lança: token ausente, malformado, expirado, de papel não
 * administrativo ou requisição sem suporte a cookies resultam todos em `null`
 * — e `null` significa exatamente "trate como público", que é a direção
 * segura do erro (na dúvida, menos privilégio, nunca mais).
 */
export async function lerSessaoAdministrativa(
  req: RequisicaoComCookies | null | undefined
): Promise<SessaoAdministrativa | null> {
  try {
    const token = req?.cookies?.get?.(COOKIE_AUTH)?.value;
    if (!token || typeof token !== "string") return null;

    const payload = await verifyToken(token);
    if (!payload || !ehPapelAdministrativo(payload.role)) return null;

    return {
      username: typeof payload.username === "string" ? payload.username : "",
      nome: typeof payload.name === "string" ? payload.name : "",
      role: payload.role,
    };
  } catch {
    // Verificação indisponível ou token corrompido: público.
    return null;
  }
}

/** Origem canônica do pedido a partir da sessão — nunca do corpo. */
export function origemDoPedido(sessao: SessaoAdministrativa | null): string {
  return sessao ? ORIGEM_PAINEL : ORIGEM_SITE;
}

/** `true` para pedidos criados de dentro do painel (inclui rótulo do painel). */
export function ehOrigemAdministrativa(origem: unknown): boolean {
  return origem === ORIGEM_PAINEL;
}
