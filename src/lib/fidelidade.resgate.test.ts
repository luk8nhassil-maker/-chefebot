import { vi, describe, test, expect, beforeEach } from "vitest";

const store = new Map<string, unknown>();

function realGet(key: string) {
  return store.has(key) ? store.get(key) : null;
}
function realSet(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
  if (opts?.nx && store.has(key)) return null;
  store.set(key, value);
  return "OK";
}
function realDel(key: string) {
  store.delete(key);
  return 1;
}
function realEval(_script: string, keys: string[], args: string[]) {
  if (keys.length === 1) {
    const [key] = keys;
    const [token] = args;
    if (store.get(key) === token) {
      store.delete(key);
      return 1;
    }
    return 0;
  }
  const [lockKey, estadoKey] = keys;
  const [token, estadoJson] = args;
  if (store.get(lockKey) === token) {
    store.set(estadoKey, JSON.parse(estadoJson as unknown as string));
    return 1;
  }
  return 0;
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => realGet(key)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => realSet(key, value, opts)),
    del: vi.fn(async (key: string) => realDel(key)),
    eval: vi.fn(async (script: string, keys: string[], args: string[]) => realEval(script, keys, args)),
  },
}));

import { redis } from "@/lib/redis";
import {
  creditarPontosPedidoEntregue,
  salvarConfigFidelidadePontos,
  salvarConfigFidelidade,
  obterSaldoPontos,
  obterRecompensasPontos,
  obterReservasResgatePontos,
  reservarResgatePontos,
  confirmarResgatePontos,
  cancelarReservaResgatePontos,
  reverterResgateConfirmado,
} from "./fidelidade";

beforeEach(async () => {
  store.clear();
  await salvarConfigFidelidadePontos({
    ativo: true,
    metaPontos: 100,
    valorPizzaFamiliaReferencia: 60,
    descricaoRecompensa: "1 Pizza Família",
  });
});

async function clienteComRecompensaDisponivel(telefone: string, total = 100) {
  await creditarPontosPedidoEntregue({ id: `ped_setup_${telefone}`, status: "entregue", telefone, total });
  const clienteId = `cli_${telefone}`;
  const [recompensa] = await obterRecompensasPontos(clienteId);
  return { clienteId, recompensaId: recompensa.recompensaId };
}

describe("reservarResgatePontos", () => {
  test("reserva uma recompensa disponível, revalidando saldo/meta/config no momento", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999991001");

    const reserva = await reservarResgatePontos(clienteId, recompensaId);
    expect(reserva.status).toBe("reservado");
    expect(reserva.pontosReservados).toBe(100);
    expect(reserva.valorDescontoMaximo).toBe(60);
    expect(reserva.resgateId).toBeTruthy();

    // reserva nao debita pontos por si so
    expect((await obterSaldoPontos(clienteId)).disponivel).toBe(100);
  });

  test("chamar de novo enquanto a reserva ainda está ativa devolve a MESMA reserva (nunca duplica)", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999991002");
    const primeira = await reservarResgatePontos(clienteId, recompensaId);
    const segunda = await reservarResgatePontos(clienteId, recompensaId);
    expect(segunda.resgateId).toBe(primeira.resgateId);

    const reservas = await obterReservasResgatePontos(clienteId);
    expect(reservas).toHaveLength(1);
  });

  test("recompensa inexistente lança erro", async () => {
    const { clienteId } = await clienteComRecompensaDisponivel("86999991003");
    await expect(reservarResgatePontos(clienteId, "rcp_inexistente")).rejects.toThrow(/nao encontrada/i);
  });

  test("recompensa já resgatada não pode ser reservada de novo", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999991004");
    const reserva = await reservarResgatePontos(clienteId, recompensaId);
    await confirmarResgatePontos(clienteId, reserva.resgateId, "ped_confirmado_1");

    await expect(reservarResgatePontos(clienteId, recompensaId)).rejects.toThrow(/nao esta mais disponivel/i);
  });

  test("saldo caiu abaixo da meta entre o desbloqueio e a tentativa de reserva: revalidação bloqueia", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999991005");
    // um estorno derruba o saldo abaixo da meta ANTES do cliente tentar resgatar —
    // aplicarQuedaAbaixoDaMeta (Fase A) já marca a recompensa como "expirada"
    // automaticamente nesse momento, então a reserva é bloqueada logo na
    // checagem de status (defesa em profundidade: mesmo que isso não
    // acontecesse, a checagem de saldo/meta abaixo bloquearia igual).
    const { registrarMovimentoPontosIdempotente } = await import("./fidelidade");
    await registrarMovimentoPontosIdempotente(clienteId, {
      eventoId: "estornado:revalidacao",
      pedidoId: "ped_setup_86999991005",
      tipo: "estornado",
      pontos: 50,
      motivo: "correção",
    });

    await expect(reservarResgatePontos(clienteId, recompensaId)).rejects.toThrow(/nao esta mais disponivel/i);
  });

  test("defesa em profundidade: mesmo com status 'disponivel' salvo, saldo real abaixo da meta bloqueia a reserva", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999991015");
    // Simula diretamente no store um estado inconsistente (status "disponivel"
    // preservado, mas saldo real abaixo da meta) — cenário que não deveria
    // acontecer via fluxo normal, mas a revalidação de saldo/meta na reserva
    // protege mesmo assim, nunca confiando só no status salvo.
    const chaveEstado = `fidelidade:pontos:estado:${clienteId}`;
    const estado = store.get(chaveEstado) as { extrato: Array<Record<string, unknown>> };
    estado.extrato.push({
      movimentoId: "m-forcado",
      clienteId,
      pedidoId: "ped_forcado",
      tipo: "estornado",
      pontos: 50,
      motivo: "simulacao de inconsistencia",
      createdAt: new Date().toISOString(),
      eventoId: "estornado:forcado",
    });
    store.set(chaveEstado, estado);

    await expect(reservarResgatePontos(clienteId, recompensaId)).rejects.toThrow(/saldo atual nao atende/i);
  });

  test("fidelidade desativada bloqueia a reserva mesmo com recompensa aberta", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999991006");
    await salvarConfigFidelidadePontos({ ativo: false, metaPontos: 100, valorPizzaFamiliaReferencia: 60, descricaoRecompensa: "1 Pizza Família" });
    await expect(reservarResgatePontos(clienteId, recompensaId)).rejects.toThrow(/nao esta ativa/i);
  });
});

