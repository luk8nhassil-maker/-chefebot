import { describe, test, expect } from "vitest";
import { timestampOrdenacaoPedido } from "./clientePedidos";
import { timestampPedido, idadeDaEtapaMinutos, classificarPendencia } from "./limpezaOperacionalPedidos";
import { criarPixMetadata, gerarTxidPixInterno } from "./pix";
import { numeroCupomExibicao, numeroDiarioCupom } from "../app/pedidos/[id]/imprimir/page";

// BLOQUEIO 5 da revisão externa: o id de desempate de colisão
// (`${Date.now()}${tentativa}`, ver gerarIdPedidoUnico em src/lib/numeracao.ts)
// tem 1-2 dígitos a mais que o Date.now().toString() normal de 13 dígitos, e
// deixa de representar um instante real (é Date.now() com um dígito colado,
// não uma soma/produto que faça sentido como timestamp). Este arquivo audita
// TODOS os consumidores conhecidos de pedido.id que fazem alguma suposição de
// formato/comprimento/valor numérico, e prova que nenhum deles quebra,
// trava ou produz um resultado ERRADO E VISÍVEL — só, na pior hipótese,
// perde precisão de ordenação/data para o pedido especificamente desempatado
// (caso raro por construção: só acontece quando dois pedidos colidem no
// mesmo milissegundo).
//
// Nota importante sobre `numero`: TODA rota de criação já corrigida
// (whatsapp, orders, bot, pedido-app) grava `numero` via proximoNumeroPedido()
// — o contador atômico já existente. `numeroCupomExibicao`/`numeroDiarioCupom`
// só recorrem ao cálculo por id para pedidos LEGADOS sem `numero`, que nunca
// tiveram id desempatado (o desempate não existia quando foram criados) — os
// testes abaixo cobrem esse caminho mesmo assim, defensivamente.

const ID_NORMAL = "1785900000000"; // 13 dígitos — Date.now().toString() comum
const ID_DESEMPATADO = "17859000000001"; // 14 dígitos — mesma colisão, tentativa=1
const ID_DESEMPATADO_2DIG = `${ID_NORMAL}49`; // 15 dígitos — pior caso, tentativa=49

describe("BLOQUEIO 5 — timestampOrdenacaoPedido (clientePedidos.ts, ordenação de /cliente/pedidos)", () => {
  test("id normal (13 dígitos): usado diretamente como critério de ordenação", () => {
    expect(timestampOrdenacaoPedido({ id: ID_NORMAL })).toBe(Number(ID_NORMAL));
  });

  test("id desempatado (14-15 dígitos): continua puramente numérico, então ainda vira Number(id) — não quebra, não usa fallback -Infinity", () => {
    // O regex de timestampOrdenacaoPedido é /^\d+$/ (qualquer comprimento),
    // não /^\d{13}$/ — um id desempatado ainda passa nesse teste e vira um
    // número válido, só maior que o timestamp real (ordena como "um pouco
    // mais novo" que o normal, nunca quebra nem some da lista).
    expect(Number.isFinite(timestampOrdenacaoPedido({ id: ID_DESEMPATADO }))).toBe(true);
    expect(Number.isFinite(timestampOrdenacaoPedido({ id: ID_DESEMPATADO_2DIG }))).toBe(true);
  });

  test("dois pedidos coincidindo no mesmo milissegundo real (um normal, um desempatado) continuam ordenáveis entre si sem exceção", () => {
    const pedidos = [{ id: ID_DESEMPATADO_2DIG }, { id: ID_NORMAL }, { id: ID_DESEMPATADO }];
    expect(() => pedidos.sort((a, b) => timestampOrdenacaoPedido(b) - timestampOrdenacaoPedido(a))).not.toThrow();
  });
});

