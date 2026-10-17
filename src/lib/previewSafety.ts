export const MOTIVO_PREVIEW_OPERACAO_REAL_BLOQUEADA = "preview_real_operation_blocked";

export function emPreviewVercel(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

export class OperacaoRealBloqueadaEmPreview extends Error {
  constructor(servico: string) {
    super(`${MOTIVO_PREVIEW_OPERACAO_REAL_BLOQUEADA}:${servico}`);
    this.name = "OperacaoRealBloqueadaEmPreview";
  }
}

/** Impede que clientes reais usem uma credencial espelhada acidentalmente em Preview. */
export function bloquearClienteRealEmPreview<T extends object>(cliente: T, servico: string): T {
  if (!emPreviewVercel()) return cliente;
  return new Proxy(cliente, {
    get(target, propriedade, receiver) {
      const valor = Reflect.get(target, propriedade, receiver);
      if (typeof valor !== "function") return valor;
      return () => { throw new OperacaoRealBloqueadaEmPreview(servico); };
    },
  });
}

export function bloquearOperacaoRealEmPreview(servico: string): void {
  if (emPreviewVercel()) throw new OperacaoRealBloqueadaEmPreview(servico);
}
