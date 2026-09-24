import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SignJWT } from "jose";

const playwrightModulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (!playwrightModulePath) {
  throw new Error("PLAYWRIGHT_MODULE_PATH ausente no Preview hermético.");
}
const { chromium } = await import(pathToFileURL(playwrightModulePath).href);

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) {
  throw new Error("AUTH_SECRET efêmero ausente no Preview hermético.");
}

const outputDir = process.env.PREVIEW_OUTPUT_DIR ?? "/tmp/research-preview";
await fs.mkdir(outputDir, { recursive: true });

const fixture = {
  ok: true,
  tenantId: "preview-fixture",
  periodoDias: 90,
  modo: "dry-run",
  janela: {
    inicioIso: "2026-06-26T12:00:00.000Z",
    fimIso: "2026-09-24T12:00:00.000Z",
    primeiroEventoObservadoIso: "2026-06-26T13:00:00.000Z",
    ultimoEventoObservadoIso: "2026-09-23T22:00:00.000Z",
  },
  cobertura: {
    pedidosValidosObservados: 101,
    ocasioesCompraObservadas: 96,
    clientesObservados: 77,
    intervalosEntreComprasObservados: 29,
    intervalosEntreOcasioesObservados: 29,
    clientesComHistoricoSuficienteParaQueda: 18,
    clientesSemHistoricoSuficienteParaQueda: 59,
    primeiraCompraObservadaNaoEquivaleAPrimeiraCompraVitalicia: true,
  },
  segmentacaoQueda: {
    minimoOcasioesParaCompararRitmo: 3,
    minimoIntervalosHistoricosPorCliente: 2,
    regra: "gap_atual_supera_quantil_do_cliente_e_da_populacao",
  },
  calibracao: {
    medianaIntervaloDias: 6,
    p75IntervaloDias: 11,
    p90IntervaloDias: 18,
    origemDosLimiares: "quantis_do_historico_observado",
  },
  estadosAtuais: {
    S0: 0,
    S1: 42,
    S2: 15,
    S3: 0,
    S4: 12,
    S5: 5,
    S6: 3,
    S7: 0,
    S8: 0,
    S9: 0,
    S10: 0,
    S11: 0,
  },
  momentos: {
    M0: { id: "M0", nome: "Baseline passivo", tipo: "baseline", quantidade: 77, perguntaPrincipal: null, objetivo: "Observar comportamento sem interromper o cliente.", calculavelComAnalytics: true },
    M1: { id: "M1", nome: "Primeira compra observada", tipo: "oportunidade_na_janela", quantidade: 25, perguntaPrincipal: "fixture", objetivo: "Entender os mecanismos reais de escolha e aquisição.", calculavelComAnalytics: true },
    M2: { id: "M2", nome: "Segunda compra observada", tipo: "oportunidade_na_janela", quantidade: 11, perguntaPrincipal: "fixture", objetivo: "Entender o que transforma primeira compra em retorno.", calculavelComAnalytics: true },
    M3: { id: "M3", nome: "Recorrência em formação", tipo: "candidato_atual", quantidade: 15, perguntaPrincipal: "fixture", objetivo: "Entender memória de marca e conjunto competitivo espontâneo.", calculavelComAnalytics: true },
    M4: { id: "M4", nome: "Recorrente atual", tipo: "candidato_atual", quantidade: 12, perguntaPrincipal: "fixture", objetivo: "Descobrir vulnerabilidades mesmo entre clientes recorrentes.", calculavelComAnalytics: true },
    M5: { id: "M5", nome: "Queda de frequência", tipo: "candidato_atual", quantidade: 5, perguntaPrincipal: "fixture", objetivo: "Descobrir causas reais de esfriamento sem presumir abandono.", calculavelComAnalytics: true },
    M6: { id: "M6", nome: "Retorno após ausência", tipo: "oportunidade_na_janela", quantidade: 3, perguntaPrincipal: "fixture", objetivo: "Entender gatilhos reais de recuperação.", calculavelComAnalytics: true },
    M7: { id: "M7", nome: "Fricção resolvida", tipo: "nao_calculado", quantidade: 0, perguntaPrincipal: "fixture", objetivo: "Localizar o ponto da jornada em que a experiência falhou.", calculavelComAnalytics: false },
    M8: { id: "M8", nome: "Abandono de carrinho ou checkout", tipo: "nao_calculado", quantidade: 0, perguntaPrincipal: "fixture", objetivo: "Descobrir fricções de conversão sem interromper o checkout.", calculavelComAnalytics: false },
    M9: { id: "M9", nome: "Primeira leitura da fidelidade", tipo: "nao_calculado", quantidade: 0, perguntaPrincipal: "fixture", objetivo: "Medir compreensão espontânea.", calculavelComAnalytics: false },
    M10: { id: "M10", nome: "Compartilhamento ou indicação", tipo: "nao_calculado", quantidade: 0, perguntaPrincipal: "fixture", objetivo: "Entender motivação social real para indicar.", calculavelComAnalytics: false },
    M11: { id: "M11", nome: "Cliente indicado que compra", tipo: "nao_calculado", quantidade: 0, perguntaPrincipal: "fixture", objetivo: "Medir influência real.", calculavelComAnalytics: false },
    M12: { id: "M12", nome: "Painel longitudinal de ocasiões", tipo: "nao_calculado", quantidade: 0, perguntaPrincipal: "fixture", objetivo: "Observar ocasiões.", calculavelComAnalytics: false },
    M13: { id: "M13", nome: "Compra atípica", tipo: "nao_calculado", quantidade: 0, perguntaPrincipal: "fixture", objetivo: "Descobrir ocasiões atípicas.", calculavelComAnalytics: false },
    M14: { id: "M14", nome: "Entrevista de aprofundamento", tipo: "nao_calculado", quantidade: 0, perguntaPrincipal: null, objetivo: "Aprofundar padrões.", calculavelComAnalytics: false },
  },
  segurancaContato: {
    envioAutomaticoAtivo: false,
    elegibilidadeFinalCalculada: false,
    candidatosComportamentaisNaoSaoElegiveisFinais: true,
    motivo: "Fixture de Preview: contato real permanece bloqueado.",
    politica: { cooldownDias: 14, maxContatosEm90Dias: 3 },
    fontesPendentes: [
      "estado_operacional_do_pedido",
      "pagamento_ou_pix_pendente",
      "problema_ou_disputa_aberta",
      "opt_out",
      "identidade_confirmada",
      "historico_de_exposicoes_de_pesquisa",
    ],
  },
  observacoes: [
    "Preview hermético com fixture local.",
    "Nenhum dado de produção foi consultado.",
  ],
};

