import { describe, expect, test } from "vitest";
import {
  calcularStatusPorPosicao,
  avaliarDesbloqueioMissaoSemanal,
  reservarConsumoMissaoSemanal,
  confirmarConsumoMissaoSemanal,
  reverterConsumoMissaoSemanal,
  calcularBonusMissaoSemanal,
  reservarMissaoIndicacaoTemporada,
  confirmarMissaoIndicacaoTemporada,
  reverterMissaoIndicacaoTemporada,
  calcularImpulsoPodioDisponivel,
  calcularBonusCarryover,
  calcularXpChefDosMovimentos,
  calcularNivelChef,
  calcularUltimoPedidoConfirmadoDosMovimentos,
  calcularCoroaAmeacada,
  ESTADO_MISSAO_SEMANAL_INICIAL,
  ESTADO_MISSAO_INDICACAO_INICIAL,
  type EstadoMissaoSemanal,
} from "./rankingGamificacao";

describe("calcularStatusPorPosicao", () => {
  test("posição 1 é campeão, 2 é prata, 3 é bronze, 4-10 é elite", () => {
    expect(calcularStatusPorPosicao(1)).toBe("campeao");
    expect(calcularStatusPorPosicao(2)).toBe("prata");
    expect(calcularStatusPorPosicao(3)).toBe("bronze");
    expect(calcularStatusPorPosicao(4)).toBe("elite");
    expect(calcularStatusPorPosicao(10)).toBe("elite");
  });

  test("fora do Top 10 ou sem posição não tem status (nunca inventa 'quase')", () => {
    expect(calcularStatusPorPosicao(11)).toBeNull();
    expect(calcularStatusPorPosicao(null)).toBeNull();
    expect(calcularStatusPorPosicao(undefined)).toBeNull();
    expect(calcularStatusPorPosicao(0)).toBeNull();
    expect(calcularStatusPorPosicao(-1)).toBeNull();
  });
});

describe("avaliarDesbloqueioMissaoSemanal", () => {
  const base = {
    estadoAtual: ESTADO_MISSAO_SEMANAL_INICIAL,
    participaCampanha: true,
    posicaoAtual: 8,
    ultimoPedidoElegivelEm: new Date("2026-01-01T00:00:00Z").toISOString(),
    agora: new Date("2026-01-10T00:00:00Z"),
    cooldownDias: 7,
  };

  test("desbloqueia quando fora do pódio e cooldown vencido", () => {
    const resultado = avaliarDesbloqueioMissaoSemanal(base);
    expect(resultado.status).toBe("desbloqueada");
    expect(resultado.desbloqueadaEm).toBe(base.agora.toISOString());
  });

  test("não desbloqueia sem consentimento (fail-closed)", () => {
    const resultado = avaliarDesbloqueioMissaoSemanal({ ...base, participaCampanha: false });
    expect(resultado).toBe(base.estadoAtual);
  });

  test("não desbloqueia dentro do pódio (posição 1-3)", () => {
    expect(avaliarDesbloqueioMissaoSemanal({ ...base, posicaoAtual: 3 })).toBe(base.estadoAtual);
    expect(avaliarDesbloqueioMissaoSemanal({ ...base, posicaoAtual: 1 })).toBe(base.estadoAtual);
  });

  test("posição null (fora do ranking) também é elegível", () => {
    const resultado = avaliarDesbloqueioMissaoSemanal({ ...base, posicaoAtual: null });
    expect(resultado.status).toBe("desbloqueada");
  });

  test("não desbloqueia antes do cooldown vencer", () => {
    const resultado = avaliarDesbloqueioMissaoSemanal({
      ...base,
      agora: new Date("2026-01-05T00:00:00Z"),
    });
    expect(resultado).toBe(base.estadoAtual);
  });

  test("não desbloqueia sem nenhum pedido elegível registrado", () => {
    const resultado = avaliarDesbloqueioMissaoSemanal({ ...base, ultimoPedidoElegivelEm: null });
    expect(resultado).toBe(base.estadoAtual);
  });

  test("missão já desbloqueada nunca é retraída, mesmo se a posição melhorar", () => {
    const jaDesbloqueada: EstadoMissaoSemanal = {
      status: "desbloqueada",
      desbloqueadaEm: "2026-01-05T00:00:00.000Z",
      consumidaEm: null,
      consumidaPedidoId: null,
      processandoPedidoId: null,
    };
    const resultado = avaliarDesbloqueioMissaoSemanal({ ...base, estadoAtual: jaDesbloqueada, posicaoAtual: 1 });
    expect(resultado).toBe(jaDesbloqueada);
  });

  test("missão 'processando' nunca é reavaliada (não pode mexer no meio de uma reserva atômica)", () => {
    const processando: EstadoMissaoSemanal = {
      status: "processando",
      desbloqueadaEm: "2026-01-05T00:00:00.000Z",
      consumidaEm: null,
      consumidaPedidoId: null,
      processandoPedidoId: "pedido-1",
    };
    expect(avaliarDesbloqueioMissaoSemanal({ ...base, estadoAtual: processando })).toBe(processando);
  });

  test("cooldownDias inválido nunca desbloqueia", () => {
    expect(avaliarDesbloqueioMissaoSemanal({ ...base, cooldownDias: 0 })).toBe(base.estadoAtual);
    expect(avaliarDesbloqueioMissaoSemanal({ ...base, cooldownDias: -3 })).toBe(base.estadoAtual);
  });
});

