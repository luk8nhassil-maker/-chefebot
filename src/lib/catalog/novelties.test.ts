import { describe, expect, it } from "vitest";
import {
  CATALOG_LAUNCH_AT,
  NEW_CATALOG_ITEM_IDS,
  NOVELTY_DURATION_DAYS,
  isNewCatalogItem,
  isNewCatalogItemId,
  isNoveltyPeriodActive,
  noveltyExpiresAt,
} from "./novelties";

describe("novidades do cardápio oficial 2026", () => {
  it("mantém lançamento e duração explícitos", () => {
    expect(CATALOG_LAUNCH_AT).toBe("2026-08-10T00:00:00-03:00");
    expect(NOVELTY_DURATION_DAYS).toBe(30);
    expect(noveltyExpiresAt().toISOString()).toBe("2026-09-09T03:00:00.000Z");
  });

  it("mostra o selo durante os 30 dias e o remove automaticamente no limite", () => {
    expect(isNoveltyPeriodActive(new Date("2026-08-10T03:00:00.000Z"))).toBe(true);
    expect(isNoveltyPeriodActive(new Date("2026-09-09T02:59:59.999Z"))).toBe(true);
    expect(isNoveltyPeriodActive(new Date("2026-09-09T03:00:00.000Z"))).toBe(false);
  });

  it("marca somente IDs confirmados pela comparação com o catálogo antigo", () => {
    expect(isNewCatalogItem("flavor-calabresa-suprema", new Date("2026-08-20T12:00:00Z"))).toBe(true);
    expect(isNewCatalogItem("flavor-calabresa", new Date("2026-08-20T12:00:00Z"))).toBe(false);
    expect(isNewCatalogItem("bebida-coca-cola-2l", new Date("2026-08-20T12:00:00Z"))).toBe(true);
    expect(NEW_CATALOG_ITEM_IDS.has("bebida-guarana-2l")).toBe(false);
    expect(isNewCatalogItemId("flavor-calabresa-suprema")).toBe(true);
    expect(isNewCatalogItemId("flavor-calabresa")).toBe(false);
  });
});
