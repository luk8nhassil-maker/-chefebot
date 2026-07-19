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

const SEGREDO_ORIGINAL = process.env.AUTH_SECRET;

beforeEach(() => {
  store.clear();
  enviarTextoWhatsAppMock.mockClear();
  process.env.AUTH_SECRET = "segredo-de-teste-nao-usado-em-producao";
});

afterAll(() => {
  process.env.AUTH_SECRET = SEGREDO_ORIGINAL;
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
  test("off bloqueia todos, mesmo quem tem uma entrada canário", async () => {
    const config = { modoRollout: "off", canaryClientes: [{ ref: "x", idPublico: "x", labelMascarado: "…1001" }] } as ConfigJornadaChef;
    expect(jornadaAtivaParaCliente(config, "cli_86977001001")).toBe(false);
    expect(jornadaAtivaParaCliente(config, "cli_qualquer")).toBe(false);
    expect(jornadaAtivaParaCliente(config, undefined)).toBe(false);
  });

  test("canary aceita somente quem tem a mesma referencia HMAC autorizada", async () => {
    await adicionarClienteCanario(TELEFONE_AUTORIZADO);
    const config = await obterConfigJornadaChef();
    const configCanary = { ...config, modoRollout: "canary" as const };
    expect(jornadaAtivaParaCliente(configCanary, `cli_${TELEFONE_AUTORIZADO}`)).toBe(true);
    expect(jornadaAtivaParaCliente(configCanary, `cli_${TELEFONE_OUTRO}`)).toBe(false);
    expect(jornadaAtivaParaCliente(configCanary, undefined)).toBe(false);
  });

  test("on libera qualquer cliente elegível", () => {
    const config = { modoRollout: "on", canaryClientes: [] } as unknown as ConfigJornadaChef;
    expect(jornadaAtivaParaCliente(config, "cli_86977001001")).toBe(true);
    expect(jornadaAtivaParaCliente(config, "cli_86977002002")).toBe(true);
  });

  test("canary falha fechado (bloqueia) se o segredo do servidor nao estiver disponivel", async () => {
    await adicionarClienteCanario(TELEFONE_AUTORIZADO);
    const config = await obterConfigJornadaChef();
    delete process.env.AUTH_SECRET;
    expect(jornadaAtivaParaCliente({ ...config, modoRollout: "canary" }, `cli_${TELEFONE_AUTORIZADO}`)).toBe(false);
  });
});

describe("gerenciamento da lista canário — modelo opaco (HMAC), sem telefone recuperável", () => {
  test("adicionarClienteCanario nunca devolve clienteId nem telefone — só idPublico e labelMascarado", async () => {
    const resultado = await adicionarClienteCanario(TELEFONE_AUTORIZADO);
    expect(resultado).not.toHaveProperty("clienteId");
    expect(resultado).not.toHaveProperty("telefone");
    expect(Object.keys(resultado).sort()).toEqual(["idPublico", "labelMascarado"]);
    expect(resultado.labelMascarado).toBe(`…${TELEFONE_AUTORIZADO.slice(-4)}`);
    expect(resultado.idPublico).not.toContain(TELEFONE_AUTORIZADO);
  });

  test("a config persistida nao contem o telefone normalizado nem cli_<telefone>", async () => {
    await adicionarClienteCanario(TELEFONE_AUTORIZADO);
    const config = await obterConfigJornadaChef();
    const serializado = JSON.stringify(config);
    expect(serializado).not.toContain(TELEFONE_AUTORIZADO);
    expect(serializado).not.toContain(`cli_${TELEFONE_AUTORIZADO}`);
    // A entrada canário só tem ref (HMAC), idPublico (prefixo do HMAC) e o
    // rótulo mascarado — nada disso permite recuperar o telefone sem o
    // segredo do servidor.
    expect(config.canaryClientes).toHaveLength(1);
    expect(Object.keys(config.canaryClientes[0]).sort()).toEqual(["idPublico", "labelMascarado", "ref"]);
  });

  test("listarClientesCanario nunca devolve a ref HMAC completa nem clienteId — só idPublico e labelMascarado", async () => {
    await adicionarClienteCanario(TELEFONE_AUTORIZADO);
    const config = await obterConfigJornadaChef();
    const listados = listarClientesCanario(config);
    expect(listados).toHaveLength(1);
    expect(Object.keys(listados[0]).sort()).toEqual(["idPublico", "labelMascarado"]);
    expect(listados[0].labelMascarado).toBe(`…${TELEFONE_AUTORIZADO.slice(-4)}`);
    // idPublico é só um prefixo curto do HMAC — nunca o HMAC completo (64 hex).
    expect(listados[0].idPublico.length).toBeLessThan(64);
  });

  test("remover pelo idPublico bloqueia novos créditos para o cliente, mas não apaga progresso já existente", async () => {
    await salvarConfigJornadaChef({ modoRollout: "canary", sequenciaRecompensas: SEQUENCIA_VALIDA });
    const { idPublico } = await adicionarClienteCanario(TELEFONE_AUTORIZADO);

    const antes = await processarConclusaoPedidoJornada(pedidoDe(TELEFONE_AUTORIZADO, "ped_canario_1"));
    expect(antes?.processado).toBe(true);
    const estadoAntes = await obterEstadoJornada(`cli_${TELEFONE_AUTORIZADO}`);
    expect(estadoAntes.pizzasNoCiclo).toBe(4);

    await removerClienteCanario(idPublico);
    const configDepois = await obterConfigJornadaChef();
    expect(configDepois.canaryClientes).toHaveLength(0);

    const depois = await processarConclusaoPedidoJornada(pedidoDe(TELEFONE_AUTORIZADO, "ped_canario_2"));
    expect(depois).toBeNull(); // bloqueado — não processa mais

    const estadoDepois = await obterEstadoJornada(`cli_${TELEFONE_AUTORIZADO}`);
    expect(estadoDepois.pizzasNoCiclo).toBe(4); // progresso anterior intacto, não apagado
  });

  test("adicionar o mesmo telefone duas vezes nao duplica a entrada canário", async () => {
    await adicionarClienteCanario(TELEFONE_AUTORIZADO);
    await adicionarClienteCanario(TELEFONE_AUTORIZADO);
    const config = await obterConfigJornadaChef();
    expect(config.canaryClientes).toHaveLength(1);
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
