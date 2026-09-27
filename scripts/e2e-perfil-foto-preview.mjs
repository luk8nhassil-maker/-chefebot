import fs from "node:fs/promises";
import path from "node:path";

function falhar(mensagem) {
  throw new Error(mensagem);
}

const playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH;
if (!playwrightPath) falhar("PLAYWRIGHT_MODULE_PATH ausente");
const { chromium } = await import(playwrightPath);

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";
const outDir = process.env.PREVIEW_OUTPUT_DIR || "/tmp/perfil-foto-preview";
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

try {
  await page.goto(`${baseUrl}/cliente`, { waitUntil: "domcontentloaded", timeout: 60000 });

  const abrirPreview = page.getByRole("button", { name: "Abrir Preview local seguro" });
  await abrirPreview.waitFor({ state: "visible", timeout: 60000 });
  await abrirPreview.click();

  await page.getByText("Preview local seguro · dados fictícios · nenhuma integração real é acionada.").waitFor({ state: "visible", timeout: 15000 });

  // 1) Presente garantido, mas bloqueado até a missão única da foto.
  await page.getByRole("button", { name: /Meus presentes/i }).click();
  await page.getByText(/Seu presente está garantido/).waitFor({ state: "visible" });
  await page.getByText("Você faz esta missão só uma vez.").waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(outDir, "01-presente-garantido-foto-pendente.png"), fullPage: true });

  await page.getByRole("button", { name: "Voltar" }).click();

  // 2) Antes do opt-in, Ranking não revela posição, rivais, score ou distância.
  const conviteRanking = page.getByRole("button", { name: "Participar do Ranking do Chefe" });
  await conviteRanking.waitFor({ state: "visible" });
  const textoConvite = await conviteRanking.innerText();
  if (!textoConvite.includes("Entre na disputa")) falhar("Convite do Ranking não mostra o estado fechado esperado");
  for (const proibido of ["Sua posição", "Faltam ", "#5", "pontos no Ranking"]) {
    if (textoConvite.includes(proibido)) falhar(`Ranking vazou dado antes de Participar: ${proibido}`);
  }
  await page.screenshot({ path: path.join(outDir, "02-ranking-fechado-antes-de-participar.png"), fullPage: true });

  // 3) Participação explícita libera a experiência.
  await conviteRanking.click();
  await page.getByRole("dialog", { name: "Entre no Ranking do Chefe" }).waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(outDir, "03-convite-participar-ranking.png"), fullPage: true });

  await page.getByRole("button", { name: "Ativar meu Ranking" }).click();
  await page.locator(".cf-ranking-screen").waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Ranking do Chefe", { exact: true }).first().waitFor({ state: "visible" });

  const modalMomento = page.locator(".cf-ranking-momento-dialog");
  if (await modalMomento.isVisible().catch(() => false)) {
    await page.waitForTimeout(900);
    const fundo = await modalMomento.evaluate((el) => getComputedStyle(el).backgroundColor);
    if (!fundo || fundo === "rgba(0, 0, 0, 0)" || fundo === "transparent") {
      falhar("Modal contextual do Ranking ficou sem fundo após a animação");
    }
    await page.screenshot({ path: path.join(outDir, "04-modal-contextual-estavel.png"), fullPage: false });
    await page.getByRole("button", { name: "Fechar e voltar ao ranking" }).click();
  }

  await page.locator(".cf-ranking-screen").waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(outDir, "05-ranking-liberado-apos-participar.png"), fullPage: true });

  // 4) Ao voltar para a Fidelidade, o card ativo fica simples: sem avatares
  // e sem a linha ambígua de pontos. Troféu e bloco de posição ficam alinhados.
  await page.getByRole("button", { name: "Voltar para Fidelidade" }).click();
  const cardRankingAtivo = page.getByRole("button", { name: "Abrir Ranking do Chefe" });
  await cardRankingAtivo.waitFor({ state: "visible" });

  if (await cardRankingAtivo.locator(".cf-preview-faces").count() !== 0) {
    falhar("Card do Ranking ainda exibiu círculos de participantes");
  }
  if (await cardRankingAtivo.locator(".cf-preview-ranking-copy").count() !== 0) {
    falhar("Card ativo do Ranking ainda exibiu a linha inferior de pontos");
  }
  const textoCard = await cardRankingAtivo.innerText();
  if (textoCard.includes("pontos no Ranking")) {
    falhar("Card ativo do Ranking ainda exibiu o texto ambíguo de pontos");
  }

  const trophyBox = await cardRankingAtivo.locator(".cf-preview-trophy").boundingBox();
  const titleBox = await cardRankingAtivo.locator(".cf-preview-ranking-title").boundingBox();
  if (!trophyBox || !titleBox) falhar("Não foi possível medir o alinhamento do card do Ranking");
  const trophyCenter = trophyBox.y + trophyBox.height / 2;
  const titleCenter = titleBox.y + titleBox.height / 2;
  if (Math.abs(trophyCenter - titleCenter) > 4) {
    falhar(`Troféu e bloco de posição ficaram desalinhados: diferença de ${Math.abs(trophyCenter - titleCenter)}px`);
  }

  await page.screenshot({ path: path.join(outDir, "06-card-ranking-hierarquia-simplificada.png"), fullPage: true });

  await fs.writeFile(path.join(outDir, "resultado.json"), JSON.stringify({
    ok: true,
    baseUrl,
    validacoes: [
      "presente_garantido_bloqueado_por_foto",
      "missao_foto_unica",
      "ranking_sem_dados_antes_de_participar",
      "ranking_liberado_apos_participacao_explicita",
      "modal_contextual_com_fundo_apos_animacao",
      "card_ranking_sem_circulos",
      "card_ranking_sem_linha_ambigua_de_pontos",
      "card_ranking_trofeu_alinhado_ao_bloco_de_posicao"
    ]
  }, null, 2));
} finally {
  await browser.close();
}
