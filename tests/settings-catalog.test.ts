import { describe, expect, it } from "vitest";
import { CHOICES, DEFAULT_SETTINGS, RANGES, type Settings } from "@/lib/settings-store";
import { SECTIONS, SECTION_KEYS, type Row, type SectionId } from "@/components/settings/types";

const catalogs: Record<SectionId, () => Promise<{ rows: Row[] }>> = {
  general: () => import("@/components/settings/catalog/general"),
  map: () => import("@/components/settings/catalog/map"),
  lines: () => import("@/components/settings/catalog/lines"),
  trains: () => import("@/components/settings/catalog/trains"),
  live: () => import("@/components/settings/catalog/live"),
  routing: () => import("@/components/settings/catalog/routing"),
  alerts: () => import("@/components/settings/catalog/alerts"),
  places: () => import("@/components/settings/catalog/places"),
  data: () => import("@/components/settings/catalog/data"),
};

const keyOf = (row: Row): keyof Settings | null => ("key" in row ? row.key : null);

async function allRows(): Promise<{ id: SectionId; row: Row }[]> {
  const out: { id: SectionId; row: Row }[] = [];
  for (const { id } of SECTIONS) for (const row of (await catalogs[id]()).rows) out.push({ id, row });
  return out;
}

describe("the settings catalog", () => {
  it("gives every stored setting exactly one home", () => {
    const owned = Object.values(SECTION_KEYS).flat();
    expect(new Set(owned).size).toBe(owned.length); // none listed twice
    expect([...owned].sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it("has a catalog row for exactly the settings its section owns, and no row twice", async () => {
    const rows = await allRows();
    for (const { id } of SECTIONS) {
      const keys = rows.filter((r) => r.id === id).map((r) => keyOf(r.row)).filter((k): k is keyof Settings => k !== null);
      expect(new Set(keys).size, `${id} lists a setting twice`).toBe(keys.length);
      expect([...keys].sort(), `${id} rows`).toEqual([...SECTION_KEYS[id]].sort());
    }
    const ids = rows.map((r) => (r.row.kind === "action" ? `a-${r.row.id}` : keyOf(r.row)));
    expect(new Set(ids.filter((i) => i && !String(i).startsWith("a-"))).size).toBe(Object.keys(DEFAULT_SETTINGS).length);
  });

  it("offers only values the store accepts, and ranges that match it", async () => {
    for (const { row } of await allRows()) {
      if (row.kind === "choice") {
        const allowed = CHOICES[row.key] ?? [];
        expect(row.options.map((o) => o.value).sort(), String(row.key)).toEqual([...allowed].sort());
      }
      if (row.kind === "range") {
        const range = RANGES[row.key];
        if (range) expect([row.min, row.max], String(row.key)).toEqual([...range]);
      }
    }
  });

  it("is written in both languages", async () => {
    for (const { row } of await allRows()) {
      expect(row.label.en.length).toBeGreaterThan(0);
      expect(row.label.th.length).toBeGreaterThan(0);
      if (row.hint) expect(row.hint.th.length).toBeGreaterThan(0);
      if (row.group) expect(row.group.th.length).toBeGreaterThan(0);
      if (row.kind === "choice") for (const o of row.options) expect(o.label.th.length).toBeGreaterThan(0);
    }
    for (const s of SECTIONS) {
      expect(s.title.th.length).toBeGreaterThan(0);
      expect(s.summary.th.length).toBeGreaterThan(0);
    }
  });

  it("keeps Google out of the default and behind a key", async () => {
    expect(DEFAULT_SETTINGS.mapProvider).toBe("standard");
    const rows = (await catalogs.map()).rows;
    const provider = rows.find((r) => r.kind === "choice" && r.key === "mapProvider");
    expect(provider?.kind === "choice" && provider.options.find((o) => o.value === "google")?.requires).toBe("googleKey");
    // Settings that only make sense on one map are marked, so the other map never shows a dead control.
    expect(rows.find((r) => keyOf(r) === "googleMapType")?.provider).toBe("google");
    expect(rows.find((r) => keyOf(r) === "rotateGestures")?.provider).toBe("standard");
  });

  it("groups rows in runs: a group heading starts a run and later rows without one belong to it", async () => {
    for (const { id } of SECTIONS) {
      const rows = (await catalogs[id]()).rows;
      const seen = new Set<string>();
      for (const row of rows) {
        if (!row.group) continue;
        expect(seen.has(row.group.en), `${id}: "${row.group.en}" appears in two runs`).toBe(false);
        seen.add(row.group.en);
      }
    }
  });
});
