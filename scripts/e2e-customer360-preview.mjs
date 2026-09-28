import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const playwrightModulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (!playwrightModulePath) throw new Error("PLAYWRIGHT_MODULE_PATH ausente.");
const { chromium } = await import(pathToFileURL(playwrightModulePath).href);

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const outputDir = process.env.PREVIEW_OUTPUT_DIR ?? "/tmp/customer360-preview";
await fs.mkdir(outputDir, { recursive: true });

async function validate(viewport, fileName) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const externalRequests = [];
  const behaviorPosts = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
    if (url.pathname === "/api/comportamento/evento") behaviorPosts.push(request.url());
  });

  const response = await page.goto(baseUrl + "/dev/customer360", { waitUntil: "networkidle" });
  if (!response || response.status() !== 200) {
    throw new Error("Customer360 Preview não respondeu 200: " + (response?.status() ?? "sem resposta"));
  }

  await page.getByText("PREVIEW · DADOS FICTÍCIOS", { exact: true }).waitFor();
  await page.getByRole("heading", { name: /Customer 360: a jornada antes do pedido/ }).waitFor();
  await page.getByText("A coleta real continua desligada.", { exact: false }).waitFor();

  await page.getByRole("button", { name: /Visita 1/ }).click();
  await page.getByRole("heading", { name: "Terminou em pedido" }).waitFor();
  await page.getByText("Pedido criado pelo servidor", { exact: true }).waitFor();

  await page.getByRole("button", { name: /Visita 2/ }).click();
  await page.getByRole("heading", { name: "Não terminou em pedido" }).waitFor();
  await page.getByText("Saiu durante o checkout", { exact: true }).waitFor();

  if (consoleErrors.length || pageErrors.length) {
    throw new Error("Erros de browser: console=" + consoleErrors.join(" | ") + " page=" + pageErrors.join(" | "));
  }
  if (externalRequests.length) {
    throw new Error("Preview tentou acessar rede externa: " + externalRequests.join(" | "));
  }
  if (behaviorPosts.length) {
    throw new Error("Preview tentou registrar comportamento real.");
  }

  await page.screenshot({ path: path.join(outputDir, fileName), fullPage: true });
  await browser.close();

  return {
    viewport,
    fileName,
    status: "ok",
    consoleErrors: 0,
    pageErrors: 0,
    externalRequests: 0,
    behaviorPosts: 0,
  };
}

const desktop = await validate({ width: 1440, height: 1100 }, "customer360-desktop.png");
const mobile = await validate({ width: 390, height: 844 }, "customer360-mobile.png");

const report = {
  mode: "hermetic-customer360-preview",
  productionReads: false,
  productionWrites: false,
  behaviorCollection: false,
  externalRequests: 0,
  fixture: "local-deterministic",
  gitSha: process.env.PREVIEW_GIT_SHA ?? null,
  desktop,
  mobile,
};

await fs.writeFile(path.join(outputDir, "preview-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
