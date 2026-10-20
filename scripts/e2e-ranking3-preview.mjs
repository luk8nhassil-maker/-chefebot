// Navegador real, APIs substituídas no cliente e servidor VERCEL_ENV=preview.
// Não exige nem aceita URL remota ou credencial operacional.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { SignJWT } from 'jose';
import { MENU } from '../src/lib/menu.ts';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3103';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Somente Preview local isolado');
if (!process.env.PLAYWRIGHT_MODULE_PATH) throw new Error('Playwright local necessário');
const playwright = await import(process.env.PLAYWRIGHT_MODULE_PATH);
const { chromium } = playwright.default ?? playwright;
const output = process.env.PREVIEW_OUTPUT_DIR || '/tmp/ranking3-preview';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await context.newPage();
const erros = [], pedidos = [], externos = [];
let leiturasCarteira = 0;
page.on('pageerror', (error) => erros.push(error.message));
const premio = { id: 'r3-2026-10-20-0-liga-1', temporadaId: 'r3-2026-10-20-0', liga: 1, tetoCents: 4700, concedidoEm: '2026-11-19T06:00:00Z', estado: 'disponivel', proximoAvisoEm: 0, revisao: 0, sabores: [{ id: 'flavor-presunto', nome: 'Presunto' }] };
// Fixture de visualização. Validação comercial real está nos testes do domínio.
const pizzaCatalog = { sizes: [{ id: 'size-f', code: 'F', label: 'Família', fatias: 12 }], flavors: [{ id: 'flavor-presunto', name: 'Presunto', category: 'tradicional', ingredients: 'Fixture', aliases: [], available: true, pricesBySizeCode: { F: 4700 } }], borders: [], addOns: [] };
await context.route('**/*', async (route) => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== new URL(base).origin) { externos.push(url.origin); return route.abort(); }
  if (!url.pathname.startsWith('/api/')) return route.continue();
  let json = {};
  if (url.pathname === '/api/cliente/ranking3') { leiturasCarteira++; json = { painel: null, premios: [premio] }; }
  else if (url.pathname === '/api/cardapio') json = { ...MENU, pizzaCatalog, esgotados: [], horario: { horaAbertura: 18, horaFechamento: 23, aberto: true } };
  else if (url.pathname === '/api/pedido-app' && request.method() === 'POST') {
    pedidos.push(request.postDataJSON());
    if (pedidos.length === 1) {
      premio.estado = 'associado';
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Falha sintética recuperável' }) });
    }
    json = { ok: true, pedidoId: 'pedido-sintetico-preview', numero: 1, total: 0, statusToken: 'referencia-sintetica-sem-valor' };
  } else if (url.pathname.startsWith('/api/pedido-app/status')) json = { ok: true, status: 'novo', pedido: { status: 'novo' } };
  else if (request.method() !== 'GET') throw new Error(`Mutação não simulada: ${url.pathname}`);
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
});
try {
  const token = await new SignJWT({ username: 'fixture', name: 'Fixture sintética', role: 'dev' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m').sign(new TextEncoder().encode('ranking3-isolated-validation-only-secret'));
  await context.addCookies([{ name: 'auth-token', value: token, url: base }]);
  await page.goto(`${base}/dev/ranking3-preview`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.getByText('⭐ Nível 1 · Ranking Normal').waitFor();
  await page.screenshot({ path: `${output}/liga1-mobile.png`, fullPage: true });
  await page.getByRole('combobox').selectOption('2');
  await page.getByText('Meta para o Nível 3: 20 Estrelas').waitFor();
  await page.screenshot({ path: `${output}/liga2-mobile.png`, fullPage: true });
  await page.getByRole('combobox').selectOption('3');
  await page.getByRole('checkbox').check();
  assert.equal(await page.getByRole('button', { name: 'Prévia — sem pedido real' }).isDisabled(), true);
  await page.screenshot({ path: `${output}/liga3-premio-mobile.png`, fullPage: true });
  await page.goto(`${base}/cliente/premios`, { waitUntil: 'networkidle' });
  await page.getByRole('checkbox', { name: 'Presunto' }).check();
  await page.evaluate(() => { localStorage.setItem('cf_nome', 'Cliente Sintético'); localStorage.setItem('cf_tel', '11900000000'); });
  await page.getByRole('button', { name: 'Continuar para o checkout' }).click();
  await page.waitForURL('**/cardapio');
  await page.getByRole('button', { name: /Sacola/ }).last().click();
  await page.getByText('Família — prêmio do Ranking').waitFor();
  await page.getByRole('button', { name: 'Ir para entrega' }).click();
  await page.getByRole('button', { name: /Buscar na loja/ }).click();
  await page.getByRole('button', { name: 'Continuar para pagamento' }).click();
  await page.getByText('Seu prêmio cobre esta pizza — sem cobrança').waitFor();
  await page.screenshot({ path: `${output}/checkout-gratis-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Finalizar pedido' }).click();
  // A resposta de erro pode ocorrer depois da reserva. O polling do catálogo
  // deve preservar a referência/ID estável para recuperar a MESMA tentativa.
  const antes = leiturasCarteira;
  await page.waitForResponse((r) => r.url().includes('/api/cardapio'));
  assert.equal(leiturasCarteira, antes); // Atualizar catálogo não repete carteira.
  assert.notEqual(await page.evaluate(() => localStorage.getItem('cf_premio_ranking3')), null);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Finalizar pedido' }).click();
  await page.getByRole('heading', { name: 'Pedido recebido!' }).waitFor();
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[0].clientRequestId, pedidos[1].clientRequestId);
  assert.deepEqual(pedidos[0], pedidos[1]);
  assert.equal(pedidos[0].premioRanking.id, premio.id);
  assert.equal(pedidos[0].itens.length, 0);
  assert.equal(pedidos[0].pagamento, 'Prêmio (sem cobrança)');
  assert.ok(pedidos[0].clientRequestId.length >= 16);
  assert.equal(pedidos[0].resgateId, undefined);
  assert.equal(await page.evaluate(() => localStorage.getItem('cf_premio_ranking3')), null);
  assert.deepEqual(erros, []);
  assert.deepEqual(externos, []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log(JSON.stringify({ resultado: 'PASS', ligas: 3, checkoutSimulado: 1, tentativas: 2, recuperacoes: 1, pedidosReais: 0, requisicoesExternas: externos.length, errosJavascript: erros.length, larguraMobile: 390 }));
} finally { await browser.close(); }
