/**
 * Adaptador HTTP para etapa FUTURA de homologação da NFC-e WLG.
 * NÃO é exposto por nenhuma API do ChefeBot. Falha fechada até aprovação
 * do contrato Swagger, do contador e do vínculo por restaurante.
 *
 * A documentação pública mostra campos de exemplo, não um schema completo.
 * Portanto o payload precisa ser montado POR UM SERVIÇO FISCAL confiável,
 * nunca a partir de JSON enviado pelo navegador.
 */
import { autenticarWlgSomenteServidor, WLG_ORIGEM, type WlgCredenciais } from "./wlgConsulta.server";
import { correspondeEmpresaEmHomologacao, type VinculoWlg } from "./wlgVinculos";

export type EnvelopeHomologacaoWlg = Readonly<{
  empresaId: string;
  tipoAmbiente: 2;
  ide: Readonly<{ modelo: 65; [campo: string]: unknown }>;
  emitente: Readonly<Record<string, unknown>>;
  destinatario?: Readonly<Record<string, unknown>>;
  itens: ReadonlyArray<Readonly<Record<string, unknown>>>;
  totais: Readonly<Record<string, unknown>>;
  pagamento: Readonly<Record<string, unknown>>;
}>;

export class EnvioWlgNaoConfirmado extends Error {
  constructor() {
    super("Não foi possível confirmar envio fiscal. Proibido reenviar automaticamente.");
    this.name = "EnvioWlgNaoConfirmado";
  }
}

export function validarEnvelopeHomologacaoWlg(
  dados: EnvelopeHomologacaoWlg,
  vinculo: VinculoWlg,
  cnpjEmitenteValidado: string,
): boolean {
  return dados.tipoAmbiente === 2 && dados.ide?.modelo === 65 &&
    Array.isArray(dados.itens) && dados.itens.length > 0 &&
    typeof dados.emitente === "object" && !!dados.emitente &&
    dados.emitente.cnpj === cnpjEmitenteValidado &&
    typeof dados.totais === "object" && !!dados.totais &&
    typeof dados.pagamento === "object" && !!dados.pagamento &&
    correspondeEmpresaEmHomologacao(vinculo, dados.empresaId, cnpjEmitenteValidado);
}

/**
 * Somente homologação e somente com autorização explícita do MÓDULO fiscal
 * servidor. Não existe ainda esse módulo/ledger durável — por isso esta função
 * não é referenciada pelo app. Em Preview/Produção nunca pode transmitir.
 *
 * Retorna operationId apenas após HTTP 202; não significa nota autorizada.
 */
export async function enviarEnvelopeHomologacaoWlg(
  entrada: EnvelopeHomologacaoWlg,
  vinculo: VinculoWlg,
  cnpjEmitenteValidado: string,
  credenciais: WlgCredenciais,
  contratoSwaggerAprovado: boolean,
  fetcher: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<{ situacao: "processando"; operationId: string }> {
  if (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production" ||
      !contratoSwaggerAprovado ||
      !validarEnvelopeHomologacaoWlg(entrada, vinculo, cnpjEmitenteValidado)) {
    throw new EnvioWlgNaoConfirmado();
  }
  // Nenhum retry automático: timeout após envio deixa o resultado incerto.
  const token = await autenticarWlgSomenteServidor(credenciais, fetcher);
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), 7000);
  try {
    const resp = await fetcher(WLG_ORIGEM + "/api/v1/nfe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json",
        Authorization: "Bearer " + token },
      body: JSON.stringify(entrada),
      redirect: "error",
      cache: "no-store",
      signal: controlador.signal,
    });
    if (resp.status !== 202) throw new EnvioWlgNaoConfirmado();
    const json: unknown = await resp.json();
    if (!json || typeof json !== "object" || Array.isArray(json))
      throw new EnvioWlgNaoConfirmado();
    const op = (json as Record<string, unknown>).operationId;
    if (typeof op !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(op))
      throw new EnvioWlgNaoConfirmado();
    return { situacao: "processando", operationId: op };
  } catch {
    // O resultado remoto é desconhecido: NUNCA fazer segundo POST.
    throw new EnvioWlgNaoConfirmado();
  } finally {
    clearTimeout(timeout);
  }
}