describe("reservarConsumoMissaoSemanal / confirmarConsumoMissaoSemanal / reverterConsumoMissaoSemanal", () => {
  const desbloqueada: EstadoMissaoSemanal = {
    status: "desbloqueada",
    desbloqueadaEm: "2026-01-05T00:00:00.000Z",
    consumidaEm: null,
    consumidaPedidoId: null,
    processandoPedidoId: null,
  };

  test("reserva uma missão desbloqueada para o pedido (desbloqueada -> processando)", () => {
    const reservado = reservarConsumoMissaoSemanal({ estadoAtual: desbloqueada, pedidoId: "pedido-1" });
    expect(reservado).toEqual({
      status: "processando",
      desbloqueadaEm: desbloqueada.desbloqueadaEm,
      consumidaEm: null,
      consumidaPedidoId: null,
      processandoPedidoId: "pedido-1",
    });
  });

  test("confirma a reserva do MESMO pedido (processando -> consumida)", () => {
    const reservado = reservarConsumoMissaoSemanal({ estadoAtual: desbloqueada, pedidoId: "pedido-1" })!;
    const confirmado = confirmarConsumoMissaoSemanal({ estadoAtual: reservado, pedidoId: "pedido-1", agora: new Date("2026-01-10T00:00:00Z") });
    expect(confirmado).toEqual({
      status: "consumida",
      desbloqueadaEm: desbloqueada.desbloqueadaEm,
      consumidaEm: "2026-01-10T00:00:00.000Z",
      consumidaPedidoId: "pedido-1",
      processandoPedidoId: null,
    });
  });

  test("reservar de novo o MESMO pedido já processando é idempotente (retry de falha intermediária)", () => {
    const reservado = reservarConsumoMissaoSemanal({ estadoAtual: desbloqueada, pedidoId: "pedido-1" })!;
    const retry = reservarConsumoMissaoSemanal({ estadoAtual: reservado, pedidoId: "pedido-1" });
    expect(retry).toBe(reservado);
  });

  test("consumo atômico: dois pedidos não podem reservar a mesma missão desbloqueada", () => {
    const reservadoPorA = reservarConsumoMissaoSemanal({ estadoAtual: desbloqueada, pedidoId: "pedido-A" })!;
    expect(reservadoPorA.processandoPedidoId).toBe("pedido-A");
    // pedido-B tenta reservar o MESMO estado (já processando por A) -> null
    const reservadoPorB = reservarConsumoMissaoSemanal({ estadoAtual: reservadoPorA, pedidoId: "pedido-B" });
    expect(reservadoPorB).toBeNull();
  });

  test("não reserva missão inativa (nada a reservar)", () => {
    expect(reservarConsumoMissaoSemanal({ estadoAtual: ESTADO_MISSAO_SEMANAL_INICIAL, pedidoId: "pedido-1" })).toBeNull();
  });

  test("não reserva duas vezes (já consumida)", () => {
    const consumida: EstadoMissaoSemanal = { status: "consumida", desbloqueadaEm: "x", consumidaEm: "y", consumidaPedidoId: "pedido-1", processandoPedidoId: null };
    expect(reservarConsumoMissaoSemanal({ estadoAtual: consumida, pedidoId: "pedido-2" })).toBeNull();
  });

  test("não confirma um pedido diferente do que reservou", () => {
    const reservado = reservarConsumoMissaoSemanal({ estadoAtual: desbloqueada, pedidoId: "pedido-1" })!;
    expect(confirmarConsumoMissaoSemanal({ estadoAtual: reservado, pedidoId: "pedido-outro", agora: new Date() })).toBeNull();
  });

  test("reverte o consumo quando o pedido exato (já consumida) é cancelado", () => {
    const consumida: EstadoMissaoSemanal = {
      status: "consumida",
      desbloqueadaEm: "2026-01-05T00:00:00.000Z",
      consumidaEm: "2026-01-10T00:00:00.000Z",
      consumidaPedidoId: "pedido-1",
      processandoPedidoId: null,
    };
    const resultado = reverterConsumoMissaoSemanal({ estadoAtual: consumida, pedidoId: "pedido-1" });
    expect(resultado).toEqual({
      status: "desbloqueada",
      desbloqueadaEm: "2026-01-05T00:00:00.000Z",
      consumidaEm: null,
      consumidaPedidoId: null,
      processandoPedidoId: null,
    });
  });

  test("reverte também no meio do processamento (falha/cancelamento entre reservar e confirmar)", () => {
    const reservado = reservarConsumoMissaoSemanal({ estadoAtual: desbloqueada, pedidoId: "pedido-1" })!;
    const resultado = reverterConsumoMissaoSemanal({ estadoAtual: reservado, pedidoId: "pedido-1" });
    expect(resultado?.status).toBe("desbloqueada");
  });

  test("nunca reverte um pedido diferente do que consumiu (protege contra reversão cruzada)", () => {
    const consumida: EstadoMissaoSemanal = {
      status: "consumida",
      desbloqueadaEm: "2026-01-05T00:00:00.000Z",
      consumidaEm: "2026-01-10T00:00:00.000Z",
      consumidaPedidoId: "pedido-1",
      processandoPedidoId: null,
    };
    expect(reverterConsumoMissaoSemanal({ estadoAtual: consumida, pedidoId: "pedido-outro" })).toBeNull();
  });

  test("não reverte uma missão que não está consumida nem processando", () => {
    expect(reverterConsumoMissaoSemanal({ estadoAtual: desbloqueada, pedidoId: "pedido-1" })).toBeNull();
  });
});