describe("confirmarResgatePontos", () => {
  test("confirma a reserva: debita os pontos, marca recompensa 'resgatada', saldo residual preservado", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999992001", 150); // saldo 150, meta 100
    const reserva = await reservarResgatePontos(clienteId, recompensaId);

    const movimento = await confirmarResgatePontos(clienteId, reserva.resgateId, "ped_confirma_1");
    expect(movimento?.tipo).toBe("resgatado");
    expect(movimento?.pontos).toBe(100);

    // saldo residual: 150 - 100 = 50, continua guardado (nao zera)
    expect((await obterSaldoPontos(clienteId)).disponivel).toBe(50);

    const [recompensa] = await obterRecompensasPontos(clienteId);
    expect(recompensa.status).toBe("resgatada");

    const [reservaFinal] = await obterReservasResgatePontos(clienteId);
    expect(reservaFinal.status).toBe("confirmado");
    expect(reservaFinal.pedidoId).toBe("ped_confirma_1");
  });

  test("reprocessar a confirmação do mesmo pedido/reserva é idempotente — não duplica o débito", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999992002", 150);
    const reserva = await reservarResgatePontos(clienteId, recompensaId);

    await confirmarResgatePontos(clienteId, reserva.resgateId, "ped_confirma_2");
    await confirmarResgatePontos(clienteId, reserva.resgateId, "ped_confirma_2");
    await confirmarResgatePontos(clienteId, reserva.resgateId, "ped_confirma_2");

    expect((await obterSaldoPontos(clienteId)).disponivel).toBe(50);
  });

  test("reserva expirada não pode ser confirmada", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999992003");
    const reserva = await reservarResgatePontos(clienteId, recompensaId);

    // simula expiração manipulando o estado diretamente no store (mesma chave que a lib usa)
    const chaveEstado = `fidelidade:pontos:estado:${clienteId}`;
    const estado = store.get(chaveEstado) as { reservas: Array<Record<string, unknown>> };
    estado.reservas = estado.reservas.map((r) => (r.resgateId === reserva.resgateId ? { ...r, expiraEm: new Date(Date.now() - 1000).toISOString() } : r));
    store.set(chaveEstado, estado);

    await expect(confirmarResgatePontos(clienteId, reserva.resgateId, "ped_confirma_3")).rejects.toThrow(/expirada/i);
  });

  test("reserva inexistente lança erro", async () => {
    const { clienteId } = await clienteComRecompensaDisponivel("86999992004");
    await expect(confirmarResgatePontos(clienteId, "rsg_inexistente", "ped_x")).rejects.toThrow(/nao encontrada/i);
  });

  test("dois resgates simultâneos da mesma reserva nunca consomem o saldo duas vezes (concorrência)", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999992005", 150);
    const reserva = await reservarResgatePontos(clienteId, recompensaId);

    const resultados = await Promise.all([
      confirmarResgatePontos(clienteId, reserva.resgateId, "ped_conc_1"),
      confirmarResgatePontos(clienteId, reserva.resgateId, "ped_conc_1"),
    ]);
    // ambos usam o MESMO pedidoId (mesma tentativa de checkout, ex.: duplo clique) — idempotente por eventoId
    const comMovimento = resultados.filter((r) => r !== null);
    expect(comMovimento.length).toBeGreaterThanOrEqual(1);
    expect((await obterSaldoPontos(clienteId)).disponivel).toBe(50); // debitado uma unica vez
  });
});

