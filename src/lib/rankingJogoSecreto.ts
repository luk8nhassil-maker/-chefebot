import "server-only";

import { createHash } from "crypto";

export const REGRA_JOGO_SECRETO_VERSAO = "ranking-jogo-secreto-v1";
export const DIAS_REVELACAO_RANKING = 30;

const TITULOS = [
  "Chef", "Mestre", "Capitão", "Lenda", "Guardião", "Ninja", "Caçador", "Rei",
] as const;

const CODIGOS = [
  "Fantasma", "Pepperoni", "Brasa", "Fatia", "Forno", "Molho", "Queijo", "Pizza",
  "Crocante", "Secreto", "Noturno", "Supremo", "Turbo", "Misterioso", "Chama", "Sabor",
] as const;

function numeroDoHash(hex: string, inicio: number, tamanho: number): number {
  return Number.parseInt(hex.slice(inicio, inicio + tamanho), 16);
}

export function codinomeSecretoRanking(clienteId: string, temporadaId: string): string {
  const hash = createHash("sha256").update(`${temporadaId}:${clienteId}`).digest("hex");
  const titulo = TITULOS[numeroDoHash(hash, 0, 2) % TITULOS.length]!;
  const codigo = CODIGOS[numeroDoHash(hash, 2, 2) % CODIGOS.length]!;
  const numero = (numeroDoHash(hash, 4, 4) % 90) + 10;
  return `${titulo} ${codigo} ${numero}`;
}

export function fimJanelaRevelacao(encerradaEm: string): string | null {
  const encerradaMs = Date.parse(encerradaEm);
  if (!Number.isFinite(encerradaMs)) return null;
  return new Date(encerradaMs + DIAS_REVELACAO_RANKING * 24 * 60 * 60 * 1000).toISOString();
}

export function janelaRevelacaoAtiva(encerradaEm: string, agora = Date.now()): boolean {
  const fim = fimJanelaRevelacao(encerradaEm);
  return fim !== null && agora <= Date.parse(fim);
}