describe("calcularUltimoPedidoConfirmadoDosMovimentos", () => {
  test("retorna a data do movimento confirmado mais recente", () => {
    const resultado = calcularUltimoPedidoConfirmadoDosMovimentos([
      { tipo: "confirmado", createdAt: "2026-01-01T00:00:00.000Z" },
      { tipo: "confirmado", createdAt: "2026-01-10T00:00:00.000Z" },
      { tipo: "confirmado", createdAt: "2026-01-05T00:00:00.000Z" },
    ]);
    expect(resultado).toBe("2026-01-10T00:00:00.000Z");
  });

  test("ignora movimentos que não são 'confirmado' (estorno, resgate, ajuste)", () => {
    const resultado = calcularUltimoPedidoConfirmadoDosMovimentos([
      { tipo: "confirmado", createdAt: "2026-01-01T00:00:00.000Z" },
      { tipo: "estornado", createdAt: "2026-01-15T00:00:00.000Z" },
      { tipo: "resgatado", createdAt: "2026-01-20T00:00:00.000Z" },
    ]);
    expect(resultado).toBe("2026-01-01T00:00:00.000Z");
  });

  test("sem nenhum movimento confirmado, retorna null — nunca inventa uma data", () => {
    expect(calcularUltimoPedidoConfirmadoDosMovimentos([])).toBeNull();
    expect(calcularUltimoPedidoConfirmadoDosMovimentos([{ tipo: "estornado", createdAt: "2026-01-01T00:00:00.000Z" }])).toBeNull();
  });
});

describe("calcularBonusMissaoSemanal", () => {
  test("2x credita bônus igual ao base", () => {
    expect(calcularBonusMissaoSemanal(50, 2)).toBe(50);
  });

  test("multiplicador maior credita a diferença proporcional", () => {
    expect(calcularBonusMissaoSemanal(50, 3)).toBe(100);
  });

  test("sem estrelas base no pedido, sem bônus", () => {
    expect(calcularBonusMissaoSemanal(0, 2)).toBe(0);
    expect(calcularBonusMissaoSemanal(-5, 2)).toBe(0);
  });

  test("multiplicador <= 1 nunca gera bônus (fail-closed)", () => {
    expect(calcularBonusMissaoSemanal(50, 1)).toBe(0);
    expect(calcularBonusMissaoSemanal(50, 0)).toBe(0);
  });
});

