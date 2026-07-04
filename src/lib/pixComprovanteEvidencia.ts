import { PIX_COMPROVANTE_DEDUP_TTL_SEGUNDOS } from "./pixComprovanteHash";

export const PIX_COMPROVANTE_E2E_TTL_SEGUNDOS = PIX_COMPROVANTE_DEDUP_TTL_SEGUNDOS;

export type PixComprovanteIdentificador = {
  e2eId?: string;
  codigoAutenticacao?: string;
};

type TipoRotulo = "e2e" | "codigo";

const ROTULOS: Array<{ tipo: TipoRotulo; regex: RegExp }> = [
  { tipo: "e2e", regex: /\bE\s*2\s*E(?:\s*ID)?\b/g },
  { tipo: "codigo", regex: /\bID\s+DA\s+TRANSACAO\b/g },
  { tipo: "codigo", regex: /\bIDENTIFICADOR\b/g },
  { tipo: "codigo", regex: /\bCODIGO\s+DE\s+AUTENTICACAO\b/g },
  { tipo: "codigo", regex: /\bAUTENTICACAO\b/g },
  { tipo: "codigo", regex: /\bCODIGO\s+DA\s+TRANSACAO\b/g },
];

function semAcentosUpper(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function somenteAlfanumerico(valor: string): string {
  return semAcentosUpper(valor).replace(/[^A-Z0-9]/g, "");
}

function contarDigitos(valor: string): number {
  return (valor.match(/\d/g) || []).length;
}

export function normalizarE2EIdPix(valor: string | null | undefined): string | undefined {
  const normalizado = somenteAlfanumerico(String(valor || ""));
  if (!/^E[A-Z0-9]{19,79}$/.test(normalizado)) return undefined;
  if (contarDigitos(normalizado) < 8) return undefined;
  return normalizado;
}

export function normalizarCodigoAutenticacaoPix(valor: string | null | undefined): string | undefined {
  const normalizado = somenteAlfanumerico(String(valor || ""));
  if (!/^[A-Z0-9]{10,80}$/.test(normalizado)) return undefined;
  if (contarDigitos(normalizado) < 4) return undefined;
  return normalizado;
}

function candidatoDepoisDoRotulo(linha: string, indexFinalRotulo: number): string | undefined {
  const depois = linha
    .slice(indexFinalRotulo)
    .replace(/^\s*(?:PIX|DA\s+TRANSACAO|TRANSACAO|AUTENTICACAO)?\s*[:._-]?\s*/, "")
    .replace(/\s+(?:VALOR|DATA|HORARIO|DESTINATARIO|BENEFICIARIO|CHAVE|PAGADOR|CPF|CNPJ|BANCO|NOME|RS|R\$)\b.*$/, "")
    .replace(/^[^A-Z0-9]+/, "");
  const match = depois.match(/[A-Z0-9][A-Z0-9\s:._-]{8,100}/);
  return match?.[0];
}

function e2eDireto(texto: string): string | undefined {
  const busca = semAcentosUpper(texto);
  const regex = /(?:^|[^A-Z0-9])(E[A-Z0-9][A-Z0-9-]{18,100})(?=$|[^A-Z0-9])/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(busca)) !== null) {
    const e2e = normalizarE2EIdPix(match[1]);
    if (e2e) return e2e;
  }
  return undefined;
}

export function extrairIdentificadorComprovantePix(texto: string | null | undefined): PixComprovanteIdentificador {
  const conteudo = String(texto || "");
  const direto = e2eDireto(conteudo);
  if (direto) return { e2eId: direto };

  let codigoAutenticacao: string | undefined;
  const linhas = semAcentosUpper(conteudo).split(/\r?\n/);

  for (const linha of linhas) {
    for (const rotulo of ROTULOS) {
      rotulo.regex.lastIndex = 0;
      const match = rotulo.regex.exec(linha);
      if (!match) continue;

      const candidato = candidatoDepoisDoRotulo(linha, match.index + match[0].length);
      if (!candidato) continue;

      const e2eId = normalizarE2EIdPix(candidato);
      if (e2eId) return { e2eId };

      if (rotulo.tipo === "codigo" && !codigoAutenticacao) {
        codigoAutenticacao = normalizarCodigoAutenticacaoPix(candidato);
      }
    }
  }

  return codigoAutenticacao ? { codigoAutenticacao } : {};
}

export function normalizarIdentificadorComprovantePix(
  identificador: PixComprovanteIdentificador,
): PixComprovanteIdentificador {
  const e2eId = normalizarE2EIdPix(identificador.e2eId);
  if (e2eId) return { e2eId };

  const codigoAutenticacao = normalizarCodigoAutenticacaoPix(identificador.codigoAutenticacao);
  return codigoAutenticacao ? { codigoAutenticacao } : {};
}

export function chaveDedupIdentificadorComprovantePix(
  identificador: PixComprovanteIdentificador,
): string | undefined {
  const normalizado = normalizarIdentificadorComprovantePix(identificador);
  const valor = normalizado.e2eId || normalizado.codigoAutenticacao;
  return valor ? `pix_comprovante_e2e:${valor}` : undefined;
}
