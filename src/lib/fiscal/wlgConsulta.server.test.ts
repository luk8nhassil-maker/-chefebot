import { describe, expect, test } from "vitest";
import {
  autenticarWlgSomenteServidor,
  consultarOperacaoWlg,
  WlgConsultaIndeterminada,
  WLG_ORIGEM,
} from "./wlgConsulta.server";

const credenciais = { clientId: "CLIENT_TESTE", clientSecret: "SEGREDO_TESTE" };
const operationId = "6f1e61b8-1234-1234-1234-123456789abc";
const chave = "1".repeat(44);

function httpFake(resultado: Record<string, unknown>, status = 200) {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const mock = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    const corpo = url.endsWith("/api/v1/auth/token")
      ? { accessToken: "TOKEN_EFEMERO" } : resultado;
    return new Response(JSON.stringify(corpo), { status });
  };
  return { mock, chamadas };
}

describe("adapter WLG: consulta sem qualquer emissão", () => {
  test("autentica no endereço oficial, sem mandar credenciais para outro host", async () => {
    const { mock, chamadas } = httpFake({});
    expect(await autenticarWlgSomenteServidor(credenciais, mock)).toBe("TOKEN_EFEMERO");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(WLG_ORIGEM + "/api/v1/auth/token");
    expect(chamadas[0].init?.method).toBe("POST");
    expect(chamadas[0].init?.body).toBe(JSON.stringify({
      clientId: credenciais.clientId, clientSecret: credenciais.clientSecret,
    }));
    expect(chamadas[0].init?.redirect).toBe("error");
  });
  test("não confunde PROCESSANDO com nota emitida", async () => {
    const { mock, chamadas } = httpFake({ status: "PROCESSANDO", operationId });
    const r = await consultarOperacaoWlg(operationId, credenciais, mock);
    expect(r).toEqual({ situacao: "processando", operationId });
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1].url).toBe(WLG_ORIGEM + "/api/v1/operacoes/" + operationId);
    expect(chamadas[1].init?.method).toBe("GET");
    expect((chamadas[1].init?.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN_EFEMERO");
  });
  test("SUCCESSO autorizado somente com chave de 44 dígitos e data", async () => {
    const { mock } = httpFake({ status: "SUCCESSO", chaveNfe: chave, dataAutorizacao: "2026-10-24T16:00:00Z" });
    expect(await consultarOperacaoWlg(operationId, credenciais, mock)).toEqual({
      situacao: "autorizada", operationId, chave, autorizadaEm: "2026-10-24T16:00:00Z",
    });
  });
  test("SUCESSO, variação linguística, ainda exige chave e data", async () => {
    const { mock } = httpFake({ status: "SUCESSO", chaveNfe: chave, dataAutorizacao: "2026-10-24T16:00:00Z" });
    expect((await consultarOperacaoWlg(operationId, credenciais, mock)).situacao).toBe("autorizada");
  });
  test("SUCESSO sem chave correta fica indeterminada, não emitida", async () => {
    const { mock } = httpFake({ status: "SUCCESSO", chaveNfe: "123", dataAutorizacao: "ontem" });
    expect((await consultarOperacaoWlg(operationId, credenciais, mock)).situacao).toBe("indeterminada");
  });
  test("estado desconhecido ou vazio continua indeterminado", async () => {
    const { mock } = httpFake({ status: "NOVO_STATUS" });
    expect((await consultarOperacaoWlg(operationId, credenciais, mock)).situacao).toBe("indeterminada");
  });
  test("rejeição nunca devolve conteúdo do provedor ao atendente", async () => {
    const { mock } = httpFake({ status: "ERRO", motivoErro: "SEGREDO_TESTE rejeição com CPF" });
    const r = await consultarOperacaoWlg(operationId, credenciais, mock);
    expect(r.situacao).toBe("rejeitada");
    expect(JSON.stringify(r)).not.toContain("SEGREDO_TESTE");
    expect(JSON.stringify(r)).not.toContain("CPF");
  });
  test("falha de rede, 500 e JSON inválido não geram falso sucesso nem vazam segredo", async () => {
    const erro = async () => { throw new Error("CLIENT_TESTE SEGREDO_TESTE"); };
    await expect(consultarOperacaoWlg(operationId, credenciais, erro)).rejects.toThrow(WlgConsultaIndeterminada);
    const resposta500 = async () => new Response("SEGREDO_TESTE", { status: 500 });
    await expect(consultarOperacaoWlg(operationId, credenciais, resposta500)).rejects.toThrow(WlgConsultaIndeterminada);
    const jsonRuim = async () => new Response("não é json", { status: 200 });
    await expect(consultarOperacaoWlg(operationId, credenciais, jsonRuim)).rejects.toThrow(WlgConsultaIndeterminada);
  });
  test("ID malformado ou credencial vazia não chama o provedor", async () => {
    let chamadas = 0;
    const mock = async () => { chamadas += 1; return new Response("{}"); };
    await expect(consultarOperacaoWlg("../nfe", credenciais, mock)).rejects.toThrow();
    await expect(consultarOperacaoWlg(operationId, { clientId: "", clientSecret: "" }, mock)).rejects.toThrow();
    expect(chamadas).toBe(0);
  });
});
