import { vi, describe, test, expect, beforeEach } from "vitest";

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
  jornadaAtivaParaCliente,
  adicionarClienteCanario,
  removerClienteCanario,
  listarClientesCanario,
  obterConfigJornadaChef,
  salvarConfigJornadaChef,
  obterEstadoJornada,
  processarConclusaoPedidoJornada,
  type ConfigJornadaChef,
} from "./jornadaChef";
import { enviarTextoWhatsApp } from "@/lib/whatsappMensagem";

const enviarTextoWhatsAppMock = vi.mocked(enviarTextoWhatsApp);

beforeEach(() => {
  store.clear();
  enviarTextoWhatsAppMock.mockClear();
});

const SEQUENCIA_VALIDA = [
  { id: "padrao", tipo: "bebida_sobremesa" as const, ativo: true, produtoNome: "", item: { produtoId: "bebida:Guarana 2L", produtoNome: "Guarana 2L", categoria: "bebida" as const } },
];

const TELEFONE_AUTORIZADO = "86977001001";
const TELEFONE_OUTRO = "86977002002";

function pedidoDe(telefone: string, id: string, qty = 4) {
  return {
    id,
    telefone,
    status: "entregue" as const,
    itensDetalhados: [{ kind: "pizza" as const, name: "Pizza G", detail: "Calabresa", price: 50, qty }],
  };
}

describe("jornadaAtivaParaCliente — função central de rollout", () => {
  test("off bloqueia todos, mesmo quem está na lista canário", () => {
    const config = { modoRollout: "off", canaryClienteIds: ["cli_86977001001"] } as ConfigJornadaChef;
    expect(jornadaAtivaParaCliente(config, "cli_86977001001")).toBe(false);
    expect(jornadaAtivaParaCliente(config, "cli_qualquer")).toBe(false);
    expect(jornadaAtivaParaCliente(config, undefined)).toBe(false);
  });

  test("canary aceita somente o clienteId autorizado", () => {
    const config = { modoRollout: "canary", canaryClienteIds: ["cli_86977001001"] } as ConfigJornadaChef;
    expect(jornadaAtivaParaCliente(config, "cli_86977001001")).toBe(true);
    expect(jornadaAtivaParaCliente(config, "cli_86977002002")).toBe(false);
    expect(jornadaAtivaParaCliente(config, undefined)).toBe(false);
  });

  test("on libera qualquer cliente elegível", () => {
    const config = { modoRollout: "on", canaryClienteIds: [] } as unknown as ConfigJornadaChef;
    expect(jornadaAtivaParaCliente(config, "cli_86977001001")).toBe(true);
    expect(jornadaAtivaParaCliente(config, "cli_86977002002")).toBe(true);
  });
});

describe("gerenciamento da lista canário", () => {
  test("telefone completo nunca é armazenado na config — só o clienteId derivado", async () => {
    const { clienteId, identificadorMascarado } = await adicionarClienteCanario(TELEFONE_AUTORIZADO);
    expect(clienteId).toBe(`cli_${TELEFONE_AUTORIZADO}`);
    expect(identificadorMascarado).not.toContain(TELEFONE_AUTORIZADO);
    expect(identificadorMascarado).toContain(TELEFONE_AUTORIZADO.slice(-4));

    const config = await obterConfigJornadaChef();
    expect(config.canaryClienteIds).toEqual([`cli_${TELEFONE_AUTORIZADO}`]);
    // Nada na config guarda o telefone bruto como campo separado.
    expect(JSON.stringify(config)).not.toContain("telefone");
  });

  test("listarClientesCanario nunca devolve o identificador em texto claro — sempre mascarado", async () => {
    await adicionarClienteCanario(TELEFONE_AUTORIZADO);
    const config = await obterConfigJornadaChef();
    const listados = listarClientesCanario(config);
    expect(listados).toHaveLength(1);
    // O identificador mascarado (o que a tela mostra) nunca expõe o telefone
    // completo — só os últimos 4 dígitos, mesmo padrão de mascaramento já
    // usado no modelo de pontos.
    expect(listados[0].identificadorMascarado).not.toContain(TELEFONE_AUTORIZADO);
    expect(listados[0].identificadorMascarado).toBe(`…${TELEFONE_AUTORIZADO.slice(-4)}`);
  });

  test("remover cliente canário bloqueia novos créditos para ele, mas não apaga progresso já existente", async () => {
    await salvarConfigJornadaChef({ modoRollout: "canary", sequenciaRecompensas: SEQUENCIA_VALIDA });
    const { clienteId } = await adicionarClienteCanario(TELEFONE_AUTORIZADO);

    const antes = await processarConclusaoPedidoJornada(pedidoDe(TELEFONE_AUTORIZADO, "ped_canario_1"));
    expect(antes?.processado).toBe(true);
    const estadoAntes = await obterEstadoJornada(clienteId);
    expect(estadoAntes.pizzasNoCiclo).toBe(4);

    await removerClienteCanario(clienteId);

    const depois = await processarConclusaoPedidoJornada(pedidoDe(TELEFONE_AUTORIZADO, "ped_canario_2"));
    expect(depois).toBeNull(); // bloqueado — não processa mais

    const estadoDepois = await obterEstadoJornada(clienteId);
    expect(estadoDepois.pizzasNoCiclo).toBe(4); // progresso anterior intacto, não apagado
  });
});

