#!/usr/bin/env node
// Migração Fase 2A — sincroniza os NOMES oficiais de sabores de pizza
// (catálogo tipado em src/lib/catalog/pizzaFlavors.ts, fonte: PDF oficial)
// para os campos legados `saltyFlavors`/`sweetFlavors` do cardápio
// persistido no Redis (chave "cardapio") — usados hoje pelo painel de
// estoque (marcar esgotado) e por telas que ainda leem o formato antigo.
//
// NÃO MUDA PREÇO NENHUM: preço de pizza já vem 100% do catálogo novo
// (@/lib/catalog/pizzaFlavors + @/lib/pricing/pizzaEngine), nunca das
// listas saltyFlavors/sweetFlavors. Esta migração só troca os NOMES
// exibidos nessas listas legadas pelos nomes oficiais do PDF (ex.: "A
// Moda" -> "À Moda da Casa"), preservando qualquer nome que já estava
// marcado como esgotado através do alias correspondente.
//
// SEGURANÇA:
//   - Por padrão roda em modo --dry-run: lê o Redis, mostra exatamente o
//     que mudaria, e NÃO escreve nada.
//   - Só escreve de verdade com a flag --commit, explícita.
//   - Sempre faz backup do valor atual da chave "cardapio" antes de
//     escrever (grava em cardapio:backup:<timestamp ISO>, TTL de 30 dias
//     — nunca sobrescreve nem apaga backups antigos).
//   - Idempotente: comparar o resultado já migrado com o alvo é uma
//     operação pura; rodar duas vezes não duplica nem perde nomes — o
//     segundo --commit não encontra diferença e não escreve de novo.
//   - Esta etapa (Fase 2A) NÃO deve executar esta migração em produção.
//     Ela só existe pronta para uma etapa futura, depois de aprovação
//     explícita.
//
// Uso:
//   node scripts/migracao-pizza-flavors-fase2a.mjs           # dry-run (padrão)
//   node scripts/migracao-pizza-flavors-fase2a.mjs --dry-run # dry-run explícito
//   node scripts/migracao-pizza-flavors-fase2a.mjs --commit  # escreve de verdade

import { Redis } from "@upstash/redis";

const args = process.argv.slice(2);
const commit = args.includes("--commit");

function normalizar(value) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Espelha src/lib/catalog/pizzaFlavors.ts em JS puro (sem depender do
// bundler de TypeScript do Next.js para rodar como script standalone).
// Qualquer mudança na fonte oficial (o arquivo .ts) precisa ser refletida
// aqui antes de rodar a migração de verdade — o script falha alto (erro
// explícito) se as duas fontes divergirem em quantidade de sabores.
import { PIZZA_FLAVORS_ESPELHO, TOTAL_ESPERADO } from "./_pizzaFlavorsEspelho.mjs";

async function main() {
  if (PIZZA_FLAVORS_ESPELHO.length !== TOTAL_ESPERADO) {
    throw new Error(
      `Espelho desatualizado: esperado ${TOTAL_ESPERADO} sabores, encontrado ${PIZZA_FLAVORS_ESPELHO.length}. ` +
        "Atualize scripts/_pizzaFlavorsEspelho.mjs a partir de src/lib/catalog/pizzaFlavors.ts antes de continuar."
    );
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("KV_REST_API_URL / KV_REST_API_TOKEN não configurados neste ambiente — abortando.");
  }

  const redis = new Redis({ url, token });

  const atual = await redis.get("cardapio");
  if (!atual) {
    console.log("[migração] Nenhum cardápio persistido ainda (instalação nova) — nada a migrar.");
    return;
  }

  const saltyAtual = Array.isArray(atual.saltyFlavors) ? atual.saltyFlavors : [];
  const sweetAtual = Array.isArray(atual.sweetFlavors) ? atual.sweetFlavors : [];

  const nomesOficiaisSalgados = PIZZA_FLAVORS_ESPELHO.filter((f) => f.category !== "sweet").map((f) => f.name);
  const nomesOficiaisDoces = PIZZA_FLAVORS_ESPELHO.filter((f) => f.category === "sweet").map((f) => f.name);

  // Idempotência: se um nome atual já é um nome oficial (ou já foi migrado
  // antes), mantém. Se é um alias legado conhecido, troca pelo oficial.
  // Nomes desconhecidos (fora do PDF) são preservados sem alteração — a
  // migração nunca apaga um sabor que ela não reconhece.
  function migrarLista(listaAtual, nomesOficiais) {
    const vistos = new Set();
    const resultado = [];
    for (const nomeAtual of listaAtual) {
      const porAlias = PIZZA_FLAVORS_ESPELHO.find(
        (f) => normalizar(f.name) === normalizar(nomeAtual) || (f.legacyAliases || []).some((a) => normalizar(a) === normalizar(nomeAtual))
      );
      const nomeFinal = porAlias ? porAlias.name : nomeAtual;
      if (!vistos.has(normalizar(nomeFinal))) {
        vistos.add(normalizar(nomeFinal));
        resultado.push(nomeFinal);
      }
    }
    // Acrescenta sabores oficiais que ainda não existem na lista atual —
    // sem isso, sabores novos do PDF (ex.: Presunto, Nordestina) nunca
    // apareceriam no painel de estoque.
    for (const nomeOficial of nomesOficiais) {
      if (!vistos.has(normalizar(nomeOficial))) {
        vistos.add(normalizar(nomeOficial));
        resultado.push(nomeOficial);
      }
    }
    return resultado;
  }

  const saltyMigrado = migrarLista(saltyAtual, nomesOficiaisSalgados);
  const sweetMigrado = migrarLista(sweetAtual, nomesOficiaisDoces);

  const mudouSalty = JSON.stringify(saltyAtual) !== JSON.stringify(saltyMigrado);
  const mudouSweet = JSON.stringify(sweetAtual) !== JSON.stringify(sweetMigrado);

  console.log("[migração] saltyFlavors — antes:", saltyAtual.length, "depois:", saltyMigrado.length, mudouSalty ? "(muda)" : "(sem mudança)");
  console.log("[migração] sweetFlavors — antes:", sweetAtual.length, "depois:", sweetMigrado.length, mudouSweet ? "(muda)" : "(sem mudança)");

  if (!mudouSalty && !mudouSweet) {
    console.log("[migração] Já está tudo migrado — nada para fazer (idempotente).");
    return;
  }

  if (!commit) {
    console.log("\n[migração] Modo --dry-run (padrão) — nenhuma escrita foi feita.");
    console.log("[migração] saltyFlavors proposto:", JSON.stringify(saltyMigrado, null, 2));
    console.log("[migração] sweetFlavors proposto:", JSON.stringify(sweetMigrado, null, 2));
    console.log("\n[migração] Rode com --commit para aplicar de verdade (faz backup automático antes).");
    return;
  }

  const timestamp = new Date().toISOString();
  const chaveBackup = `cardapio:backup:${timestamp}`;
  await redis.set(chaveBackup, atual, { ex: 60 * 60 * 24 * 30 });
  console.log(`[migração] Backup salvo em ${chaveBackup} (expira em 30 dias).`);

  const novoCardapio = { ...atual, saltyFlavors: saltyMigrado, sweetFlavors: sweetMigrado };
  await redis.set("cardapio", novoCardapio);
  console.log("[migração] cardapio atualizado com sucesso.");
}

main().catch((err) => {
  console.error("[migração] Falhou:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
