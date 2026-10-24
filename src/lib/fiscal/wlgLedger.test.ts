import { describe, expect, it } from "vitest";
import {
  aplicarResultadoConsulta, chaveFiscal, marcarEnvioIncerto, podeIniciarEmissao,
  registrarOperationId, reservarRegistroFiscal,
} from "./wlgLedger";

const op = "d70fdb5f-0000-4000-9000-123456789012";

describe("WLG — ledger fiscal sem duplicidade", () => {
  it("usa chave separada por pizzaria e conta final", () => {
    expect(chaveFiscal("pizza-a", "mesa-10")).not.toBe(chaveFiscal("pizza-b", "mesa-10"));
    expect(chaveFiscal("pizza-a", "mesa-10")).toBe(chaveFiscal("pizza-a", "mesa-10"));
    expect(() => chaveFiscal("pizza-a", "../pedidos")).toThrow();
  });
  it("reserva uma vez só, nunca uma nota por rodada", () => {
    const r = reservarRegistroFiscal(null, "pizza-a", "conta-10", "wlg-a")!;
    expect(r.situacao).toBe("reservada");
    expect(reservarRegistroFiscal(r, "pizza-a", "conta-10", "wlg-a")).toBeNull();
    expect(podeIniciarEmissao(r)).toBe(false);
  });
  it("timeout do POST gera estado incerto e bloqueia reenvio", () => {
    const r = reservarRegistroFiscal(null, "pizza-a", "conta-10", "wlg-a")!;
    const incerto = marcarEnvioIncerto(r);
    expect(incerto.situacao).toBe("envio_incerto");
    expect(podeIniciarEmissao(incerto)).toBe(false);
    expect(() => registrarOperationId(incerto, op)).toThrow();
  });
  it("resposta 202 PROCESSANDO não significa autorizada", () => {
    const r = reservarRegistroFiscal(null, "pizza-a", "conta-10", "wlg-a")!;
    const processando = registrarOperationId(r, op);
    expect(processando.situacao).toBe("processando");
    expect(podeIniciarEmissao(processando)).toBe(false);
    expect(aplicarResultadoConsulta(processando, { situacao: "processando", operationId: op })).toEqual(processando);
  });
  it("resposta da operação de outro pedido é recusada", () => {
    const r = registrarOperationId(reservarRegistroFiscal(null, "pizza-a", "conta-10", "wlg-a")!, op);
    expect(() => aplicarResultadoConsulta(r, {
      situacao: "autorizada", operationId: "outro-operation-id",
      chave: "1".repeat(44), autorizadaEm: "2026-10-24T22:00:00Z",
    })).toThrow("não pertence");
  });
  it("sucesso só após consulta e não volta a PROCESSANDO", () => {
    const r = registrarOperationId(reservarRegistroFiscal(null, "pizza-a", "conta-10", "wlg-a")!, op);
    const autorizada = aplicarResultadoConsulta(r, {
      situacao: "autorizada", operationId: op,
      chave: "1".repeat(44), autorizadaEm: "2026-10-24T22:00:00Z",
    });
    expect(autorizada.situacao).toBe("autorizada");
    expect(podeIniciarEmissao(autorizada)).toBe(false);
    expect(aplicarResultadoConsulta(autorizada, { situacao: "processando", operationId: op })).toBe(autorizada);
  });
  it("rejeitada ou indeterminada não dispara segunda emissão automaticamente", () => {
    const r = registrarOperationId(reservarRegistroFiscal(null, "pizza-a", "conta-10", "wlg-a")!, op);
    expect(aplicarResultadoConsulta(r, { situacao: "indeterminada", operationId: op })).toEqual(r);
    const rejeitada = aplicarResultadoConsulta(r, { situacao: "rejeitada", operationId: op, motivo: "rejeição" });
    expect(rejeitada.situacao).toBe("rejeitada");
    expect(podeIniciarEmissao(rejeitada)).toBe(false);
  });
});
