export const ACESSO_TEMPORARIO_CHEFEBOT_MINUTOS = 60;
export const ACESSO_TEMPORARIO_CHEFEBOT_MS = ACESSO_TEMPORARIO_CHEFEBOT_MINUTOS * 60 * 1000;

export type RegistroAcessoTemporarioChefeBot = {
  dueDate: string;
  startedAt: string;
  expiresAt: string;
};

export type EstadoAcessoTemporarioChefeBot = {
  active: boolean;
  used: boolean;
  endsAt: string | null;
  remainingMs: number;
};

export function criarRegistroAcessoTemporarioChefeBot(
  dueDate: string,
  agora = new Date(),
): RegistroAcessoTemporarioChefeBot {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("invalid_due_date");
  const startedAt = agora.toISOString();
  const expiresAt = new Date(agora.getTime() + ACESSO_TEMPORARIO_CHEFEBOT_MS).toISOString();
  return { dueDate, startedAt, expiresAt };
}

export function avaliarAcessoTemporarioChefeBot(params: {
  registro: RegistroAcessoTemporarioChefeBot | null;
  dueDate: string;
  agora?: Date;
}): EstadoAcessoTemporarioChefeBot {
  const { registro, dueDate } = params;
  if (!registro || registro.dueDate !== dueDate) {
    return { active: false, used: false, endsAt: null, remainingMs: 0 };
  }

  const expiresAtMs = Date.parse(registro.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    // Registro corrompido falha fechado para não permitir reiniciar a janela indefinidamente.
    return { active: false, used: true, endsAt: null, remainingMs: 0 };
  }

  const agoraMs = (params.agora ?? new Date()).getTime();
  const remainingMs = Math.max(0, expiresAtMs - agoraMs);
  return {
    active: remainingMs > 0,
    used: true,
    endsAt: registro.expiresAt,
    remainingMs,
  };
}
