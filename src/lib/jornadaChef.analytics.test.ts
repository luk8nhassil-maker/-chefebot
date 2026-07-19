import { vi, describe, test, expect, beforeEach, afterAll } from "vitest";

const store = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      const [key] = keys;
      const [token] = args;
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
  },
}));

vi.mock("@/lib/whatsappMensagem", () => ({
  enviarTextoWhatsApp: vi.fn(async () => ({ ok: true, latenciaMs: 1, tentativas: 1 })),
}));

import {
  processarConclusaoPedidoJornada,
  abrirRecompensa,
  reservarRecompensaParaProximoPedido,
  confirmarReservaNoPedido,
  aplicarResgateManual,
  reverterConclusaoPedidoJornada,
  salvarConfigJornadaChef,
  registrarEventoAnalytics,
  type RecompensaConfigCiclo,
} from "./jornadaChef";

const SEGREDO_ORIGINAL = process.env.AUTH_SECRET;

beforeEach(() => {
  store.clear();
  process.env.AUTH_SECRET = "segredo-de-teste-nao-usado-em-producao";
});

afterAll(() => {
  process.env.AUTH_SECRET = SEGREDO_ORIGINAL;
});

const BEBIDA_GUARANA: RecompensaConfigCiclo = {
  id: "cfg_guarana",
  tipo: "bebida_sobremesa",
  ativo: true,
  produtoNome: "Guarana 2L",
  item: { produtoId: "bebida:Guarana 2L", produtoNome: "Guarana 2L", categoria: "bebida" },
};

const TELEFONE = "86988887777";
const CLIENTE_ID = `cli_${TELEFONE}`;

// IDs de pedido nunca devem embutir o telefone — usa um contador opaco em vez
// de derivar o id do telefone, pra não confundir "vazamento real" com um
// artefato do fixture de teste.
let contadorPedidoTeste = 0;
function proximoPedidoIdTeste(): string {
  contadorPedidoTeste += 1;
  return `ped_teste_${contadorPedidoTeste}`;
}

async function clienteComCaixaDesbloqueada(telefone: string) {
  await salvarConfigJornadaChef({ modoRollout: "on", sequenciaRecompensas: [BEBIDA_GUARANA] });
  let ultimoResultado;
  for (const qty of [4, 4, 4]) {
    ultimoResultado = await processarConclusaoPedidoJornada({
      id: proximoPedidoIdTeste(),
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty }],
    });
  }
  const clienteId = `cli_${telefone}`;
  const recompensaId = ultimoResultado!.recompensasDesbloqueadas[0].recompensaId;
  return { clienteId, recompensaId };
}

function eventosPersistidos(): Record<string, unknown>[] {
  return (store.get("jornada:analytics:default") as Record<string, unknown>[]) ?? [];
}