describe("reservarMissaoIndicacaoTemporada / confirmarMissaoIndicacaoTemporada / reverterMissaoIndicacaoTemporada", () => {
  test("reserva e confirma a missão pendente", () => {
    const reservada = reservarMissaoIndicacaoTemporada({ estadoAtual: ESTADO_MISSAO_INDICACAO_INICIAL, pedidoId: "pedido-1" });
    expect(reservada).toEqual({ concluida: false, concluidaEm: null, pedidoId: null, processandoPedidoId: "pedido-1" });

    const confirmada = confirmarMissaoIndicacaoTemporada({ estadoAtual: reservada!, pedidoId: "pedido-1", agora: new Date("2026-01-10T00:00:00Z") });
    expect(confirmada).toEqual({ concluida: true, concluidaEm: "2026-01-10T00:00:00.000Z", pedidoId: "pedido-1", processandoPedidoId: null });
  });

  test("nunca duplica — já concluída não reserva de novo", () => {
    const jaConcluida = { concluida: true, concluidaEm: "x", pedidoId: "pedido-1", processandoPedidoId: null };
    expect(reservarMissaoIndicacaoTemporada({ estadoAtual: jaConcluida, pedidoId: "pedido-2" })).toBeNull();
  });

  test("consumo atômico: duas indicações quase simultâneas não reservam ambas", () => {
    const reservadaPorA = reservarMissaoIndicacaoTemporada({ estadoAtual: ESTADO_MISSAO_INDICACAO_INICIAL, pedidoId: "pedido-A" })!;
    const reservadaPorB = reservarMissaoIndicacaoTemporada({ estadoAtual: reservadaPorA, pedidoId: "pedido-B" });
    expect(reservadaPorB).toBeNull();
  });

  test("reservar de novo o MESMO pedido já reservado é idempotente (retry)", () => {
    const reservada = reservarMissaoIndicacaoTemporada({ estadoAtual: ESTADO_MISSAO_INDICACAO_INICIAL, pedidoId: "pedido-1" })!;
    const retry = reservarMissaoIndicacaoTemporada({ estadoAtual: reservada, pedidoId: "pedido-1" });
    expect(retry).toBe(reservada);
  });

  test("reverte quando o pedido exato que concluiu é cancelado depois", () => {
    const concluida = { concluida: true, concluidaEm: "x", pedidoId: "pedido-1", processandoPedidoId: null };
    expect(reverterMissaoIndicacaoTemporada({ estadoAtual: concluida, pedidoId: "pedido-1" })).toEqual({
      concluida: false, concluidaEm: null, pedidoId: null, processandoPedidoId: null,
    });
  });

  test("nunca reverte um pedido diferente do que concluiu", () => {
    const concluida = { concluida: true, concluidaEm: "x", pedidoId: "pedido-1", processandoPedidoId: null };
    expect(reverterMissaoIndicacaoTemporada({ estadoAtual: concluida, pedidoId: "pedido-outro" })).toBeNull();
  });
});

describe("calcularImpulsoPodioDisponivel", () => {
  test("respeita o cap configurado", () => {
    expect(calcularImpulsoPodioDisponivel({ bonusConfigurado: 30, capMaximoTemporada: 100, jaAplicadoNaTemporada: 0 })).toBe(30);
    expect(calcularImpulsoPodioDisponivel({ bonusConfigurado: 30, capMaximoTemporada: 100, jaAplicadoNaTemporada: 90 })).toBe(10);
  });

  test("cap esgotado retorna 0", () => {
    expect(calcularImpulsoPodioDisponivel({ bonusConfigurado: 30, capMaximoTemporada: 100, jaAplicadoNaTemporada: 100 })).toBe(0);
  });

  test("sem config (bonus ou cap <= 0), fail-closed", () => {
    expect(calcularImpulsoPodioDisponivel({ bonusConfigurado: 0, capMaximoTemporada: 100, jaAplicadoNaTemporada: 0 })).toBe(0);
    expect(calcularImpulsoPodioDisponivel({ bonusConfigurado: 30, capMaximoTemporada: 0, jaAplicadoNaTemporada: 0 })).toBe(0);
  });
});

