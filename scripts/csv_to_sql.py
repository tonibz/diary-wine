"""
Turn appellations.csv into SQL for loading the reference table.

Two modes, because they answer different questions:

    --upsert   (default) INSERT ... ON CONFLICT (norm_name) DO UPDATE.
               Idempotent: running it twice changes nothing the second time,
               and rows already in the table are refreshed in place. This is
               what the first load used.

    --replace  Everything inside one transaction: load into a temporary
               table, check the row count is sane, then empty the real table
               and copy across. Use this when the build has *removed* rows,
               because an upsert cannot delete anything and would leave the
               old rows behind for ever.

Usage:
    python csv_to_sql.py appellations.csv > appellations.sql
    python csv_to_sql.py appellations.csv --replace > appellations.sql

Then paste the output into the Supabase SQL editor. Take a backup first:

    CREATE TABLE appellations_backup_YYYYMMDD AS SELECT * FROM appellations;
    ALTER TABLE appellations_backup_YYYYMMDD ENABLE ROW LEVEL SECURITY;
"""

import argparse
import csv
import sys

COLUMNS = [
    "norm_name", "name", "country", "region", "typical_colour",
    "grapes", "grape_count", "wikipedia_title", "wikipedia_langs", "source",
]

BATCH = 200          # one INSERT per 200 rows: the editor chokes on one huge one
MIN_ROWS = 1000      # a build smaller than this means something went wrong
MAX_ROWS = 2000


def quote(value: str) -> str:
    """A SQL string literal, or NULL for an empty field."""
    if value is None or value == "":
        return "NULL"
    return "'" + value.replace("'", "''") + "'"


def value_list(row: dict) -> str:
    parts = []
    for col in COLUMNS:
        if col == "grape_count":
            parts.append(str(int(row[col] or 0)))
        elif col == "grapes":
            parts.append(quote(row[col] or "[]") + "::jsonb")
        else:
            parts.append(quote(row[col]))
    return "  (" + ", ".join(parts) + ")"


def batches(rows: list[dict], target: str) -> list[str]:
    out = []
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        out.append(f"INSERT INTO {target} ({','.join(COLUMNS)}) VALUES")
        out.append(",\n".join(value_list(r) for r in chunk) + ";")
    return out


def upsert_sql(rows: list[dict]) -> list[str]:
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in COLUMNS if c != "norm_name")
    out = []
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        out.append(f"INSERT INTO public.appellations ({','.join(COLUMNS)}) VALUES")
        out.append(",\n".join(value_list(r) for r in chunk))
        out.append(f"ON CONFLICT (norm_name) DO UPDATE SET {updates};")
    return out


def replace_sql(rows: list[dict]) -> list[str]:
    out = ["BEGIN;",
           "CREATE TEMP TABLE stage (LIKE public.appellations INCLUDING DEFAULTS)"
           " ON COMMIT DROP;"]
    out += batches(rows, "stage")
    out.append(f"""
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM stage;
  IF n < {MIN_ROWS} OR n > {MAX_ROWS} THEN
    RAISE EXCEPTION 'Unexpected row count in stage: %. Reload aborted.', n;
  END IF;
END $$;

DELETE FROM public.appellations;
INSERT INTO public.appellations ({','.join(COLUMNS)})
SELECT {','.join(COLUMNS)} FROM stage;
COMMIT;

SELECT count(*) AS rows,
       count(*) FILTER (WHERE grape_count > 0) AS with_grapes,
       count(*) FILTER (WHERE country IS NULL) AS no_country,
       count(*) FILTER (WHERE typical_colour IS NULL) AS no_colour
FROM public.appellations;""")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("csv_path", nargs="?", default="appellations.csv")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--upsert", action="store_true", default=True)
    mode.add_argument("--replace", action="store_true")
    args = ap.parse_args()

    with open(args.csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    if not rows:
        sys.exit(f"{args.csv_path} has no rows")
    missing = [c for c in COLUMNS if c not in rows[0]]
    if missing:
        sys.exit(f"{args.csv_path} is missing columns: {', '.join(missing)}")

    seen = {}
    for r in rows:
        if r["norm_name"] in seen:
            sys.exit(f"duplicate norm_name in the CSV: {r['norm_name']!r}. "
                     "Two rows would fight over the same key; fix the build first.")
        seen[r["norm_name"]] = True

    print(f"-- {len(rows)} appellations from {args.csv_path}")
    print(f"-- mode: {'replace' if args.replace else 'upsert'}")
    lines = replace_sql(rows) if args.replace else upsert_sql(rows)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
