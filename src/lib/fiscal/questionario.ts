import { cnpjValido } from "./cnpj";

/** Dados informativos. Não representam autorização fiscal nem configuram o emissor. */
export const CAMPOS_FISCAIS = [
  "cnpj", "razaoSocial", "nomeFantasia", "inscricaoEstadual", "porteEmpresa", "regimeTributario",
  "tipoEstabelecimento", "vendaOutroEndereco", "cnaePrincipal",
  "uf", "municipio", "codigoIBGE", "cep", "logradouro", "numero", "bairro",
  "credenciamentoNfce", "certificadoNaWlg", "orientacoesProdutos", "observacoes",
] as const;
export type CampoFiscal = typeof CAMPOS_FISCAIS[number];
/** Campos apresentados no cadastro de um único emitente.
 * Campos legados sobre múltiplos endereços continuam compatíveis no armazenamento,
 * mas não são pedidos ao dono nem conferem autorização para emissão.
 */
export const CAMPOS_FORMULARIO_FISCAL = CAMPOS_FISCAIS.filter(
  campo => campo !== "tipoEstabelecimento" && campo !== "vendaOutroEndereco",
);

export type RespostasFiscais = Record<CampoFiscal, string>;
export const VAZIO: RespostasFiscais = Object.fromEntries(
  CAMPOS_FISCAIS.map(k => [k, ""]),
) as RespostasFiscais;

export type QuestionarioFiscal = {
  schemaVersion: 1;
  titularConta: string;
  situacao: "rascunho_pendente_vinculo";
  versao: number;
  atualizadoEm: string;
  respostas: RespostasFiscais;
};
const maximos: Record<CampoFiscal, number> = {
  cnpj: 18, razaoSocial: 150, nomeFantasia: 150,
  inscricaoEstadual: 20, porteEmpresa: 30, regimeTributario: 40,
  tipoEstabelecimento: 25, vendaOutroEndereco: 25, cnaePrincipal: 10,
  uf: 2, municipio: 100,
  codigoIBGE: 7, cep: 9, logradouro: 150, numero: 20, bairro: 100,
  credenciamentoNfce: 40, certificadoNaWlg: 40,
  orientacoesProdutos: 1200, observacoes: 800,
};
const ufs = new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]);
const regimes = new Set(["", "nao_informado", "simei", "simples_nacional", "lucro_presumido", "lucro_real", "outro"]);
const portes = new Set(["", "nao_informado", "mei", "me", "epp", "demais"]);
const estabelecimentos = new Set(["", "nao_informado", "matriz", "filial"]);
const enderecos = new Set(["", "nao_informado", "sim", "nao"]);
const nfce = new Set(["", "nao_informado", "pendente", "habilitado"]);
const a1 = new Set(["", "nao_informado", "nao", "sim"]);

export class QuestionarioInvalido extends Error {}

export function validarRespostas(input: unknown): RespostasFiscais {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new QuestionarioInvalido("Formulário inválido.");
  const obj = input as Record<string, unknown>;
  if (Object.keys(obj).some(k => !CAMPOS_FISCAIS.includes(k as CampoFiscal)))
    throw new QuestionarioInvalido("Campo não permitido. Não envie senhas nem certificados.");
  const out = { ...VAZIO };
  for (const k of CAMPOS_FISCAIS) {
    const value = obj[k] ?? "";
    if (typeof value !== "string" || value.length > maximos[k] ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))
      throw new QuestionarioInvalido("Revise o campo " + k + ".");
    out[k] = value.trim();
  }
  if (out.cnpj) {
    const normalized = out.cnpj.replace(/[.\/\-\s]/g,"").toUpperCase();
    if (!cnpjValido(normalized)) throw new QuestionarioInvalido("CNPJ inválido.");
    out.cnpj = normalized;
  }
  out.uf = out.uf.toUpperCase();
  if (out.uf && !ufs.has(out.uf)) throw new QuestionarioInvalido("UF inválida.");
  if (out.inscricaoEstadual && !/^(ISENTO|[0-9]{2,20})$/i.test(out.inscricaoEstadual))
    throw new QuestionarioInvalido("Inscrição estadual inválida.");
  out.inscricaoEstadual = out.inscricaoEstadual.toUpperCase();
  if (out.cep && !/^\d{5}-?\d{3}$/.test(out.cep))
    throw new QuestionarioInvalido("CEP inválido.");
  if (out.codigoIBGE && !/^\d{7}$/.test(out.codigoIBGE))
    throw new QuestionarioInvalido("Código IBGE inválido.");
  if (out.cnaePrincipal) {
    const cnae = out.cnaePrincipal.replace(/[-.\/\s]/g, "");
    if (!/^\d{7}$/.test(cnae)) throw new QuestionarioInvalido("Confira o CNAE principal.");
    out.cnaePrincipal = cnae;
  }
  // Porte, regime e tipo de estabelecimento são declarações independentes;
  // não deduzir tributação nem habilitar emissão por estas respostas.
  if (!portes.has(out.porteEmpresa) ||
      !estabelecimentos.has(out.tipoEstabelecimento) ||
      !enderecos.has(out.vendaOutroEndereco) ||
      !regimes.has(out.regimeTributario) ||
      !nfce.has(out.credenciamentoNfce) || !a1.has(out.certificadoNaWlg))
    throw new QuestionarioInvalido("Escolha uma opção válida.");
  if (/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|BEGIN CERTIFICATE|client[_-]?secret\s*[:=]|senha\s*[:=]/i.test(out.orientacoesProdutos+" "+out.observacoes))
    throw new QuestionarioInvalido("Não informe senhas, certificados ou segredos.");
  return out;
}
