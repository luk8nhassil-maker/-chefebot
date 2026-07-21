import { describe, test, expect } from "vitest";
import {
  CF_RECOMPENSA_JORNADA_KEY,
  lerReferenciaRecompensa,
  gravarReferenciaRecompensa,
  limparReferenciaRecompensa,
  migrarReferenciaLegada,
  reconciliarReservaComReferencia,
  type StorageRecompensaLike,
} from "./recompensaJornadaCarrinho";

function fakeStorage(inicial: Record<string, string> = {}): StorageRecompensaLike & { dump(): Record<string, string> } {
  const dados = new Map(Object.entries(inicial));
  return {
    getItem: (k) => (dados.has(k) ? dados.get(k)! : null),
    setItem: (k, v) => void dados.set(k, v),
    removeItem: (k) => void dados.delete(k),
    dump: () => Object.fromEntries(dados),
  };
}

function storageQueFalha(): StorageRecompensaLike {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error("storage bloqueado");
    },
    removeItem: () => {},
  };
}

describe("referência local do presente reservado (ler/gravar/limpar)", () => {
  test("gravar e ler de volta preserva recompensaId, escolha e rótulos", () => {
    const storage = fakeStorage();
    const ref = { recompensaId: "rec_1", escolha: { sabor: "Calabresa" }, produtoNome: "Pizza P", validaAte: new Date(Date.now() + 86400000).toISOString() };
    expect(gravarReferenciaRecompensa(storage, ref)).toBe(true);
    expect(lerReferenciaRecompensa(storage)).toEqual(ref);
  });

  test("referência expirada é removida e lida como null", () => {
    const storage = fakeStorage();
    gravarReferenciaRecompensa(storage, { recompensaId: "rec_1", validaAte: new Date(Date.now() - 1000).toISOString() });
    expect(lerReferenciaRecompensa(storage)).toBeNull();
    expect(storage.getItem(CF_RECOMPENSA_JORNADA_KEY)).toBeNull();
  });

  test("JSON malformado ou sem recompensaId nunca vira referência", () => {
    const storage = fakeStorage({ [CF_RECOMPENSA_JORNADA_KEY]: "{{{" });
    expect(lerReferenciaRecompensa(storage)).toBeNull();
    const storage2 = fakeStorage({ [CF_RECOMPENSA_JORNADA_KEY]: JSON.stringify({ escolha: { sabor: "X" } }) });
    expect(lerReferenciaRecompensa(storage2)).toBeNull();
    expect(storage2.getItem(CF_RECOMPENSA_JORNADA_KEY)).toBeNull();
  });

  test("gravar em storage bloqueado retorna false (chamador desfaz a reserva)", () => {
    expect(gravarReferenciaRecompensa(storageQueFalha(), { recompensaId: "rec_1" })).toBe(false);
  });

  test("limpar remove a referência", () => {
    const storage = fakeStorage();
    gravarReferenciaRecompensa(storage, { recompensaId: "rec_1" });
    limparReferenciaRecompensa(storage);
    expect(lerReferenciaRecompensa(storage)).toBeNull();
  });
});

describe("migração da chave legada (sessionStorage one-shot → localStorage)", () => {
  test("move a referência legada e limpa a origem", () => {
    const sessao = fakeStorage({ [CF_RECOMPENSA_JORNADA_KEY]: JSON.stringify({ recompensaId: "rec_leg" }) });
    const local = fakeStorage();
    migrarReferenciaLegada(sessao, local);
    expect(sessao.getItem(CF_RECOMPENSA_JORNADA_KEY)).toBeNull();
    expect(lerReferenciaRecompensa(local)?.recompensaId).toBe("rec_leg");
  });

  test("nunca sobrescreve uma referência mais nova já no destino", () => {
    const sessao = fakeStorage({ [CF_RECOMPENSA_JORNADA_KEY]: JSON.stringify({ recompensaId: "rec_velha" }) });
    const local = fakeStorage({ [CF_RECOMPENSA_JORNADA_KEY]: JSON.stringify({ recompensaId: "rec_nova" }) });
    migrarReferenciaLegada(sessao, local);
    expect(lerReferenciaRecompensa(local)?.recompensaId).toBe("rec_nova");
  });
});

describe("reconciliação reserva do servidor ↔ referência local do carrinho", () => {
  const bebida = { recompensaId: "rec_1", tipo: "bebida_sobremesa", produtoNome: "Guaraná 1L", validaAte: new Date(Date.now() + 86400000).toISOString() };

  test("referência presente e correspondente → manter (card pode aparecer)", () => {
    expect(reconciliarReservaComReferencia(bebida, { recompensaId: "rec_1" })).toEqual({ acao: "manter" });
  });

  test("referência perdida + presente sem escolha → reconstruir com os dados do servidor", () => {
    const decisao = reconciliarReservaComReferencia(bebida, null);
    expect(decisao.acao).toBe("reconstruir");
    if (decisao.acao === "reconstruir") {
      expect(decisao.referencia).toEqual({ recompensaId: "rec_1", produtoNome: "Guaraná 1L", validaAte: bebida.validaAte });
    }
  });

  test("referência de OUTRA recompensa não confirma esta (reconstruir/liberar, nunca manter)", () => {
    expect(reconciliarReservaComReferencia(bebida, { recompensaId: "rec_2" }).acao).toBe("reconstruir");
  });

  test("referência perdida + pizza (sabor escolhido se perdeu junto) → liberar a reserva", () => {
    const pizza = { recompensaId: "rec_p", tipo: "pizza", produtoNome: "Pizza P" };
    expect(reconciliarReservaComReferencia(pizza, null)).toEqual({ acao: "liberar" });
  });

  test("reserva já vinculada a um pedido real nunca é tocada", () => {
    expect(reconciliarReservaComReferencia({ ...bebida, reservaPedidoId: "ped_1" }, null)).toEqual({ acao: "manter" });
  });

  test("liberar nunca é decidido para presente sem escolha — reconstrução é sempre possível", () => {
    const composicao = { recompensaId: "rec_c", tipo: "presente_especial", produtoNome: "Combo" };
    expect(reconciliarReservaComReferencia(composicao, null).acao).toBe("reconstruir");
  });
});