async function validar(viewport, fileName) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const externalRequests = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      externalRequests.push(request.url());
    }
  });

  const token = await new SignJWT({ username: "preview-research", name: "Preview Research", role: "dev" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(authSecret));

  await context.addCookies([
    {
      name: "auth-token",
      value: token,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "auth-user",
      value: JSON.stringify({ name: "Preview Research", role: "dev" }),
      url: baseUrl,
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);

  await page.route("**/api/admin/pesquisa-preferencia/dry-run**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Cache-Control": "no-store",
        "X-ChefeBot-Research-Mode": "dry-run",
      },
      body: JSON.stringify(fixture),
    });
  });

  const response = await page.goto(`${baseUrl}/dev/pesquisa-preferencia`, {
    waitUntil: "networkidle",
  });
  if (!response || response.status() !== 200) {
    throw new Error(`Painel não respondeu 200: ${response?.status() ?? "sem resposta"}`);
  }

  await page.getByRole("heading", { name: "Motor de Preferência" }).waitFor();
  await page.getByText("DRY-RUN · SEM ENVIO", { exact: true }).waitFor();
  await page.getByText("Contato real permanece bloqueado", { exact: true }).waitFor();
  await page.getByText("101", { exact: true }).waitFor();
  await page.getByText("96", { exact: true }).waitFor();
  await page.getByText("77", { exact: true }).first().waitFor();
  await page.getByText("Histórico suficiente", { exact: true }).waitFor();
  await page.getByText("Histórico insuficiente", { exact: true }).waitFor();
  await page.getByText("Não entram em M5/S6", { exact: true }).waitFor();
  await page.getByText("M1 · Primeira compra observada", { exact: true }).waitFor();
  await page.getByText("M2 · Segunda compra observada", { exact: true }).waitFor();
  await page.getByText("M5 · Queda de frequência", { exact: true }).waitFor();
  if (await page.getByText("Assinatura do ChefeBot", { exact: true }).count()) {
    throw new Error("Gate de assinatura sobrepôs o painel interno de pesquisa.");
  }

  const bodyText = await page.locator("body").innerText();
  if (!bodyText.includes("1 contato a cada 14 dias") || !bodyText.includes("no máximo 3 em 90 dias")) {
    throw new Error("Política de contato não apareceu corretamente no painel.");
  }
  if (bodyText.includes("telefone") || bodyText.includes("endereço") || bodyText.includes("cpf")) {
    throw new Error("Painel exibiu campo pessoal proibido.");
  }
  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`Erros de browser: console=${consoleErrors.join(" | ")} page=${pageErrors.join(" | ")}`);
  }
  if (externalRequests.length) {
    throw new Error(`Preview tentou acessar rede externa: ${externalRequests.join(" | ")}`);
  }

  await page.screenshot({
    path: path.join(outputDir, fileName),
    fullPage: true,
  });

  await browser.close();
  return {
    viewport,
    fileName,
    status: "ok",
    consoleErrors: 0,
    pageErrors: 0,
    externalRequests: 0,
  };
}

const desktop = await validar({ width: 1440, height: 1100 }, "pesquisa-preferencia-desktop.png");
const mobile = await validar({ width: 390, height: 844 }, "pesquisa-preferencia-mobile.png");

const report = {
  mode: "hermetic-browser-preview",
  productionDataRead: false,
  productionWrites: false,
  whatsappReal: false,
  pixReal: false,
  printingReal: false,
  stockReal: false,
  loyaltyReal: false,
  fixture: "local-deterministic",
  gitSha: process.env.PREVIEW_GIT_SHA ?? null,
  desktop,
  mobile,
};

await fs.writeFile(path.join(outputDir, "preview-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
