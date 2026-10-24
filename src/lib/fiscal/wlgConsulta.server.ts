/**
 * Adapter de LEITURA do emissor WLG. Consultar não emite documentos.
 * A criação de NFC-e exige antes um ledger durável e regra fiscal aprovada.
 * Não expor estas funções à navegação sem vincular a operação ao pedido/tenant.
 *
 * Fonte contratual: https://wlgsistemas.com.br/api-emissao-nfe
 */
export const WLG_ORIGEM = "https://fiscal.wlgsistemas.com.br";

export type WlgCredenciais = Readonly<{
  clientId: string;
  clientSecret: string;
}>;

export type WlgStatus =
  | { situacao: "processando"; operationId: string }
  | { situacao: "autorizada"; operationId: string; chave: string; autorizadaEm: string }
  | { situacao: "rejeitada"; operationId: string; motivo: string }
  | { situacao: "indeterminada"; operationId: string };

type Http = (url: string, init?: RequestInit) => Promise<Response>;
type Registro = Record<string, unknown>;

const OPERACAO_ID = /^[a-zA-Z0-9_-]{8,100}$/;
const CHAVE_NFE = /^\d{44}$/;

function objeto(value: unknown): value is Registro {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class WlgConsultaIndeterminada extends Error {
  constructor() {
    super("Consulta fiscal indisponível ou incerta. Consulte novamente, sem reenviar nota.");
    this.name = "WlgConsultaIndeterminada";
  }
}

async function jsonWlg(
  rota: string,
  method: "GET" | "POST",
  fetcher: Http,
  bearer?: string,
  payload?: Registro,
): Promise<Registro> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetcher(WLG_ORIGEM + rota, {
      method,
      headers: {
        "Accept": "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {}),
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new WlgConsultaIndeterminada();
    const data: unknown = await response.json();
    if (!objeto(data)) throw new WlgConsultaIndeterminada();
    return data;
  } catch {
    // Nunca repassar corpo bruto do provedor: pode conter dados fiscais/credenciais.
    throw new WlgConsultaIndeterminada();
  } finally {
    clearTimeout(timeout);
  }
}

export async function autenticarWlgSomenteServidor(
  credenciais: WlgCredenciais,
  fetcher: Http = fetch,
): Promise<string> {
  if (!credenciais.clientId.trim() || !credenciais.clientSecret.trim())
    throw new WlgConsultaIndeterminada();

  const resposta = await jsonWlg("/api/v1/auth/token", "POST", fetcher, undefined, {
    clientId: credenciais.clientId,
    clientSecret: credenciais.clientSecret,
  });
  const token = resposta.accessToken;
  if (typeof token !== "string" || !token.trim())
    throw new WlgConsultaIndeterminada();
  return token;
}

/**
 * A entrada operationId deverá vir do ledger fiscal validado, jamais
 * de uma string arbitrária fornecida pelo atendente.
 * A resposta PROCESSANDO (202) não é documento autorizado.
 */
export async function consultarOperacaoWlg(
  operationId: string,
  credenciais: WlgCredenciais,
  fetcher: Http = fetch,
): Promise<WlgStatus> {
  if (!OPERACAO_ID.test(operationId)) throw new WlgConsultaIndeterminada();
  const bearer = await autenticarWlgSomenteServidor(credenciais, fetcher);
  const data = await jsonWlg(
    "/api/v1/operacoes/" + encodeURIComponent(operationId),
    "GET",
    fetcher,
    bearer,
  );
  const estado = typeof data.status === "string"
    ? data.status.trim().toUpperCase() : "";

  // O exemplo da WLG usa "SUCCESSO"; também aceitamos o português "SUCESSO".
  // Nunca concluir autorização só pelo nome do estado.
  if (estado === "SUCCESSO" || estado === "SUCESSO") {
    if (typeof data.chaveNfe !== "string" || !CHAVE_NFE.test(data.chaveNfe) ||
        typeof data.dataAutorizacao !== "string" || !data.dataAutorizacao.trim())
      return { situacao: "indeterminada", operationId };
    return {
      situacao: "autorizada",
      operationId,
      chave: data.chaveNfe,
      autorizadaEm: data.dataAutorizacao,
    };
  }
  if (estado === "ERRO" || estado === "REJEITADA" || estado === "REJEITADO") {
    // Não devolvemos conteúdo arbitrário do provedor como mensagem ao usuário.
    return { situacao: "rejeitada", operationId, motivo: "Rejeitada pelo emissor; consulte o painel fiscal." };
  }
  if (estado === "PROCESSANDO" || estado === "PENDENTE")
    return { situacao: "processando", operationId };
  return { situacao: "indeterminada", operationId };
}
