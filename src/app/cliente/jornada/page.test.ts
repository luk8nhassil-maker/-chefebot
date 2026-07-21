import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Guarda estrutural do card "presente reservado": sem testing-library/jsdom
// neste repo (mesma abordagem de /cliente/page.test.ts e
// /cliente/pedidos/page.test.ts), então os requisitos de conteúdo/estrutura/
// animação da tela ficam garantidos aqui direto na fonte.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

function blocoRecompensasReservadas(): string {
  const inicio = fonte.indexOf("jornada.recompensasReservadas.filter");
  expect(inicio).toBeGreaterThan(-1);
  // Bloco JSX termina no fechamento do .map(...) desta seção — a próxima
  // ocorrência do fechamento `))}` na mesma indentação da trilha visual.
  const fim = fonte.indexOf("{/* Trilha visual */}", inicio);
  expect(fim).toBeGreaterThan(inicio);
  return fonte.slice(inicio, fim);
}

describe("/cliente/jornada — card de presente reservado", () => {
  test("card só é renderizado dentro do map de recompensasReservadas (nunca para disponível/fechada/resgatada)", () => {
    const bloco = blocoRecompensasReservadas();
    expect(bloco).toContain("jc-reservado-card");
    // Nenhuma outra seção da tela usa a classe do card novo — só aparece no
    // <style> (regra de animação + regra de prefers-reduced-motion) e no
    // próprio card, dentro do map de recompensasReservadas.
    const ocorrencias = fonte.split("jc-reservado-card").length - 1;
    expect(ocorrencias).toBe(3);
  });

  test("título, texto e nota secundária aprovados", () => {
    const bloco = blocoRecompensasReservadas();
    expect(bloco).toContain("Seu presente está no carrinho 🎁");
    expect(bloco).toContain("Foi adicionado grátis. Finalize seu pedido para aproveitar.");
    expect(bloco).toContain("Se o pedido for cancelado, seu presente volta para a Jornada.");
  });

  test("nome do presente é dinâmico (produtoNome da recompensa, nunca um texto fixo)", () => {
    const bloco = blocoRecompensasReservadas();
    expect(bloco).toMatch(/\{rec\.produtoNome \?\? 'Seu presente'\}/);
  });

  test("CTA 'Ver minha sacola' abre a sacola atual (abrirSacola), preservando itens e reserva existentes", () => {
    const bloco = blocoRecompensasReservadas();
    expect(bloco).toContain("Ver minha sacola");
    expect(bloco).toMatch(/onClick=\{abrirSacola\}/);
  });

  test("abrirSacola preserva o rascunho do carrinho via CF_OPEN_CART_KEY, nunca recria o pedido", () => {
    const abrirSacolaFn = fonte.match(/function abrirSacola\(\)[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(abrirSacolaFn).toContain("CF_OPEN_CART_KEY");
    expect(abrirSacolaFn).toContain("window.location.href = '/pedido'");
  });

  test("recompensa disponível continua exibindo 'Usar no próximo pedido'", () => {
    expect(fonte).toContain("Usar no próximo pedido");
  });

  test("recompensa fechada continua exibindo 'Abrir meu presente'", () => {
    expect(fonte).toContain("Abrir meu presente");
  });

  test("recompensa resgatada nunca é renderizada — a tela só mapeia caixasFechadas/recompensasDisponiveis/recompensasReservadas", () => {
    // O card novo (e qualquer outro) só existe dentro de um desses três
    // arrays; "historico" (onde ficam resgatada/expirada/cancelada/suspensa)
    // nunca é lido para render nesta tela.
    expect(fonte).not.toMatch(/jornada\.historico/);
  });

  test("animação roda uma vez só (sem loop/infinite) e respeita prefers-reduced-motion sem esconder conteúdo", () => {
    expect(fonte).toContain("@keyframes jcReservadoIn");
    expect(fonte).toContain("@keyframes jcReservadoGiftPop");
    expect(fonte).toContain("@keyframes jcReservadoCheckIn");
    expect(fonte).not.toMatch(/jcReservado[A-Za-z]*\s+[\d.]+m?s[^;]*infinite/);
    expect(fonte).toContain("@media (prefers-reduced-motion: reduce)");
    const reducedMotionBlock = fonte.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\}\n/)?.[0] ?? "";
    expect(reducedMotionBlock).toContain("animation: none");
    // Desligar a animação via `animation: none` nunca remove o conteúdo —
    // opacity/transform finais só existem dentro do keyframe, nunca no
    // style inline base dos elementos do card.
    const bloco = blocoRecompensasReservadas();
    expect(bloco).not.toMatch(/style=\{\{[^}]*opacity:\s*0/);
  });

  test("duração das animações fica entre 500 e 700ms no total (entrada + celebração + confirmação)", () => {
    const duracaoCard = Number(fonte.match(/jcReservadoIn (\d+)ms/)?.[1] ?? 0);
    const duracaoGift = Number(fonte.match(/jcReservadoGiftPop (\d+)ms/)?.[1] ?? 0);
    const checkMatch = fonte.match(/jcReservadoCheckIn (\d+)ms ease-out (\d+)ms/);
    const duracaoCheckTotal = Number(checkMatch?.[1] ?? 0) + Number(checkMatch?.[2] ?? 0);
    expect(duracaoCard).toBeGreaterThan(0);
    expect(duracaoGift).toBeGreaterThan(0);
    expect(Math.max(duracaoCard, duracaoGift, duracaoCheckTotal)).toBeGreaterThanOrEqual(500);
    expect(Math.max(duracaoCard, duracaoGift, duracaoCheckTotal)).toBeLessThanOrEqual(700);
  });

  test("card reservado só renderiza reserva CONFIRMADA pela reconciliação (referência local ou pedido real)", () => {
    expect(fonte).toMatch(/recompensasReservadas\.filter\(\(rec\) => rec\.reservaPedidoId \|\| rec\.recompensaId === reservaConfirmadaId\)/);
  });

  test("reconciliação usa o módulo compartilhado e cobre reconstruir/liberar", () => {
    expect(fonte).toContain("reconciliarReservaComReferencia");
    expect(fonte).toContain("lerReferenciaRecompensa(localStorage)");
    expect(fonte).toContain("gravarReferenciaRecompensa(localStorage");
    // Pizza sem o sabor escolhido: libera a reserva (nunca inventa escolha,
    // nunca consome a recompensa) e avisa o cliente com clareza.
    expect(fonte).toContain("/api/cliente/jornada-chef/cancelar-reserva");
    expect(fonte).toContain("Seu presente voltou para a Jornada — escolha o sabor de novo para usá-lo no próximo pedido.");
  });

  test("reservar só navega para a sacola depois de servidor + referência local terem sucesso", () => {
    const fn = fonte.match(/async function usarNoProximoPedido[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(fn).toContain("const gravou = gravarReferenciaRecompensa(localStorage");
    expect(fn).toContain("if (!gravou)");
    // Falha ao gravar desfaz a reserva na hora — nunca nasce um falso
    // "está no carrinho".
    expect(fn).toContain("cancelar-reserva");
    // A referência nunca volta para o sessionStorage one-shot (causa raiz do
    // bug da sacola vazia).
    expect(fn).not.toContain("sessionStorage.setItem('cf_recompensa_jornada'");
  });

  test("não usa confete, roleta ou elementos de cassino", () => {
    expect(fonte.toLowerCase()).not.toContain("confete");
    expect(fonte.toLowerCase()).not.toContain("confetti");
    expect(fonte.toLowerCase()).not.toContain("roleta");
    expect(fonte.toLowerCase()).not.toContain("cassino");
  });
});
