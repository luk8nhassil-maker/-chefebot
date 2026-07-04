// Comparacao conservadora de beneficiario/chave Pix para a avaliacao de evidencia
// (Etapa 2E). Objetivo: reconhecer a MESMA chave em formatos diferentes (telefone
// com/sem +55, com mascara de exibicao, CPF/CNPJ pontuado, e-mail em caixa
// diferente, chave aleatoria com hifens) sem abrir matching amplo — numero curto,
// digitos parciais ou campo mascarado (***) nunca contam como prova de nada:
// nem de correspondencia ("ok") nem de divergencia.

export type ResultadoBeneficiarioPix = "ok" | "divergente" | "ausente";

export type AvaliarBeneficiarioPixInput = {
  chaveEsperada?: string | null;
  beneficiarioEsperado?: string | null;
  chaveLida?: string | null;
  beneficiarioLido?: string | null;
};

type TipoChavePix = "email" | "aleatoria" | "digitos";

export type ChavePixNormalizada = {
  tipo: TipoChavePix;
  valor: string;
};

const REGEX_EVP = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function semAcentos(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

function contarLetras(valor: string): number {
  return (semAcentos(valor).match(/[A-Za-z]/g) || []).length;
}

// Campo mascarado pelo banco (ex: "***.974.000-**") e inconclusivo por definicao:
// nao da para provar correspondencia nem divergencia com digitos escondidos.
function contemMascara(valor: string): boolean {
  return /[*•●]/.test(valor);
}

// Telefone BR com codigo do pais: remove o 55 inicial quando o restante ainda
// forma um numero nacional completo (10 ou 11 digitos).
function canonicalizarDigitosTelefone(digitos: string): string {
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) {
    return digitos.slice(2);
  }
  return digitos;
}

// Normaliza um valor lido/configurado para comparacao de chave Pix.
// Retorna undefined quando o valor nao tem forma de chave completa —
// texto livre, nome de pessoa, numero curto ou campo mascarado.
export function normalizarChavePixParaComparacao(
  valor: string | null | undefined,
): ChavePixNormalizada | undefined {
  const bruto = String(valor || "").trim();
  if (!bruto || contemMascara(bruto)) return undefined;

  const compacto = bruto.replace(/\s+/g, "");
  if (compacto.includes("@")) {
    if (REGEX_EMAIL.test(compacto)) return { tipo: "email", valor: compacto.toLowerCase() };
    return undefined;
  }
  if (REGEX_EVP.test(compacto)) {
    return { tipo: "aleatoria", valor: compacto.replace(/-/g, "").toLowerCase() };
  }

  // Telefone/CPF/CNPJ: compara apenas digitos, mas o campo precisa ser
  // essencialmente numerico — rotulos curtos ("Tel:") passam, um nome ou frase
  // com numeros no meio nao vira chave.
  if (contarLetras(bruto) > 4) return undefined;
  const digitos = canonicalizarDigitosTelefone(apenasDigitos(bruto));
  if (digitos.length < 10 || digitos.length > 14) return undefined;
  return { tipo: "digitos", valor: digitos };
}

// Igualdade de chaves numericas (telefone/CPF/CNPJ) por digitos, com uma unica
// tolerancia: o nono digito de celular BR (11 digitos com "9" na 3a posicao vs
// 10 digitos), exigindo mesmo DDD e mesmos 8 digitos finais. Nada de matching
// por sufixo, prefixo ou quantidade parcial de digitos.
function digitosPixEquivalentes(a: string, b: string): boolean {
  if (a === b) return true;

  const [maior, menor] = a.length >= b.length ? [a, b] : [b, a];
  if (maior.length === 11 && menor.length === 10 && maior[2] === "9") {
    return maior.slice(0, 2) === menor.slice(0, 2) && maior.slice(3) === menor.slice(2);
  }
  return false;
}

function chavesNormalizadasEquivalentes(a: ChavePixNormalizada, b: ChavePixNormalizada): boolean {
  if (a.tipo !== b.tipo) return false;
  if (a.tipo === "digitos") return digitosPixEquivalentes(a.valor, b.valor);
  return a.valor === b.valor;
}

