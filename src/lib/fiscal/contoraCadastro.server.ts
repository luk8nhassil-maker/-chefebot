/**
 * Alternativa à WLG para o CADASTRO de empresa em homologação.
 * Contrato oficial: https://fiscal.contora.com.br/documentacao/empresas
 *
 * Não existe rota pública chamando este módulo. Habilitar apenas após:
 * - identidade de tenant verificada no servidor
 * - titularidade de CNPJ confirmada
 * - token de HOMOLOGAÇÃO exclusivo guardado em ambiente do servidor
 * - dados fiscais e endereço completos, nunca inferidos
 */
import type { CadastroFiscalGuardado } from "./cadastroFiscal";
import { cnpjValido } from "./wlgVinculos";

const BASE = "https://fiscal.contora.com.br/api/v1";
const REGIMES = {
  simples_nacional: "simples",
  lucro_presumido: "presumido",
  lucro_real: "real",
} as const;

export type EnderecoFiscalCompleto = Readonly<{
  codigoIBGE: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cep: string;
}>;

export type EmpresaContoraHomologacao = Readonly<{
  legal_name: string;
  trade_name: string;
  document: string;
  tax_regime: "simples" | "presumido" | "real";
  state_registration: string;
  state_code: string;
  city_code: string;
  city_name: string;
  street: string;
  number: string;
  district: string;
  postal_code: string;
  default_environment: "homologacao";
}>;

export type EscopoFiscalConfirmado = Readonly<{
  tenantId: string;
  titularAutenticado: string;
  cnpjAutorizado: string;
  titularidadeConferidaNoServidor: true;
}>;

export class ContoraCadastroBloqueado extends Error {
  constructor() {
    super("Cadastro fiscal externo não autorizado ou resultado inconclusivo.");
    this.name = "ContoraCadastroBloqueado";
  }
}

function texto(v: unknown, max: number) {
  return typeof v === "string" && v.trim().length > 0 &&
    v.trim().length <= max && !/[\u0000-\u001f]/.test(v) ? v.trim() : null;
}

/** Transforma SOMENTE campos declarados e revisados; nunca inventa regime, endereço ou IE. */
export function prepararEmpresaContora(
  cadastro: CadastroFiscalGuardado,
  endereco: EnderecoFiscalCompleto,
  titularAutenticado: string,
): EmpresaContoraHomologacao {
  const regime = cadastro.regimeTributario;
  const tax_regime = Object.prototype.hasOwnProperty.call(REGIMES,regime)
    ? REGIMES[regime as keyof typeof REGIMES] : null;
  const razao = texto(cadastro.razaoSocial, 150);
  const nome = cadastro.nomeFantasia === "" ? "" : texto(cadastro.nomeFantasia,150);
  const street = texto(endereco.logradouro,150);
  const number = texto(endereco.numero,20);
  const district = texto(endereco.bairro,100);
  if (cadastro.titularConta !== titularAutenticado ||
      cadastro.schemaVersion !== 1 || cadastro.situacao !== "rascunho_pendente_vinculo" ||
      cadastro.declaracaoResponsavel !== true ||
      !cnpjValido(cadastro.cnpj) || !tax_regime ||
      !razao || nome === null || !street || !number || !district ||
      !/^\d{7}$/.test(endereco.codigoIBGE) ||
      !/^\d{8}$/.test(endereco.cep) ||
      !/^[A-Z]{2}$/.test(cadastro.uf) ||
      !texto(cadastro.municipio,100)) throw new ContoraCadastroBloqueado();
  // O CNPJ é a identidade única da empresa e não pode ser alterado via payload.
  return {
    legal_name: razao, trade_name: nome,
    document: cadastro.cnpj, tax_regime,
    state_registration: cadastro.inscricaoEstadual,
    state_code: cadastro.uf, city_code: endereco.codigoIBGE,
    city_name: cadastro.municipio, street, number, district,
    postal_code: endereco.cep, default_environment: "homologacao",
  };
}

type Http = (url: string, init?: RequestInit) => Promise<Response>;

async function requisitar(url: string, init: RequestInit, fetcher: Http): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetcher(url, { ...init, redirect: "error", cache: "no-store", signal: controller.signal });
  } catch {
    throw new ContoraCadastroBloqueado();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Upsert remoto IDEMPOTENTE apenas em homologação.
 * NUNCA chamado do navegador: token sempre vem da variável do servidor.
 * Nenhuma emissão de nota, upload de certificado ou consumo de saldo.
 */
export async function sincronizarEmpresaContoraHomologacao(
  empresa: EmpresaContoraHomologacao,
  escopo: EscopoFiscalConfirmado,
  fetcher: Http = fetch,
): Promise<{ id: string; cnpj: string; ambiente: "homologacao" }> {
  const token = process.env.CONTORA_FISCAL_HOMOLOG_TOKEN;
  if (process.env.VERCEL_ENV === "preview" ||
      process.env.FISCAL_CONTORA_CADASTRO_HOMOLOG_LIBERADO !== "true" ||
      !token?.trim() ||
      !escopo.titularidadeConferidaNoServidor ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(escopo.tenantId) ||
      !escopo.titularAutenticado.trim() ||
      escopo.cnpjAutorizado !== empresa.document ||
      !cnpjValido(empresa.document) ||
      empresa.default_environment !== "homologacao" ||
      !["simples","presumido","real"].includes(empresa.tax_regime) ||
      !/^\d{7}$/.test(empresa.city_code) ||
      !/^\d{8}$/.test(empresa.postal_code)) throw new ContoraCadastroBloqueado();
  const auth = "Bearer " + token.trim();
  // Verifica somente a credencial de homologação: não cria registros.
  const me = await requisitar(BASE + "/me", {
    method: "GET", headers: { Accept: "application/json", Authorization: auth },
  },fetcher);
  if (me.status !== 200) throw new ContoraCadastroBloqueado();
  let confirmado: unknown;
  try { confirmado = await me.json(); } catch { throw new ContoraCadastroBloqueado(); }
  if (!confirmado || typeof confirmado !== "object" ||
      (confirmado as Record<string, unknown>).ok !== true) throw new ContoraCadastroBloqueado();
  // Upsert com CNPJ e chave de idempotência, sem retry em caso de timeout.
  const resp = await requisitar(
    BASE + "/companies/by-document/" + empresa.document,
    {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: auth,
        "Idempotency-Key": "empresa-homolog-" + empresa.document,
      },
      body: JSON.stringify(empresa),
    },fetcher,
  );
  if (resp.status !== 200 && resp.status !== 201) throw new ContoraCadastroBloqueado();
  let json: unknown;
  try { json = await resp.json(); } catch { throw new ContoraCadastroBloqueado(); }
  if (!json || typeof json !== "object" || Array.isArray(json))
    throw new ContoraCadastroBloqueado();
  const data = (json as { data?: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new ContoraCadastroBloqueado();
  const empresaRecebida = data as Record<string, unknown>;
  if (typeof empresaRecebida.id !== "string" ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(empresaRecebida.id) ||
      empresaRecebida.document !== empresa.document)
    throw new ContoraCadastroBloqueado();
  return { id: empresaRecebida.id, cnpj: empresa.document, ambiente: "homologacao" };
}