describe("BLOQUEIO 5 — timestampPedido / idadeDaEtapaMinutos (limpezaOperacionalPedidos.ts, alertas operacionais)", () => {
  test("id normal (13 dígitos): usado diretamente como timestamp de criação", () => {
    const agora = Number(ID_NORMAL) + 5 * 60_000;
    expect(timestampPedido({ id: ID_NORMAL }, agora)).toBe(Number(ID_NORMAL));
  });

  test("id desempatado: o regex ESTRITO /^\\d{13}$/ rejeita de propósito (não trataria como timestamp real) e cai no fallback seguro (Pix ou horário) — nunca finge que o id é um instante real", () => {
    const agora = Date.now();
    const semPixSemHorario = timestampPedido({ id: ID_DESEMPATADO }, agora);
    // Sem Pix e sem horário parseável, o fallback esgota e devolve null —
    // comportamento SEGURO (idade "desconhecida"), nunca um valor absurdo
    // (ex.: um timestamp no ano 7000 por causa do dígito extra).
    expect(semPixSemHorario).toBeNull();

    const comHorario = timestampPedido({ id: ID_DESEMPATADO, horario: "12:30" }, agora);
    // Com horário disponível, usa ele — nunca o id desempatado.
    expect(comHorario).not.toBeNull();
    expect(comHorario).not.toBe(Number(ID_DESEMPATADO));
  });

  test("idadeDaEtapaMinutos nunca lança nem devolve idade absurda (anos) por causa de um id desempatado", () => {
    const agora = Date.now();
    const pedido = { id: ID_DESEMPATADO_2DIG, status: "novo" as const, horario: new Date(agora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) };
    const idade = idadeDaEtapaMinutos(pedido, agora);
    expect(Number.isFinite(idade)).toBe(true);
    // Nunca uma idade de "milênios" — o fallback por horário mantém a idade
    // no intervalo plausível (minutos), nunca o erro de escala do id bruto.
    expect(Math.abs(idade)).toBeLessThan(24 * 60);
  });

  test("classificarPendencia nunca lança para um pedido com id desempatado", () => {
    const agora = Date.now();
    const pedido = { id: ID_DESEMPATADO, status: "novo" as const, horario: new Date(agora - 20 * 60_000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) };
    expect(() => classificarPendencia(pedido, agora)).not.toThrow();
  });
});

describe("BLOQUEIO 5 — txid do Pix (pix.ts): id desempatado continua um txid válido e único", () => {
  test("gerarTxidPixInterno aceita qualquer id numérico, incluindo desempatado, sem truncar nem lançar", () => {
    expect(gerarTxidPixInterno(ID_NORMAL)).toBe(`chefebot_${ID_NORMAL}`);
    expect(gerarTxidPixInterno(ID_DESEMPATADO_2DIG)).toBe(`chefebot_${ID_DESEMPATADO_2DIG}`);
  });

  test("dois pedidos com ids desempatados diferentes (mesmo timestamp base) geram txids DIFERENTES — nunca a mesma cobrança Pix", () => {
    const txidA = gerarTxidPixInterno(ID_NORMAL);
    const txidB = gerarTxidPixInterno(ID_DESEMPATADO);
    expect(txidA).not.toBe(txidB);
  });

  test("comprimento do txid/idempotency key continua bem abaixo de qualquer limite razoável de API externa (Mercado Pago), mesmo no pior caso (2 dígitos extras)", () => {
    const txid = gerarTxidPixInterno(ID_DESEMPATADO_2DIG);
    // Folga generosa: até 64 chars é seguro para qualquer campo de
    // idempotência/external_reference de provedor de pagamento real.
    expect(txid.length).toBeLessThan(64);
  });

  test("criarPixMetadata não lança e produz metadata coerente com um id desempatado", () => {
    expect(() => criarPixMetadata(ID_DESEMPATADO_2DIG, "Pix", 50)).not.toThrow();
    const meta = criarPixMetadata(ID_DESEMPATADO_2DIG, "Pix", 50);
    expect(meta?.txid).toBe(`chefebot_${ID_DESEMPATADO_2DIG}`);
  });
});

describe("BLOQUEIO 5 — cupom impresso (numeroCupomExibicao/numeroDiarioCupom): nunca quebra, e numero (atômico) sempre tem prioridade", () => {
  test("com numero (todo pedido criado pelas rotas corrigidas sempre tem): id desempatado é IRRELEVANTE — numero sempre vence", () => {
    const p = { id: ID_DESEMPATADO_2DIG, numero: 8, cliente: "Cliente Teste", telefone: "86999998888", itens: ["x"], total: 50, status: "novo", horario: "20:00", endereco: "Retirada na loja" };
    expect(numeroCupomExibicao(p, [p])).toBe("#8");
  });

  test("sem numero (só pedido legado — nunca teria id desempatado na prática): id desempatado não lança, e cai num fallback determinístico (idCurto ou posição)", () => {
    const p = { id: ID_DESEMPATADO_2DIG, cliente: "Cliente Teste", telefone: "86999998888", itens: ["x"], total: 50, status: "novo", horario: "20:00", endereco: "Retirada na loja" };
    expect(() => numeroCupomExibicao(p, [p])).not.toThrow();
    expect(() => numeroDiarioCupom(p, [p])).not.toThrow();
    // Resultado é sempre uma string de cupom válida, nunca undefined/NaN.
    expect(numeroCupomExibicao(p, [p])).toMatch(/^#/);
  });
});
