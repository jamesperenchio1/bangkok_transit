/**
 * Refreshes data/fares.json from published fare tables. Run monthly by
 * .github/workflows/update-fares.yml:
 *
 *   node --experimental-strip-types scripts/scrape-fares.ts [--dry-run]
 *
 * Only operators with a verified source are listed in SOURCES; every other
 * operator stays as it is in the file (null = "fare unavailable" in the app).
 * To add one: write a parser that returns stop fares, add it here, and the
 * guards below apply automatically.
 *
 * Guards - on any failure the file is left untouched and the exit code is
 * non-zero, so the workflow fails (and emails the owner) instead of shipping
 * garbage to production:
 *  - the page must be fetchable and parse to a complete, non-decreasing table;
 *  - a previously priced operator may not lose its table;
 *  - no fare may move by more than MAX_CHANGE from the committed value.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../data/fares.json", import.meta.url);
const MAX_CHANGE = 0.3;
const DRY_RUN = process.argv.includes("--dry-run");

interface Operator {
  name: string;
  lines: string[];
  effective: string;
  source: string;
  stopFares: number[];
}
interface FareFile {
  retrievedAt: string;
  note: string;
  operators: Record<string, Operator | null>;
}

interface Source {
  name: string;
  lines: string[];
  url: string;
  parse(text: string): { stopFares: number[]; effective: string };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const SOURCES: Record<string, Source> = {
  // MRT Blue: Thai PBS Verify reproduces the Royal Gazette table ("1 station: 17 baht ...").
  mrt: {
    name: "MRT Blue",
    lines: ["blue"],
    url: "https://www.thaipbs.or.th/verify/en/content/13302",
    parse(text) {
      const found = new Map<number, number>();
      for (const m of text.matchAll(/(\d{1,2}) stations?(?: or more)?: (\d{2,3}) baht/g)) {
        // Keep the first full run only: the page repeats a shortened version in a caption.
        if (!found.has(Number(m[1]))) found.set(Number(m[1]), Number(m[2]));
      }
      const stopFares: number[] = [];
      for (let n = 1; found.has(n); n++) stopFares.push(found.get(n)!);
      const date = text.match(/effective (?:from )?(?:on )?([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
      const month = date ? MONTHS.indexOf(date[1]) + 1 : 0;
      if (!date || month === 0) throw new Error("effective date not found");
      const effective = `${date[3]}-${String(month).padStart(2, "0")}-${String(Number(date[2])).padStart(2, "0")}`;
      return { stopFares, effective };
    },
  },
};

function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

function validate(key: string, stopFares: number[], previous: Operator | null | undefined): void {
  if (stopFares.length < 5) throw new Error(`${key}: parsed only ${stopFares.length} fares`);
  stopFares.forEach((f, i) => {
    if (!Number.isFinite(f) || f < 10 || f > 100) throw new Error(`${key}: implausible fare ${f}`);
    if (i > 0 && f < stopFares[i - 1]) throw new Error(`${key}: fares decrease at ${i + 1} stations`);
  });
  if (!previous) return;
  for (let i = 0; i < Math.min(stopFares.length, previous.stopFares.length); i++) {
    const was = previous.stopFares[i];
    if (Math.abs(stopFares[i] - was) / was > MAX_CHANGE) {
      throw new Error(`${key}: fare for ${i + 1} stations moved ${was} -> ${stopFares[i]} (over ${MAX_CHANGE * 100}%)`);
    }
  }
}

async function main(): Promise<void> {
  const file = JSON.parse(readFileSync(FILE, "utf8")) as FareFile;
  const next: FareFile = structuredClone(file);
  const failures: string[] = [];

  for (const [key, source] of Object.entries(SOURCES)) {
    try {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(30_000), headers: { "user-agent": "bangkok-transit-fare-check" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { stopFares, effective } = source.parse(plainText(await res.text()));
      validate(key, stopFares, file.operators[key]);
      next.operators[key] = { name: source.name, lines: source.lines, effective, source: source.url, stopFares };
      console.log(`${key}: ${stopFares.length} fares, ${stopFares[0]}-${stopFares.at(-1)} baht, effective ${effective}`);
    } catch (err) {
      failures.push(`${key}: ${(err as Error).message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`Fare scrape failed, data/fares.json left unchanged:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }

  // Only the date of a real change should show in the diff.
  const body = (f: FareFile) => JSON.stringify({ ...f, retrievedAt: "" });
  if (body(next) === body(file)) {
    console.log("No fare changes.");
    return;
  }
  next.retrievedAt = new Date().toISOString().slice(0, 10);
  if (DRY_RUN) return void console.log("Dry run: would update data/fares.json");
  writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n");
  console.log("Updated data/fares.json");
}

main();
