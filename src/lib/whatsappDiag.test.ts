import { beforeEach, describe, expect, test, vi } from "vitest";

// Telemetria de diagnóstico do WhatsApp. Estes marcadores existem para
// separar causas que hoje se confundem numa única evidência:
//
// - `inboundLastSeenAt` só é gravado DEPOIS do filtro de JID individual, então
//   ficar parado não prova que a Evolution parou de entregar evento — pode ser
//   evento chegando e sendo descartado (LID sem `remoteJidAlt`, grupo,
//   broadcast). `webhookLastSeenAt` + `upsertDescartado*` separam os dois.
// - `outboundLastSuccessAt` só cobre o fluxo de conversa do bot, e NÃO a
//   notificação de status de pedido (que chama `enviarTextoWhatsApp` direto).
//   `outboundLastAttempt*` cobre o choke point real de saída.
//
// Regra inegociável destes marcadores: nunca gravam telefone, JID completo,
// messageId ou conteúdo de conversa — só schema, sufixo, status e motivo.

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});
vi.mock("./redis", () => ({ redis: redisMock }));

import {
  lerDiagnosticoWhatsapp,
  marcarTentativaEnvio,
  marcarUpsertDescartado,
  marcarWebhookRecebido,
} from "./whatsappDiag";

const TELEFONE_REAL = "5599888887777";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

function tudoQueFoiGravado(): string {
  return JSON.stringify([...store.entries()]);
}

describe("marcarWebhookRecebido", () => {
  test("registra a chegada do evento e o nome do evento", async () => {
    await marcarWebhookRecebido("messages.upsert");
    const diag = await lerDiagnosticoWhatsapp();
    expect(diag.webhookLastSeenAt).toBeTypeOf("number");
    expect(diag.webhookLastEvent).toBe("messages.upsert");
  });

  test("evento ausente ou inválido não quebra e vira 'desconhecido'", async () => {
    await marcarWebhookRecebido(undefined);
    const diag = await lerDiagnosticoWhatsapp();
    expect(diag.webhookLastEvent).toBe("desconhecido");
  });
});

describe("marcarUpsertDescartado", () => {
  test("LID sem remoteJidAlt registra sufixo e campos, nunca o número", async () => {
    await marcarUpsertDescartado({
      remoteJid: `${TELEFONE_REAL}@lid`,
      id: "wamid.ABC123",
      fromMe: false,
    });

    const diag = await lerDiagnosticoWhatsapp();
    expect(diag.upsertDescartadoLastAt).toBeTypeOf("number");
    expect(diag.upsertDescartadoSufixo).toBe("@lid");
    // Nomes de campo em ordem estável — é isso que revela em qual campo a
    // versão instalada da Evolution colocaria o telefone real.
    expect(diag.upsertDescartadoCampos).toBe("fromMe,id,remoteJid");

    // Nenhum dado pessoal pode ter sido persistido.
    const gravado = tudoQueFoiGravado();
    expect(gravado).not.toContain(TELEFONE_REAL);
    expect(gravado).not.toContain("wamid.ABC123");
  });

  test("grupo é registrado pelo sufixo, sem o identificador do grupo", async () => {
    await marcarUpsertDescartado({ remoteJid: "120363999@g.us", id: "x" });
    const diag = await lerDiagnosticoWhatsapp();
    expect(diag.upsertDescartadoSufixo).toBe("@g.us");
    expect(tudoQueFoiGravado()).not.toContain("120363999");
  });

  test("chave sem JID não quebra", async () => {
    await marcarUpsertDescartado(null);
    const diag = await lerDiagnosticoWhatsapp();
    expect(diag.upsertDescartadoSufixo).toBe("sem_jid");
    expect(diag.upsertDescartadoCampos).toBe("");
  });
});

describe("marcarTentativaEnvio", () => {
  test("registra sucesso", async () => {
    await marcarTentativaEnvio({ ok: true, statusHttp: 201 });
    const diag = await lerDiagnosticoWhatsapp();
    expect(diag.outboundLastAttemptOk).toBe(true);
    expect(diag.outboundLastAttemptStatus).toBe(201);
    expect(diag.outboundLastAttemptMotivo).toBe("ok");
    expect(diag.outboundLastAttemptAt).toBeTypeOf("number");
  });

  test("registra falha com motivo e status — é isso que separa 'nem tentou' de 'a Evolution recusou'", async () => {
    await marcarTentativaEnvio({ ok: false, motivo: "http_400", statusHttp: 400 });
    const diag = await lerDiagnosticoWhatsapp();
    expect(diag.outboundLastAttemptOk).toBe(false);
    expect(diag.outboundLastAttemptMotivo).toBe("http_400");
    expect(diag.outboundLastAttemptStatus).toBe(400);
  });
});

describe("robustez", () => {
  test("falha do Redis nunca propaga — telemetria jamais derruba webhook ou envio", async () => {
    redisMock.set.mockRejectedValueOnce(new Error("redis fora"));
    await expect(marcarWebhookRecebido("messages.upsert")).resolves.toBeUndefined();

    redisMock.set.mockRejectedValueOnce(new Error("redis fora"));
    await expect(marcarUpsertDescartado({ remoteJid: "x@lid" })).resolves.toBeUndefined();

    redisMock.set.mockRejectedValueOnce(new Error("redis fora"));
    await expect(marcarTentativaEnvio({ ok: false })).resolves.toBeUndefined();
  });

  test("diagnóstico vazio devolve tudo nulo, sem lançar", async () => {
    const diag = await lerDiagnosticoWhatsapp();
    expect(diag.webhookLastSeenAt).toBeNull();
    expect(diag.upsertDescartadoSufixo).toBeNull();
    expect(diag.outboundLastAttemptOk).toBeNull();
  });
});
