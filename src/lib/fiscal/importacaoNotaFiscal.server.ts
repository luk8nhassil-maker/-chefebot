import { validarRespostas, type RespostasFiscais } from "./questionario";
import { carregarQuestionario, salvarQuestionario } from "./questionario.server";

/**
 * Importação assistida, restrita ao administrador definido por variável PRIVADA da Vercel.
 * Nenhum dado real da empresa deve ser escrito neste repositório.
 * Nunca altera o estado fiscal, credenciais, pedidos ou permissões para emissão.
 */
const CAMPOS_PERMITIDOS = [
  "cnpj", "razaoSocial", "inscricaoEstadual", "logradouro",
  "numero", "bairro", "cep", "municipio", "uf",
] as const satisfies readonly (keyof RespostasFiscais)[];

type ConfigImportacao = {
  versao: 1;
  titularConta: string;
  respostas: Partial<Pick<RespostasFiscais, (typeof CAMPOS_PERMITIDOS)[number]>>;
};

function dadosConfigurados(username: string) {
  const env = process.env.FISCAL_PREFILL_DOCUMENTO_202610;
  if (!env) return null;
  let raw: unknown;
  try { raw = JSON.parse(env); } catch { throw new Error("Importação mal configurada"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Importação mal configurada");
  const registro = raw as Record<string, unknown>;
  if (Object.keys(registro).some(k => !["versao", "titularConta", "respostas"].includes(k)) ||
      registro.versao !== 1 || typeof registro.titularConta !== "string" ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(registro.titularConta) ||
      !registro.respostas || typeof registro.respostas !== "object" ||
      Array.isArray(registro.respostas))
    throw new Error("Importação mal configurada");
  // Um convite para contador ou outra conta não pode acessar nem ativar a importação.
  if (registro.titularConta !== username) return null;
  const entrada = registro.respostas as Record<string, unknown>;
  if (Object.keys(entrada).some(k => !CAMPOS_PERMITIDOS.includes(k as typeof CAMPOS_PERMITIDOS[number])))
    throw new Error("Importação inclui campos não autorizados");
  const normalizados = validarRespostas(entrada);
  // A fonte recebida precisa conter CNPJ válido e razão social para evitar misturar empresas.
  if (!normalizados.cnpj || !normalizados.razaoSocial)
    throw new Error("Importação sem identidade do emissor");
  return normalizados;
}

export function haImportacaoPendente(username: string, respostas: RespostasFiscais): boolean {
  const dados = dadosConfigurados(username);
  if (!dados) return false;
  return CAMPOS_PERMITIDOS.some(k => dados[k] && !respostas[k]);
}

export async function importarDadosConferidos(username: string) {
  const dados = dadosConfigurados(username);
  if (!dados) return { status: "nao_disponivel" as const };
  const atual = await carregarQuestionario(username);
  const anterior = validarRespostas(atual.respostas);
  const comparar = (valor: string) => valor.trim().toUpperCase();

  // Fail-closed: não mesclar duas pessoas jurídicas ou endereços divergentes.
  for (const k of CAMPOS_PERMITIDOS) {
    if (anterior[k] && dados[k] && comparar(anterior[k]) !== comparar(dados[k]))
      return { status: "divergente" as const };
  }
  const atualizados = { ...anterior };
  let quantidade = 0;
  for (const k of CAMPOS_PERMITIDOS) {
    if (!atualizados[k] && dados[k]) { atualizados[k] = dados[k]; quantidade++; }
  }
  if (quantidade === 0) return { status: "ja_preenchido" as const };
  const salvo = await salvarQuestionario(username, atual.versao, atualizados);
  if (!salvo) return { status: "conflito_concorrencia" as const };
  return { status: "importado" as const, cadastro: salvo };
}
