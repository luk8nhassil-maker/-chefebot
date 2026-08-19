export function escritaSalaoBloqueadaNoPreview(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

export const ERRO_ESCRITA_SALAO_PREVIEW = "Ações que alteram o Salão ficam bloqueadas no Preview.";
