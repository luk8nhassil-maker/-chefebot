// Configuração administrativa da Gamificação V2 — fail-closed em toda a
// superfície: sem uma linha aqui, a mecânica correspondente fica DESLIGADA
// (nunca aparece pro cliente, nunca credita bônus). O admin liga cada peça
// no seu próprio ritmo; nada é ativado por padrão.
import "server-only";
import { redis } from "./redis";
import type { ConfigCarryoverPosicao, LimiarNivelChef } from "./rankingGamificacao";

export type ConfigGamificacao = {
  // Missão semanal "Caçada ao Pódio" — 2x nas estrelas do próximo pedido
  // elegível para quem está fora do pódio há `missaoSemanalCooldownDias`.
  missaoSemanalAtiva: boolean;
  missaoSemanalMultiplicador: number;
  missaoSemanalCooldownDias: number;

  // Missão da temporada "Indique um amigo" — bônus único quando a indicação
  // já creditada (estrelasIndicacao.ts) acontece dentro de uma temporada ativa.
  missaoIndicacaoAtiva: boolean;
  missaoIndicacaoBonus: number;

  // Impulso do Pódio — bônus limitado e com teto por temporada.
  impulsoPodioAtivo: boolean;
  impulsoPodioBonus: number;
  impulsoPodioCapTemporada: number;

  // Vantagem de largada (carryover comprimido do Top 10 da temporada anterior).
  carryoverAtivo: boolean;
  carryoverTabela: ConfigCarryoverPosicao[];

  // Nível de Chef — progressão permanente, separada do ranking da temporada.
  nivelChefAtivo: boolean;
  nivelChefLimiares: LimiarNivelChef[];

  // "Coroa ameaçada" — vantagem máxima (em Estrelas) do líder sobre o #2
  // para a UI poder afirmar isso. Fail-closed: `0` (padrão) desliga a
  // mecânica — a UI mostra só a distância neutra, nunca inventa uma
  // ameaça sem essa condição matemática configurada pelo admin.
  ameacaPodioMaxGap: number;
};

export const CONFIG_GAMIFICACAO_PADRAO: ConfigGamificacao = {
  missaoSemanalAtiva: false,
  missaoSemanalMultiplicador: 2,
  missaoSemanalCooldownDias: 7,
  missaoIndicacaoAtiva: false,
  missaoIndicacaoBonus: 0,
  impulsoPodioAtivo: false,
  impulsoPodioBonus: 0,
  impulsoPodioCapTemporada: 0,
  carryoverAtivo: false,
  carryoverTabela: [],
  nivelChefAtivo: false,
  nivelChefLimiares: [],
  ameacaPodioMaxGap: 0,
};

const CHAVE_CONFIG = "config:ranking:gamificacao";

export async function obterConfigGamificacao(): Promise<ConfigGamificacao> {
  const salva = await redis.get<Partial<ConfigGamificacao>>(CHAVE_CONFIG);
  if (!salva) return CONFIG_GAMIFICACAO_PADRAO;
  // Faz merge raso com o padrão: uma config salva antes de um novo campo
  // existir nunca deixa esse campo undefined (sempre cai no fail-closed).
  return { ...CONFIG_GAMIFICACAO_PADRAO, ...salva };
}

export async function salvarConfigGamificacao(config: ConfigGamificacao): Promise<void> {
  await redis.set(CHAVE_CONFIG, config);
}