describe("processarConclusaoPedidoJornada respeita o rollout", () => {
  test("off: ninguém credita", async () => {
    await salvarConfigJornadaChef({ modoRollout: "off", sequenciaRecompensas: SEQUENCIA_VALIDA });
    const resultado = await processarConclusaoPedidoJornada(pedidoDe(TELEFONE_AUTORIZADO, "ped_off"));
    expect(resultado).toBeNull();
  });

  test("canary: cliente autorizado credita, outro cliente não", async () => {
    await salvarConfigJornadaChef({ modoRollout: "canary", sequenciaRecompensas: SEQUENCIA_VALIDA });
    await adicionarClienteCanario(TELEFONE_AUTORIZADO);

    const resultadoAutorizado = await processarConclusaoPedidoJornada(pedidoDe(TELEFONE_AUTORIZADO, "ped_canary_ok"));
    expect(resultadoAutorizado?.processado).toBe(true);

    const resultadoOutro = await processarConclusaoPedidoJornada(pedidoDe(TELEFONE_OUTRO, "ped_canary_bloqueado"));
    expect(resultadoOutro).toBeNull();
    const estadoOutro = await obterEstadoJornada(`cli_${TELEFONE_OUTRO}`);
    expect(estadoOutro.pizzasNoCiclo).toBe(0); // nunca recebeu credito
  });

  test("on: qualquer cliente elegível credita", async () => {
    await salvarConfigJornadaChef({ modoRollout: "on", sequenciaRecompensas: SEQUENCIA_VALIDA });
    const r1 = await processarConclusaoPedidoJornada(pedidoDe(TELEFONE_AUTORIZADO, "ped_on_1"));
    const r2 = await processarConclusaoPedidoJornada(pedidoDe(TELEFONE_OUTRO, "ped_on_2"));
    expect(r1?.processado).toBe(true);
    expect(r2?.processado).toBe(true);
  });

  test("mudar de canary para on (ou vice-versa) não apaga o progresso acumulado", async () => {
    await salvarConfigJornadaChef({ modoRollout: "canary", sequenciaRecompensas: SEQUENCIA_VALIDA });
    await adicionarClienteCanario(TELEFONE_AUTORIZADO);
    await processarConclusaoPedidoJornada(pedidoDe(TELEFONE_AUTORIZADO, "ped_mudanca_1"));

    await salvarConfigJornadaChef({ modoRollout: "on" });
    const estado = await obterEstadoJornada(`cli_${TELEFONE_AUTORIZADO}`);
    expect(estado.pizzasNoCiclo).toBe(4); // preservado, não zerado pela troca de modo

    const resultado = await processarConclusaoPedidoJornada(pedidoDe(TELEFONE_AUTORIZADO, "ped_mudanca_2"));
    expect(resultado?.progressoDepois.pizzasNoCiclo).toBe(8); // continua de onde estava
  });

  test("WhatsApp respeita o rollout: mensagem so e enviada para cliente elegivel", async () => {
    await salvarConfigJornadaChef({ modoRollout: "canary", sequenciaRecompensas: SEQUENCIA_VALIDA, mensagensWhatsappAtivas: true });
    await adicionarClienteCanario(TELEFONE_AUTORIZADO);

    await processarConclusaoPedidoJornada(pedidoDe(TELEFONE_AUTORIZADO, "ped_wa_ok"));
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(1);

    enviarTextoWhatsAppMock.mockClear();
    await processarConclusaoPedidoJornada(pedidoDe(TELEFONE_OUTRO, "ped_wa_bloqueado"));
    expect(enviarTextoWhatsAppMock).not.toHaveBeenCalled();
  });
});
