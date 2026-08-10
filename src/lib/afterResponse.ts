import { after } from "next/server";

/**
 * Agenda um efeito para depois que a resposta HTTP já foi enviada.
 * Retorna false quando chamado fora de um contexto de request do Next
 * (principalmente testes unitários diretos), permitindo fallback seguro.
 * Commit de continuidade: dispara a automação auditada da branch.
 */
export function agendarTarefaAposResposta(tarefa: () => void | Promise<void>): boolean {
  try {
    after(async () => {
      await tarefa();
    });
    return true;
  } catch {
    return false;
  }
}
