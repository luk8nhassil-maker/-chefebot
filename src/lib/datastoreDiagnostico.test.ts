import { describe, expect, test } from "vitest";
import {
  ACAO_SUGERIDA,
  classificarFalhaDatastore,
  datastoreConfigurado,
  higienizarMensagemDatastore,
  variaveisDatastoreAusentes,
} from "./datastoreDiagnostico";

const ENV_OK = {
  KV_REST_API_URL: "https://exemplo-redis-12345.upstash.io",
  KV_REST_API_TOKEN: "AX1yZQgNjY2ZTk0YWMtZmFrZS10b2tlbi1kZS10ZXN0ZQ",
};

describe("configuração do datastore", () => {
  test("reconhece configuração completa", () => {
    expect(datastoreConfigurado(ENV_OK)).toBe(true);
    expect(variaveisDatastoreAusentes(ENV_OK)).toEqual([]);
  });

  test("aponta pelo NOME as variáveis que faltam", () => {
    expect(variaveisDatastoreAusentes({})).toEqual(["KV_REST_API_URL", "KV_REST_API_TOKEN"]);
    expect(variaveisDatastoreAusentes({ ...ENV_OK, KV_REST_API_TOKEN: "   " })).toEqual(["KV_REST_API_TOKEN"]);
  });
});

describe("higienização — nada de segredo pode vazar no diagnóstico", () => {
  test("apaga o token do datastore da mensagem", () => {
    const msg = higienizarMensagemDatastore(new Error(`auth failed for ${ENV_OK.KV_REST_API_TOKEN}`), ENV_OK);
    expect(msg).not.toContain(ENV_OK.KV_REST_API_TOKEN);
  });

  test("apaga a URL do datastore da mensagem", () => {
    const msg = higienizarMensagemDatastore(new Error(`fetch failed to ${ENV_OK.KV_REST_API_URL}/get/x`), ENV_OK);
    expect(msg).not.toContain("upstash.io");
    expect(msg).not.toContain(ENV_OK.KV_REST_API_URL);
  });

  test("apaga header Authorization e credenciais longas mesmo sem bater com o env", () => {
    const msg = higienizarMensagemDatastore(
      new Error("request had Bearer AZaSDFghJKlqWERtyUIOpZXCvbNM1234567890 and failed"),
      {}
    );
    expect(msg).not.toContain("AZaSDFghJKlqWERtyUIOpZXCvbNM1234567890");
    expect(msg.toLowerCase()).toContain("[oculto]");
  });

  test("apaga números longos (telefone/documento)", () => {
    expect(higienizarMensagemDatastore(new Error("cliente 5531988887777 falhou"), {})).not.toContain("5531988887777");
  });

  test("limita o tamanho e nunca lança para entradas estranhas", () => {
    expect(higienizarMensagemDatastore(new Error("x".repeat(5000)), {}).length).toBeLessThanOrEqual(200);
    expect(() => higienizarMensagemDatastore(null, {})).not.toThrow();
    expect(() => higienizarMensagemDatastore(undefined, {})).not.toThrow();
    expect(() => higienizarMensagemDatastore({ nada: true }, {})).not.toThrow();
  });
});

describe("classificação da falha — cada classe muda a ação do operador", () => {
  const casos: Array<[string, unknown, string]> = [
    ["cota mensal da Upstash", new Error("ERR max requests limit exceeded"), "cota_excedida"],
    ["limite diário", new Error("daily request limit exceeded"), "cota_excedida"],
    ["cobrança pendente", new Error("database disabled due to billing"), "pagamento_ou_suspensao"],
    ["conta suspensa", new Error("account suspended"), "pagamento_ou_suspensao"],
    ["credencial recusada", new Error("Unauthorized"), "credencial_rejeitada"],
    ["senha errada", new Error("WRONGPASS invalid credentials"), "credencial_rejeitada"],
    ["rate limit", new Error("too many requests"), "limite_de_taxa"],
    ["timeout", new Error("The operation timed out"), "timeout"],
    ["rede", new Error("fetch failed"), "indisponivel"],
    ["dns", new Error("getaddrinfo ENOTFOUND host"), "indisponivel"],
    ["não catalogada", new Error("algo muito estranho"), "desconhecido"],
  ];

  for (const [nome, erro, classeEsperada] of casos) {
    test(`${nome} → ${classeEsperada}`, () => {
      expect(classificarFalhaDatastore(erro, ENV_OK).classe).toBe(classeEsperada);
    });
  }

  test("configuração ausente vence qualquer outro sinal", () => {
    expect(classificarFalhaDatastore(new Error("Unauthorized"), {}).classe).toBe("configuracao_ausente");
  });

  test("sinal específico de cobrança vence o 401 genérico do provedor", () => {
    const erro = Object.assign(new Error("database is disabled"), { status: 401 });
    expect(classificarFalhaDatastore(erro, ENV_OK).classe).toBe("pagamento_ou_suspensao");
  });

  test("402 sem palavra-chave ainda é cobrança", () => {
    const erro = Object.assign(new Error("erro do provedor"), { status: 402 });
    expect(classificarFalhaDatastore(erro, ENV_OK).classe).toBe("pagamento_ou_suspensao");
  });

  test("extrai o status HTTP do provedor quando ele existe", () => {
    const erro = Object.assign(new Error("recusado"), { status: 403 });
    expect(classificarFalhaDatastore(erro, ENV_OK).statusProvedor).toBe(403);
  });

  test("a mensagem devolvida já vem higienizada", () => {
    const erro = new Error(`Unauthorized for ${ENV_OK.KV_REST_API_TOKEN}`);
    const { mensagem } = classificarFalhaDatastore(erro, ENV_OK);
    expect(mensagem).not.toContain(ENV_OK.KV_REST_API_TOKEN);
  });

  test("nunca lança, seja qual for a entrada", () => {
    for (const entrada of [null, undefined, 0, "", [], {}, new Error("")]) {
      expect(() => classificarFalhaDatastore(entrada, ENV_OK)).not.toThrow();
    }
  });

  test("toda classe tem uma ação sugerida não vazia", () => {
    for (const acao of Object.values(ACAO_SUGERIDA)) {
      expect(acao.trim().length).toBeGreaterThan(0);
    }
  });
});
