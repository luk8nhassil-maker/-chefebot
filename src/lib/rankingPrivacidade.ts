import "server-only";

import { mascararTelefoneExibicao } from "./cardapioToken";
import { buscarClientePorId, normalizarNomeCliente } from "./clientes";
import { obterFinalidadesAtivasRanking, obterFinalidadesAtivasRankingParaClientes } from "./consentimentoRanking";

export type IdentidadePublicaRanking = {
  nomePublico: string | null;
  telefoneMascarado: string | null;
  fotoPerfilUrl: null;
};

const IDENTIDADE_ANONIMA: IdentidadePublicaRanking = {
  nomePublico: null,
  telefoneMascarado: null,
  fotoPerfilUrl: null,
};

function primeiroNome(nome: unknown): string | null {
  const normalizado = normalizarNomeCliente(nome);
  if (!normalizado) return null;
  return normalizado.split(" ")[0]?.slice(0, 30) || null;
}

/**
 * DAL de exposicao do ranking. Qualquer falha de configuracao, Redis ou
 * perfil volta ao DTO anonimo; a rota nunca recebe o objeto Cliente inteiro.
 */
export async function projetarIdentidadePublicaRanking(clienteId: string): Promise<IdentidadePublicaRanking> {
  try {
    const finalidades = await obterFinalidadesAtivasRanking(clienteId);
    const permiteNome = finalidades.has("ranking_primeiro_nome");
    const permiteTelefone = finalidades.has("ranking_telefone_mascarado");
    if (!permiteNome && !permiteTelefone) return { ...IDENTIDADE_ANONIMA };

    const cliente = await buscarClientePorId(clienteId);
    if (!cliente) return { ...IDENTIDADE_ANONIMA };

    return {
      nomePublico: permiteNome ? primeiroNome(cliente.nome) : null,
      telefoneMascarado: permiteTelefone ? mascararTelefoneExibicao(cliente.telefone) || null : null,
      // Bloqueado ate existir fonte oficial/autorizada e adaptador revisado.
      fotoPerfilUrl: null,
    };
  } catch {
    return { ...IDENTIDADE_ANONIMA };
  }
}

export async function projetarIdentidadesPublicasRanking(
  clienteIds: string[],
): Promise<Map<string, IdentidadePublicaRanking>> {
  const unicos = Array.from(new Set(clienteIds.filter(Boolean)));
  try {
    // Uma unica leitura MGET para todos os consentimentos do Top 10 evita
    // transformar a protecao de privacidade em N+1 no Redis.
    const finalidadesPorCliente = await obterFinalidadesAtivasRankingParaClientes(unicos);
    const pares = await Promise.all(unicos.map(async (clienteId) => {
      const finalidades = finalidadesPorCliente.get(clienteId) ?? new Set();
      const permiteNome = finalidades.has("ranking_primeiro_nome");
      const permiteTelefone = finalidades.has("ranking_telefone_mascarado");
      if (!permiteNome && !permiteTelefone) return [clienteId, { ...IDENTIDADE_ANONIMA }] as const;
      try {
        const cliente = await buscarClientePorId(clienteId);
        if (!cliente) return [clienteId, { ...IDENTIDADE_ANONIMA }] as const;
        return [clienteId, {
          nomePublico: permiteNome ? primeiroNome(cliente.nome) : null,
          telefoneMascarado: permiteTelefone ? mascararTelefoneExibicao(cliente.telefone) || null : null,
          fotoPerfilUrl: null,
        }] as const;
      } catch {
        return [clienteId, { ...IDENTIDADE_ANONIMA }] as const;
      }
    }));
    return new Map(pares);
  } catch {
    return new Map(unicos.map((clienteId) => [clienteId, { ...IDENTIDADE_ANONIMA }]));
  }
}
