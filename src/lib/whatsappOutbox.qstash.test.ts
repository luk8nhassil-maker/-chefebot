import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), publishJSON: vi.fn() }));

vi.mock("@upstash/qstash", () => ({
  Client: class {
    schedules = { create: mocks.create };
    publishJSON = mocks.publishJSON;
  },
}));
vi.mock("./redis", () => ({ redis: {} }));

import { agendarDrenoWhatsapp } from "./whatsappOutbox";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.QSTASH_TOKEN = "qstash-test";
  process.env.QSTASH_CURRENT_SIGNING_KEY = "current-test";
  process.env.QSTASH_NEXT_SIGNING_KEY = "next-test";
  process.env.VERCEL_URL = "preview.example.test";
  process.env.VERCEL_ENV = "production";
  mocks.create.mockResolvedValue({ scheduleId: "chefebot-whatsapp-outbox-recovery-v1" });
  mocks.publishJSON.mockResolvedValue({ messageId: "test" });
});

describe("agendarDrenoWhatsapp", () => {
  test("cria agenda recorrente idempotente e publica o despertar imediato", async () => {
    await expect(agendarDrenoWhatsapp()).resolves.toBe(true);
    await expect(agendarDrenoWhatsapp()).resolves.toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      destination: "https://preview.example.test/api/interno/whatsapp-outbox/processar",
      cron: "*/5 * * * *",
      scheduleId: "chefebot-whatsapp-outbox-recovery-v1",
    }));
    expect(mocks.publishJSON).toHaveBeenCalledTimes(2);
  });

  test("não cria schedule recorrente em Preview sem URL explícita", async () => {
    process.env.VERCEL_ENV = "preview";
    await expect(agendarDrenoWhatsapp()).resolves.toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.publishJSON).not.toHaveBeenCalled();
  });
});