describe("cancelarReservaResgatePontos", () => {
  test("cancela uma reserva ainda não confirmada — recompensa continua disponível", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999993001");
    const reserva = await reservarResgatePontos(clienteId, recompensaId);

    expect(await cancelarReservaResgatePontos(clienteId, reserva.resgateId)).toBe(true);

    const [reservaFinal] = await obterReservasResgatePontos(clienteId);
    expect(reservaFinal.status).toBe("cancelado");

    const [recompensa] = await obterRecompensasPontos(clienteId);
    expect(recompensa.status).toBe("disponivel"); // nunca foi debitada, continua aberta

    // uma nova reserva pode ser criada normalmente depois
    const novaReserva = await reservarResgatePontos(clienteId, recompensaId);
    expect(novaReserva.resgateId).not.toBe(reserva.resgateId);
  });

  test("cancelar reserva já confirmada não tem efeito (idempotente, retorna false)", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999993002", 150);
    const reserva = await reservarResgatePontos(clienteId, recompensaId);
    await confirmarResgatePontos(clienteId, reserva.resgateId, "ped_x2");

    expect(await cancelarReservaResgatePontos(clienteId, reserva.resgateId)).toBe(false);
    expect((await obterSaldoPontos(clienteId)).disponivel).toBe(50); // saldo intacto
  });

  test("cancelar reserva inexistente nunca lança erro, só retorna false", async () => {
    expect(await cancelarReservaResgatePontos("cli_qualquer", "rsg_nao_existe")).toBe(false);
  });
});

describe("reverterResgateConfirmado — restauração idempotente no cancelamento do pedido", () => {
  test("devolve os pontos gastos e reabre a recompensa quando o pedido é cancelado depois de confirmado", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999994001", 150);
    const reserva = await reservarResgatePontos(clienteId, recompensaId);
    await confirmarResgatePontos(clienteId, reserva.resgateId, "ped_cancelado_1");
    expect((await obterSaldoPontos(clienteId)).disponivel).toBe(50);

    const reversao = await reverterResgateConfirmado(clienteId, reserva.resgateId, "Pedido cancelado apos resgate");
    expect(reversao?.tipo).toBe("ajuste");
    expect(reversao?.pontos).toBe(100);

    expect((await obterSaldoPontos(clienteId)).disponivel).toBe(150); // pontos devolvidos

    const [recompensa] = await obterRecompensasPontos(clienteId);
    expect(recompensa.status).toBe("disponivel"); // reaberta para novo resgate

    const [reservaFinal] = await obterReservasResgatePontos(clienteId);
    expect(reservaFinal.status).toBe("cancelado");
  });

  test("reverter duas vezes não devolve pontos duas vezes (idempotente)", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999994002", 150);
    const reserva = await reservarResgatePontos(clienteId, recompensaId);
    await confirmarResgatePontos(clienteId, reserva.resgateId, "ped_cancelado_2");

    await reverterResgateConfirmado(clienteId, reserva.resgateId, "cancelado");
    await reverterResgateConfirmado(clienteId, reserva.resgateId, "tentativa duplicada");

    expect((await obterSaldoPontos(clienteId)).disponivel).toBe(150);
  });

  test("reverter uma reserva que nunca foi confirmada não tem efeito", async () => {
    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999994003");
    const reserva = await reservarResgatePontos(clienteId, recompensaId);

    const resultado = await reverterResgateConfirmado(clienteId, reserva.resgateId, "nao deveria fazer nada");
    expect(resultado).toBeNull();
    expect((await obterSaldoPontos(clienteId)).disponivel).toBe(100);
  });

  test("compatibilidade com pedidos antigos: reverter resgate nao mexe no modelo antigo de pizzas", async () => {
    const { contarPizzas, creditarFidelidadePedido, obterProgressoFidelidade, salvarConfigFidelidade } = await import("./fidelidade");
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });
    await creditarFidelidadePedido({ pedidoId: "ped_legado_x", clienteId: "cli_legado_x", pizzas: 5 });

    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999994004", 150);
    const reserva = await reservarResgatePontos(clienteId, recompensaId);
    await confirmarResgatePontos(clienteId, reserva.resgateId, "ped_cancelado_4");
    await reverterResgateConfirmado(clienteId, reserva.resgateId, "cancelado");

    const progressoAntigo = await obterProgressoFidelidade("cli_legado_x");
    expect(progressoAntigo.progresso).toBe(5); // intacto, nao afetado pelo resgate do modelo novo
    expect(contarPizzas([{ kind: "pizza", qty: 1 }])).toBe(1);
  });
});

