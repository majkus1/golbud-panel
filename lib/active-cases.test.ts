import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dropTrashedCaseRows } from "./active-cases";

describe("dropTrashedCaseRows", () => {
  it("pomija wiersze spraw z kosza, zostawia resztę i wiersze bez sprawy", () => {
    const rows = [{ id: 1, case_id: "a" }, { id: 2, case_id: "kosz" }, { id: 3, case_id: null }, { id: 4 }, { id: 5, case_id: "niewidoczna" }];
    expect(dropTrashedCaseRows(rows, new Set(["kosz"])).map((r) => r.id)).toEqual([1, 3, 4, 5]);
    expect(dropTrashedCaseRows(rows, new Set())).toHaveLength(5);
  });
});

/**
 * Strażnik: każdy odczyt tabeli `cases` i każde złączenie `cases!inner(...)` musi pomijać
 * sprawy z kosza. Wyjątki są wymienione z powodem — nowy odczyt bez filtra wywróci test.
 */
const ROOT = path.resolve(__dirname, "..");
const SCANNED_DIRS = ["app", "components", "lib"];

/** Plik → powód, dla którego odczyt bez filtra jest poprawny. */
const ALLOWED_UNFILTERED: Record<string, string> = {
  "app/activity/page.tsx": "historia zmian celowo pokazuje także sprawy z kosza",
  "app/api/cases/[caseId]/as-built-estimates/[estimateId]/pdf/route.ts": "odtworzenie zapisanego PDF po identyfikatorze",
  "app/api/cases/[caseId]/purge/route.ts": "trwałe usuwanie działa właśnie na sprawach z kosza",
  "app/api/cases/[caseId]/supplier-invoices/[invoiceId]/send/route.ts": "wysyłka konkretnej faktury kosztowej po identyfikatorze",
  "app/equipment/page.tsx": "historia wydań sprzętu pokazuje nazwę sprawy także po przeniesieniu jej do kosza",
  "app/warehouse/page.tsx": "historia ruchów magazynu pokazuje nazwę sprawy także po przeniesieniu jej do kosza"
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function statementAt(source: string, index: number): string {
  // Instrukcja do najbliższego średnika — wystarczy, żeby zobaczyć filtr w tym samym łańcuchu.
  const end = source.indexOf(";", index);
  return source.slice(index, end === -1 ? index + 800 : end);
}

describe("strażnik: sprawy z kosza nie wyciekają do list", () => {
  const files = SCANNED_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

  it("każdy odczyt tabeli cases ma filtr kosza albo uzasadniony wyjątek", () => {
    const problems: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (rel === "lib/active-cases.ts") continue;
      const source = fs.readFileSync(file, "utf8");
      for (const match of Array.from(source.matchAll(/\.from\("cases"\)/g))) {
        const statement = statementAt(source, match.index ?? 0);
        const isWrite = /\.(insert|update|delete|upsert)\(/.test(statement) && !/\.select\(/.test(statement.split(/\.(insert|update|delete|upsert)\(/)[0]);
        const filtered = /deleted_at|onlyActiveCases\(/.test(statement) || /onlyActiveCases\(\s*[\w.]*\s*$/.test(source.slice(Math.max(0, (match.index ?? 0) - 120), match.index));
        if (!isWrite && !filtered && !ALLOWED_UNFILTERED[rel]) {
          const line = source.slice(0, match.index).split("\n").length;
          problems.push(`${rel}:${line}`);
        }
      }
      for (const match of Array.from(source.matchAll(/cases!inner\(/g))) {
        const statement = statementAt(source, match.index ?? 0);
        if (!/deleted_at|onlyActiveCaseJoin\(/.test(statement) && !ALLOWED_UNFILTERED[rel]) {
          const line = source.slice(0, match.index).split("\n").length;
          problems.push(`${rel}:${line} (złączenie)`);
        }
      }
    }
    expect(problems, "Dodaj .is(\"deleted_at\", null) albo onlyActiveCases(...)").toEqual([]);
  });

  it("lista wyjątków nie zawiera plików, których już nie ma", () => {
    for (const rel of Object.keys(ALLOWED_UNFILTERED)) {
      if (rel.endsWith("purge/route.ts")) continue;
      expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
    }
  });
});
