// withTimeout.ts — limite de tempo isolado para chamadas Redis do módulo MCP.
// Nunca usado fora de src/mcp: o resto do bot tem seus próprios timeouts (ou
// nenhum, deliberadamente) e este helper não deve vazar para lá.

export class McpTimeoutError extends Error {
  constructor(operacao: string) {
    super(`mcp_timeout:${operacao}`);
    this.name = 'McpTimeoutError';
  }
}

export function comTimeout<T>(promessa: Promise<T>, ms: number, operacao: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new McpTimeoutError(operacao)), ms);
    promessa.then(
      (valor) => { clearTimeout(timer); resolve(valor); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
