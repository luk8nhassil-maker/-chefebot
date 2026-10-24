import { describe, expect, it } from "vitest";
import { cnpjValido, correspondeEmpresaVinculada, resolverVinculoWlg, type VinculoWlg } from "./wlgVinculos";

const empresaA: VinculoWlg = {
  tenantId: "pizza-a", empresaId: "empresa-wlg-a",
  cnpj: "11222333000181", habilitado: true, homologacaoConcluida: true,
};
const empresaB: VinculoWlg = {
  tenantId: "pizza-b", empresaId: "empresa-wlg-b",
  cnpj: "12345678000195", habilitado: true, homologacaoConcluida: true,
};

describe("WLG — isolamento de empresas", () => {
  it("valida CNPJ pelos dígitos verificadores", () => {
    expect(cnpjValido(empresaA.cnpj)).toBe(true);
    expect(cnpjValido("00000000000000")).toBe(false);
    expect(cnpjValido("11222333000182")).toBe(false);
  });
  it("sem tenant autenticado NÃO escolhe a primeira empresa", () => {
    expect(resolverVinculoWlg(null, [empresaA, empresaB])).toEqual({
      ok: false, codigo: "tenant_ausente",
    });
  });
  it("seleciona empresa exclusivamente pelo tenant servidor", () => {
    const a = resolverVinculoWlg("pizza-a", [empresaA, empresaB]);
    const b = resolverVinculoWlg("pizza-b", [empresaA, empresaB]);
    expect(a.ok && a.vinculo.empresaId).toBe("empresa-wlg-a");
    expect(b.ok && b.vinculo.empresaId).toBe("empresa-wlg-b");
  });
  it("nega empresa estranha ou múltiplos vínculos ambíguos", () => {
    expect(resolverVinculoWlg("pizza-c", [empresaA]).ok).toBe(false);
    expect(resolverVinculoWlg("pizza-a", [empresaA, empresaA])).toEqual({
      ok: false, codigo: "ambiguo",
    });
  });
  it("não libera empresa antes de homologação individual", () => {
    expect(resolverVinculoWlg("pizza-a", [{ ...empresaA, homologacaoConcluida: false }])).toEqual({
      ok: false, codigo: "nao_homologado",
    });
  });
  it("não libera empresaId ou CNPJ de outro restaurante", () => {
    expect(correspondeEmpresaVinculada(empresaA, empresaB.empresaId, empresaA.cnpj)).toBe(false);
    expect(correspondeEmpresaVinculada(empresaA, empresaA.empresaId, empresaB.cnpj)).toBe(false);
    expect(correspondeEmpresaVinculada(empresaA, empresaA.empresaId, empresaA.cnpj)).toBe(true);
  });
  it("um vínculo com CNPJ inválido falha fechado", () => {
    expect(resolverVinculoWlg("pizza-a", [{ ...empresaA, cnpj: "123" }])).toEqual({
      ok: false, codigo: "dados_invalidos",
    });
  });
});
