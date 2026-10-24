import { cnpjValido } from "./wlgVinculos";

/**
 * Cadastro DECLARATÓRIO preenchido pelo responsável pela pizzaria.
 * Não é validação SEFAZ, não cria empresa WLG e não habilita emissão.
 * Vinculação real ao tenant permanece bloqueada até haver identidade de
 * estabelecimento autenticada e contrato de provisionamento WLG.
 */
export const REGIMES = ["nao_informado", "simples_nacional", "lucro_presumido", "lucro_real"] as const;
export type RegimeDeclarado = (typeof REGIMES)[number];
export type CadastroFiscalDeclarado = Readonly<{
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  inscricaoEstadual: string;
  uf: string;
  municipio: string;
  regimeTributario: RegimeDeclarado;
  declaracaoResponsavel: true;
}>;
export type CadastroFiscalGuardado = CadastroFiscalDeclarado & Readonly<{
  schemaVersion: 1;
  titularConta: string;
  situacao: "rascunho_pendente_vinculo";
  atualizadoEm: string;
}>;

const UFS = new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]);
const CAMPOS = new Set([
  "cnpj", "razaoSocial", "nomeFantasia", "inscricaoEstadual",
  "uf", "municipio", "regimeTributario", "declaracaoResponsavel",
]);

const texto = (v: unknown, limite: number): string | null =>
  typeof v === "string" && v.trim().length <= limite ? v.trim() : null;

export class CadastroFiscalInvalido extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CadastroFiscalInvalido";
  }
}

export function validarCadastroFiscal(body: unknown): CadastroFiscalDeclarado {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new CadastroFiscalInvalido("Preencha os dados fiscais da sua empresa.");
  const registro = body as Record<string, unknown>;
  // Sem aceitar campos arbitrários, sobretudo certificados, tokens ou secrets.
  if (Object.keys(registro).some(k => !CAMPOS.has(k)))
    throw new CadastroFiscalInvalido("O formulário contém informações não permitidas. Não envie certificados ou senhas.");
  const cnpj = typeof registro.cnpj === "string" ? registro.cnpj.replace(/\D/g, "") : "";
  if (!cnpjValido(cnpj)) throw new CadastroFiscalInvalido("Confira o CNPJ informado.");
  const razaoSocial = texto(registro.razaoSocial, 150);
  const nomeFantasia = texto(registro.nomeFantasia, 150);
  const inscricaoEstadual = texto(registro.inscricaoEstadual, 20);
  const municipio = texto(registro.municipio, 100);
  const uf = typeof registro.uf === "string" ? registro.uf.trim().toUpperCase() : "";
  if (!razaoSocial || !municipio || !UFS.has(uf) ||
      nomeFantasia === null || inscricaoEstadual === null)
    throw new CadastroFiscalInvalido("Preencha razão social, município e UF válidos.");
  // IE pode ser "ISENTO", conforme informado pelo responsável. NÃO inferir isenção.
  if (inscricaoEstadual && !/^(ISENTO|[0-9]{2,20})$/i.test(inscricaoEstadual))
    throw new CadastroFiscalInvalido("Confira a inscrição estadual informada.");
  const regimeTributario = registro.regimeTributario;
  if (typeof regimeTributario !== "string" || !REGIMES.includes(regimeTributario as RegimeDeclarado))
    throw new CadastroFiscalInvalido("Selecione o regime tributário ou informe que não sabe.");
  if (registro.declaracaoResponsavel !== true)
    throw new CadastroFiscalInvalido("A confirmação do responsável é obrigatória.");
  return {
    cnpj, razaoSocial, nomeFantasia: nomeFantasia ?? "",
    inscricaoEstadual: (inscricaoEstadual ?? "").toUpperCase(), uf,
    municipio, regimeTributario: regimeTributario as RegimeDeclarado,
    declaracaoResponsavel: true,
  };
}

/** Retorna APENAS os dados da lista explícita; campos extras são descartados. */
export function criarRascunhoFiscal(
  titularConta: string, dados: CadastroFiscalDeclarado, agoraISO: string,
): CadastroFiscalGuardado {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(titularConta) ||
      !Number.isFinite(Date.parse(agoraISO)))
    throw new CadastroFiscalInvalido("Identidade ou horário do cadastro inválido.");
  return {
    ...dados, schemaVersion: 1, titularConta,
    situacao: "rascunho_pendente_vinculo", atualizadoEm: agoraISO,
  };
}