describe("analytics sanitizado — nunca telefone, clienteId ou identificador reversível", () => {
  test("credito, abertura de caixa, reserva e resgate nunca gravam o telefone nem cli_<telefone>", async () => {
    const { clienteId, recompensaId } = await clienteComCaixaDesbloqueada(TELEFONE);
    await abrirRecompensa(clienteId, recompensaId);
    await reservarRecompensaParaProximoPedido(clienteId, recompensaId);
    await confirmarReservaNoPedido(clienteId, recompensaId, "pedido_analytics_1");
    await processarConclusaoPedidoJornada({
      id: "pedido_analytics_1",
      telefone: TELEFONE,
      status: "entregue",
      recompensaJornadaId: recompensaId,
      itensDetalhados: [],
    });

    const eventos = eventosPersistidos();
    expect(eventos.length).toBeGreaterThan(0);

    const serializado = JSON.stringify(eventos);
    expect(serializado).not.toContain(TELEFONE);
    expect(serializado).not.toContain(CLIENTE_ID);
    expect(serializado).not.toContain(`cli_${TELEFONE}`);

    for (const evento of eventos) {
      expect(evento).not.toHaveProperty("clienteId");
      expect(evento).not.toHaveProperty("telefone");
    }
  });

  test("resgate manual nunca grava telefone, clienteId, nem o operador em texto puro (só o papel)", async () => {
    const { clienteId, recompensaId } = await clienteComCaixaDesbloqueada("86988886666");
    const aberta = await abrirRecompensa(clienteId, recompensaId);
    await aplicarResgateManual(aberta.codigoPublico, "admin");

    const eventos = eventosPersistidos();
    const evento = eventos.find((e) => e.tipo === "resgate_manual");
    expect(evento).toBeTruthy();
    expect(evento).not.toHaveProperty("clienteId");
    expect(evento).not.toHaveProperty("telefone");
    expect(evento).not.toHaveProperty("aplicadoPor");
    expect(evento?.papelOperador).toBe("admin");

    const serializado = JSON.stringify(eventos);
    expect(serializado).not.toContain("86988886666");
    // Codigo publico de resgate completo nunca deve ser persistido em analytics.
    expect(serializado).not.toContain(aberta.codigoPublico);
  });

  test("reversao de credito tambem usa a referencia opaca, nunca o clienteId", async () => {
    await salvarConfigJornadaChef({ modoRollout: "on", sequenciaRecompensas: [BEBIDA_GUARANA] });
    const telefone = "86988885555";
    await processarConclusaoPedidoJornada({
      id: "pedido_reversao_1",
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 2 }],
    });
    await reverterConclusaoPedidoJornada("pedido_reversao_1", "pedido cancelado apos entrega");

    const eventos = eventosPersistidos();
    const evento = eventos.find((e) => e.tipo === "credito_revertido");
    expect(evento).toBeTruthy();
    expect(evento).not.toHaveProperty("clienteId");
    expect(JSON.stringify(evento)).not.toContain(telefone);
  });

  test("cada evento com cliente grava um clienteRef opaco (nunca o clienteId em claro)", async () => {
    const { clienteId, recompensaId } = await clienteComCaixaDesbloqueada("86988884444");
    void recompensaId;
    const eventos = eventosPersistidos();
    const comCliente = eventos.filter((e) => e.clienteRef !== undefined);
    expect(comCliente.length).toBeGreaterThan(0);
    for (const evento of comCliente) {
      expect(typeof evento.clienteRef).toBe("string");
      expect(evento.clienteRef).not.toBe(clienteId);
      expect((evento.clienteRef as string).length).toBeLessThan(64); // nunca o HMAC completo
    }
  });

  test("sem AUTH_SECRET: clienteRef fica ausente, mas o fluxo principal continua funcionando", async () => {
    delete process.env.AUTH_SECRET;
    const { clienteId, recompensaId } = await clienteComCaixaDesbloqueada("86988883333");
    expect(clienteId).toBe("cli_86988883333");
    expect(recompensaId).toBeTruthy();

    const eventos = eventosPersistidos();
    expect(eventos.length).toBeGreaterThan(0);
    for (const evento of eventos) {
      expect(evento).not.toHaveProperty("clienteRef");
      expect(evento).not.toHaveProperty("clienteId");
    }
  });

  test("chamador que tenta enviar campos sensiveis (clienteId, telefone, token, cookie, otp) é sanitizado centralmente", async () => {
    await registrarEventoAnalytics("default", "caixa_aberta", {
      clienteId: "cli_09999999999",
      telefone: "09999999999",
      nome: "Fulano de Tal",
      cookie: "abc123",
      token: "xyz",
      otp: "000000",
      codigoPublico: "JC-SEGREDO",
      recompensaId: "rec_1",
    });
    const eventos = eventosPersistidos();
    const evento = eventos[eventos.length - 1];
    expect(evento.recompensaId).toBe("rec_1");
    for (const chave of ["clienteId", "telefone", "nome", "cookie", "token", "otp", "codigoPublico"]) {
      expect(evento).not.toHaveProperty(chave);
    }
  });
});