export function chavesPixEquivalentes(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizarChavePixParaComparacao(a);
  const nb = normalizarChavePixParaComparacao(b);
  if (!na || !nb) return false;
  return chavesNormalizadasEquivalentes(na, nb);
}

function normalizarNome(valor: string): string {
  return semAcentos(valor)
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Mesma comparacao flexivel de nome usada desde a criacao da avaliacao de
// evidencia: contencao direta ou qualquer palavra relevante (3+ letras) do nome
// esperado presente no lido. Tolerante a acento, caixa, sufixos (LTDA, banco).
export function nomesBeneficiarioCorrespondem(esperado: string, lido: string): boolean {
  const esperadoNorm = normalizarNome(esperado);
  const lidoNorm = normalizarNome(lido);
  if (!esperadoNorm || !lidoNorm) return false;
  if (lidoNorm.includes(esperadoNorm) || esperadoNorm.includes(lidoNorm)) return true;

  const palavrasEsperado = esperadoNorm.split(" ").filter((palavra) => palavra.length >= 3);
  if (palavrasEsperado.length === 0) return false;
  return palavrasEsperado.some((palavra) => lidoNorm.includes(palavra));
}

function pareceNome(valor: string): boolean {
  return contarLetras(valor) >= 3 && !valor.includes("@") && !normalizarChavePixParaComparacao(valor);
}

// Procura a chave esperada DENTRO de um texto maior (ex: campo com nome +
// instituicao + chave juntos). So produz correspondencia positiva — nunca
// evidencia de divergencia — e exige a chave completa em formato equivalente.
function chaveEncontradaNoTexto(esperada: ChavePixNormalizada, texto: string): boolean {
  if (contemMascara(texto)) return false;

  if (esperada.tipo === "email") {
    return texto.replace(/\s+/g, "").toLowerCase().includes(esperada.valor);
  }
  if (esperada.tipo === "aleatoria") {
    return texto.toLowerCase().replace(/[\s-]/g, "").includes(esperada.valor);
  }

  const sequencias = texto.match(/\+?[\d(][\d\s().\-+\/]{7,}\d/g) || [];
  return sequencias.some((sequencia) => {
    const digitos = canonicalizarDigitosTelefone(apenasDigitos(sequencia));
    if (digitos.length < 10 || digitos.length > 14) return false;
    return digitosPixEquivalentes(esperada.valor, digitos);
  });
}

// Decisao conservadora sobre beneficiario/chave do comprovante:
// - "ok" somente com prova positiva: chave lida equivalente a esperada (em
//   qualquer formatacao) ou nome do recebedor compativel com o esperado;
// - "divergente" somente com evidencia clara de OUTRO recebedor: uma chave
//   completa e legivel que nao equivale a esperada, ou um nome legivel que nao
//   corresponde ao nome esperado;
// - todo o resto (campo vazio, mascarado, numero curto, texto sem chave, nome
//   sem nome esperado para comparar) e "ausente" — que nunca aprova sozinho,
//   apenas deixa de acusar divergencia falsa.
export function avaliarBeneficiarioPix(input: AvaliarBeneficiarioPixInput): ResultadoBeneficiarioPix {
  const chaveEsperada = normalizarChavePixParaComparacao(input.chaveEsperada);
  const nomeEsperado = String(input.beneficiarioEsperado || "").trim();

  const candidatos = [input.chaveLida, input.beneficiarioLido]
    .map((valor) => String(valor || "").trim())
    .filter(Boolean);
  if (candidatos.length === 0) return "ausente";

  let evidenciaDivergente = false;

  for (const candidato of candidatos) {
    const chaveCandidata = normalizarChavePixParaComparacao(candidato);
    if (chaveCandidata) {
      if (chaveEsperada && chavesNormalizadasEquivalentes(chaveEsperada, chaveCandidata)) return "ok";
      if (chaveEsperada) evidenciaDivergente = true;
      continue;
    }

    if (chaveEsperada && chaveEncontradaNoTexto(chaveEsperada, candidato)) return "ok";

    if (nomeEsperado && pareceNome(candidato)) {
      if (nomesBeneficiarioCorrespondem(nomeEsperado, candidato)) return "ok";
      evidenciaDivergente = true;
    }
  }

  return evidenciaDivergente ? "divergente" : "ausente";
}
