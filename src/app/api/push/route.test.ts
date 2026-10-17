import { afterEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { redisSet, redisKeys, sendNotification, setVapidDetails } = vi.hoisted(() => ({
  redisSet: vi.fn(),
  redisKeys: vi.fn(),
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    set = redisSet;
    keys = redisKeys;
  },
}));

vi.mock("web-push", () => ({
  default: { setVapidDetails, sendNotification },
}));

import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

test("Preview bloqueia inscrição e notificações push antes de Redis ou web-push", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");

  const response = await POST(new NextRequest("https://preview.test/api/push", {
    method: "POST",
    body: JSON.stringify({ action: "notify" }),
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "preview_real_operation_blocked" });
  expect(redisSet).not.toHaveBeenCalled();
  expect(redisKeys).not.toHaveBeenCalled();
  expect(sendNotification).not.toHaveBeenCalled();
  expect(setVapidDetails).not.toHaveBeenCalled();
});
