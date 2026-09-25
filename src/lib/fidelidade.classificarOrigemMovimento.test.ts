import { describe, expect, test } from "vitest";
import { classificarOrigemMovimentoPontos, construirEventoIdPontos } from "./fidelidade";

describe("classificarOrigemMovimentoPontos (correção do #445 — nunca por regex em texto humano)", () => {
  test("indicação: eventoId prefixado por indicacao:", () => {
    expect(classificarOrigemMovimentoPontos("indicacao:cli_abc:primeira-compra:ped_1")).toBe("indicacao");
  });

  test("apoio recorrente: eventoId prefixado por apoio:", () => {
    expect(classificarOrigemMovimentoPontos("apoio:cli_abc:expediente:2026-09-25")).toBe("apoio");
  });

  test("crédito comum do pedido: eventoId construído por construirEventoIdPontos", () => {
    expect(classificarOrigemMovimentoPontos(construirEventoIdPontos("ped_1", "confirmado"))).toBe("pedido");
    expect(classificarOrigemMovimentoPontos(construirEventoIdPontos("ped_1", "cancelado"))).toBe("pedido");
    expect(classificarOrigemMovimentoPontos(construirEventoIdPontos("ped_1", "estornado"))).toBe("pedido");
    expect(classificarOrigemMovimentoPontos(construirEventoIdPontos("ped_1", "resgatado"))).toBe("pedido");
    expect(classificarOrigemMovimentoPontos(construirEventoIdPontos("ped_1", "ajuste"))).toBe("pedido");
  });

  test("eventoId ausente ou desconhecido cai em 'outro', nunca inventa indicação", () => {
    expect(classificarOrigemMovimentoPontos(null)).toBe("outro");
    expect(classificarOrigemMovimentoPontos(undefined)).toBe("outro");
    expect(classificarOrigemMovimentoPontos("formato-legado-desconhecido")).toBe("outro");
  });

  test("descrição em texto livre contendo 'indicação' nunca influencia a classificação (só o eventoId importa)", () => {
    // O eventoId é o único dado estruturado — mesmo que o motivo (texto para
    // exibição) mencione "indicação", sem o prefixo correto isso é 'outro'.
    expect(classificarOrigemMovimentoPontos("ajuste:ped_1:corrigido por indicação manual do admin")).toBe("pedido");
  });
});