// Nivel 5.9.1: reservarResgatePontos/confirmarResgatePontos precisam usar a
// mesma config efetiva do credito e da tela "Meus pontos" — senao o cliente
// veria a recompensa disponivel mas o resgate falharia com "Fidelidade nao
// esta ativa" por causa de uma fonte de configuracao diferente.
describe("reservarResgatePontos/confirmarResgatePontos — ponte com o modelo legado (config:fidelidade:pontos ausente)", () => {
  beforeEach(async () => {
    await redis.del("config:fidelidade:pontos");
  });

  test("chave nova ausente + legado ativo: resgate fica disponivel conforme saldo/meta (usa o padrao de meta=720 do modelo por pontos)", async () => {
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });

    await creditarPontosPedidoEntregue({ id: "ped_resgate_legado", status: "entregue", telefone: "86999995001", total: 720 });
    const clienteId = "cli_86999995001";
    const [recompensa] = await obterRecompensasPontos(clienteId);
    expect(recompensa).toBeDefined();

    const reserva = await reservarResgatePontos(clienteId, recompensa.recompensaId);
    expect(reserva.status).toBe("reservado");
    expect(reserva.pontosReservados).toBe(720);
  });

  test("chave nova ausente + legado inativo: nenhum credito e nenhuma recompensa para resgatar", async () => {
    await salvarConfigFidelidade({ ativo: false, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });

    await creditarPontosPedidoEntregue({ id: "ped_resgate_legado_inativo", status: "entregue", telefone: "86999995002", total: 720 });

    expect(await obterRecompensasPontos("cli_86999995002")).toHaveLength(0);
  });

  test("chave nova presente e inativa + legado ativo: reserva de resgate falha (nao herda o legado)", async () => {
    // Credita e gera a recompensa ainda com a chave nova ausente / legado ativo.
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });
    await creditarPontosPedidoEntregue({ id: "ped_resgate_nova_inativa", status: "entregue", telefone: "86999995003", total: 720 });
    const clienteId = "cli_86999995003";
    const [recompensa] = await obterRecompensasPontos(clienteId);
    expect(recompensa).toBeDefined();

    // Agora a config nova passa a existir, explicitamente inativa: o resgate
    // (revalidado no momento da reserva) deve recusar, mesmo com o legado ativo.
    await salvarConfigFidelidadePontos({ ativo: false, metaPontos: 720, descricaoRecompensa: "1 Pizza Família" });

    await expect(reservarResgatePontos(clienteId, recompensa.recompensaId)).rejects.toThrow("Fidelidade nao esta ativa");
  });

  test("chave nova presente e ativa: comportamento normal de resgate (config nova manda)", async () => {
    await salvarConfigFidelidade({ ativo: false, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });
    await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 100, descricaoRecompensa: "1 Pizza Família" });

    const { clienteId, recompensaId } = await clienteComRecompensaDisponivel("86999995004", 100);
    const reserva = await reservarResgatePontos(clienteId, recompensaId);
    expect(reserva.status).toBe("reservado");
    expect(reserva.pontosReservados).toBe(100);
  });
});
