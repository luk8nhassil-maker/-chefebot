/**
 * Contrato de associação servidor->empresa fiscal.
 * Hoje o ChefeBot tem usuários globais, sem tenantId assinado no auth-token.
 * Portanto, nenhuma rota pode aceitar tenantId/empresaId do navegador:
 * essa estrutura é um pré-requisito, NÃO uma liberação para multiempresa.
 */
export type VinculoWlg = Readonly<{
  tenantId: string;           // ID estável do restaurante no ChefeBot, atribuído pelo servidor
  empresaId: string;          // ID obtido da lista de empresas da WLG
  cnpj: string;               // CNPJ oficial do emitente validado (somente dígitos)
  habilitado: boolean;        // aprovar depois da homologação e do contrato de uso
  homologacaoConcluida: boolean;
}>;

const ID_VALIDO = /^[a-zA-Z0-9_-]{1,100}$/;
const EMPRESA_ID_VALIDO = /^[a-zA-Z0-9_-]{1,128}$/;

export function cnpjValido(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (parcial: string) => {
    const pesos = parcial.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...parcial].reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? "0" : String(11 - resto);
  };
  return cnpj[12] === dv(cnpj.slice(0, 12)) &&
    cnpj[13] === dv(cnpj.slice(0, 13));
}

export type ResolucaoVinculo =
  | { ok: true; vinculo: VinculoWlg }
  | { ok: false; codigo: "tenant_ausente" | "vinculo_ausente" | "ambiguo" | "nao_homologado" | "dados_invalidos" };

export function resolverVinculoWlg(
  tenantAutenticado: string | null,
  vinculosServidor: readonly VinculoWlg[],
): ResolucaoVinculo {
  if (!tenantAutenticado || !ID_VALIDO.test(tenantAutenticado))
    return { ok: false, codigo: "tenant_ausente" };
  const encontrados = vinculosServidor.filter(v => v.tenantId === tenantAutenticado);
  if (encontrados.length === 0) return { ok: false, codigo: "vinculo_ausente" };
  if (encontrados.length !== 1) return { ok: false, codigo: "ambiguo" };
  const v = encontrados[0];
  // Uma mesma empresa fiscal não pode ser vinculada a dois tenants sem
  // revisão expressa. Evita compartilhamento acidental de credenciais/notas.
  if (vinculosServidor.some(outro => outro.tenantId !== tenantAutenticado &&
      (outro.empresaId === v.empresaId || outro.cnpj === v.cnpj)))
    return { ok: false, codigo: "ambiguo" };
  if (!EMPRESA_ID_VALIDO.test(v.empresaId) || !cnpjValido(v.cnpj))
    return { ok: false, codigo: "dados_invalidos" };
  if (!v.habilitado || !v.homologacaoConcluida)
    return { ok: false, codigo: "nao_homologado" };
  return { ok: true, vinculo: v };
}

/** O vínculo jamais será determinado pelo pedido, CPF do consumidor, body ou querystring. */
export function correspondeEmpresaVinculada(
  vinculo: VinculoWlg,
  empresaIdRequisicao: string,
  cnpjRequisicao: string,
): boolean {
  return vinculo.habilitado && vinculo.homologacaoConcluida &&
    vinculo.empresaId === empresaIdRequisicao &&
    vinculo.cnpj === cnpjRequisicao && cnpjValido(cnpjRequisicao);
}