describe("calcularBonusCarryover", () => {
  const tabela = [
    { posicao: 1, bonus: 100 },
    { posicao: 2, bonus: 60 },
  ];

  test("aplica o bônus configurado para a posição", () => {
    expect(calcularBonusCarryover(1, tabela)).toBe(100);
    expect(calcularBonusCarryover(2, tabela)).toBe(60);
  });

  test("sem posição anterior (não jogou a temporada anterior) → 0", () => {
    expect(calcularBonusCarryover(null, tabela)).toBe(0);
  });

  test("posição sem config (ex.: #3 sem linha na tabela) → 0, nunca inventa (fail-closed)", () => {
    expect(calcularBonusCarryover(3, tabela)).toBe(0);
  });

  test("sem tabela nenhuma configurada → 0", () => {
    expect(calcularBonusCarryover(1, null)).toBe(0);
    expect(calcularBonusCarryover(1, undefined)).toBe(0);
  });

  test("bonus zerado ou negativo na config → 0", () => {
    expect(calcularBonusCarryover(5, [{ posicao: 5, bonus: 0 }])).toBe(0);
    expect(calcularBonusCarryover(5, [{ posicao: 5, bonus: -10 }])).toBe(0);
  });
});

describe("calcularXpChefDosMovimentos", () => {
  test("soma confirmados e ajustes, subtrai estornados", () => {
    const xp = calcularXpChefDosMovimentos([
      { tipo: "confirmado", pontos: 50 },
      { tipo: "ajuste", pontos: 10 },
      { tipo: "estornado", pontos: 20 },
    ]);
    expect(xp).toBe(40);
  });

  test("resgate NÃO reduz XP — resgatar não apaga a conquista", () => {
    const xp = calcularXpChefDosMovimentos([
      { tipo: "confirmado", pontos: 100 },
      { tipo: "resgatado", pontos: 80 },
    ]);
    expect(xp).toBe(100);
  });

  test("nunca fica negativo", () => {
    const xp = calcularXpChefDosMovimentos([{ tipo: "estornado", pontos: 50 }]);
    expect(xp).toBe(0);
  });
});

describe("calcularNivelChef", () => {
  const limiares = [
    { nivel: 1, nome: "Aprendiz", xpMinimo: 0 },
    { nivel: 2, nome: "Cozinheiro", xpMinimo: 100 },
    { nivel: 3, nome: "Chef", xpMinimo: 500 },
  ];

  test("sem limiares configurados, nível fica oculto (fail-closed)", () => {
    expect(calcularNivelChef(1000, [])).toEqual({ nivel: 0, nome: null, xpAtual: 1000, xpProximoNivel: null });
    expect(calcularNivelChef(1000, null)).toEqual({ nivel: 0, nome: null, xpAtual: 1000, xpProximoNivel: null });
  });

  test("calcula o nível correto e o próximo limiar", () => {
    expect(calcularNivelChef(50, limiares)).toEqual({ nivel: 1, nome: "Aprendiz", xpAtual: 50, xpProximoNivel: 100 });
    expect(calcularNivelChef(200, limiares)).toEqual({ nivel: 2, nome: "Cozinheiro", xpAtual: 200, xpProximoNivel: 500 });
  });

  test("no nível máximo, não há próximo", () => {
    expect(calcularNivelChef(9999, limiares)).toEqual({ nivel: 3, nome: "Chef", xpAtual: 9999, xpProximoNivel: null });
  });

  test("abaixo do primeiro limiar (xpMinimo > 0), nível 0 com próximo limiar", () => {
    const semZero = [{ nivel: 1, nome: "Cozinheiro", xpMinimo: 100 }];
    expect(calcularNivelChef(50, semZero)).toEqual({ nivel: 0, nome: null, xpAtual: 50, xpProximoNivel: 100 });
  });
});

describe("calcularCoroaAmeacada", () => {
  test("fail-closed: sem config (0 ou negativo), nunca é ameaçada mesmo com vantagem mínima", () => {
    expect(calcularCoroaAmeacada(1, 0)).toBe(false);
    expect(calcularCoroaAmeacada(0, 0)).toBe(false);
    expect(calcularCoroaAmeacada(1, -5)).toBe(false);
  });

  test("sem vantagem real conhecida (null), nunca é ameaçada mesmo com config", () => {
    expect(calcularCoroaAmeacada(null, 10)).toBe(false);
  });

  test("vantagem dentro do limite configurado: ameaçada", () => {
    expect(calcularCoroaAmeacada(3, 5)).toBe(true);
    expect(calcularCoroaAmeacada(5, 5)).toBe(true);
  });

  test("vantagem acima do limite configurado: não ameaçada", () => {
    expect(calcularCoroaAmeacada(6, 5)).toBe(false);
  });

  test("vantagem zero (empate técnico) com config ativa: ameaçada", () => {
    expect(calcularCoroaAmeacada(0, 5)).toBe(true);
  });
});
