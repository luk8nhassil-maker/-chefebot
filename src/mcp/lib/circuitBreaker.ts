// circuitBreaker.ts — protege o restante do bot de um Redis lento/instável
// especificamente no caminho do MCP. Estado em memória do processo (não usa
// Redis para si mesmo — um circuit breaker que depende do recurso que está
// protegendo não serve para nada). Reinicia a cada cold start, o que é
// aceitável: o objetivo é só parar de insistir dentro de uma mesma instância
// quente enquanto o Redis está com problema, nunca ser uma fonte de verdade.

const LIMITE_FALHAS_CONSECUTIVAS = 5;
const JANELA_ABERTO_MS = 60_000; // 1 minuto sem tentar de novo

type EstadoCircuito = {
  falhasConsecutivas: number;
  abertoAte: number | null;
};

const estado: EstadoCircuito = {
  falhasConsecutivas: 0,
  abertoAte: null,
};

/** true = pode tentar chamar o Redis; false = circuito aberto, pular direto. */
export function circuitoPermiteTentativa(agora: number = Date.now()): boolean {
  if (estado.abertoAte === null) return true;
  if (agora >= estado.abertoAte) {
    // Meio-aberto: deixa passar uma tentativa para testar recuperação.
    estado.abertoAte = null;
    estado.falhasConsecutivas = 0;
    return true;
  }
  return false;
}

export function registrarSucessoCircuito(): void {
  estado.falhasConsecutivas = 0;
  estado.abertoAte = null;
}

export function registrarFalhaCircuito(agora: number = Date.now()): void {
  estado.falhasConsecutivas += 1;
  if (estado.falhasConsecutivas >= LIMITE_FALHAS_CONSECUTIVAS) {
    estado.abertoAte = agora + JANELA_ABERTO_MS;
  }
}

export function circuitoEstaAberto(agora: number = Date.now()): boolean {
  return estado.abertoAte !== null && agora < estado.abertoAte;
}

/** Só para testes — nunca chamado em código de produção. */
export function resetarCircuitoParaTeste(): void {
  estado.falhasConsecutivas = 0;
  estado.abertoAte = null;
}
