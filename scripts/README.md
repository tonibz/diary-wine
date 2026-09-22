# scripts

The three scripts described in Annex C of the thesis, which build the
appellation reference table, plus the offline tests for the build.

| File | What it does |
|---|---|
| `discover_wikidata.py` | Asks Wikidata how it models fifteen well-known appellations. Its negative result is why the table is built from Wikipedia instead. |
| `build_appellations_wikipedia.py` | Builds `appellations.csv` from the wine-region infoboxes of the English, French and Italian Wikipedias. |
| `csv_to_sql.py` | Turns `appellations.csv` into SQL for loading into Supabase. |
| `test_build_appellations.py` | Offline tests for the build. No network needed. |

## Running the build

```
pip install requests
python test_build_appellations.py          # must pass before you trust a build
python build_appellations_wikipedia.py     # writes appellations.csv
python csv_to_sql.py appellations.csv --replace > appellations.sql
```

Then paste `appellations.sql` into the Supabase SQL editor. Take a backup
first:

```sql
CREATE TABLE appellations_backup_YYYYMMDD AS SELECT * FROM appellations;
ALTER TABLE appellations_backup_YYYYMMDD ENABLE ROW LEVEL SECURITY;
```

Use `--replace` rather than the default `--upsert` whenever a build has
*removed* rows. An upsert cannot delete anything, so rows dropped by the
build would otherwise stay in the table for ever.

## Provenance of these files

`build_appellations_wikipedia.py` is the original script from the project,
with the corrections of 22 September 2026 described below.

`discover_wikidata.py` and `csv_to_sql.py` are **reconstructions**. The
originals were written during the project and cited in Annex C, but the
files were lost before the repository was assembled. They were rewritten
from the behaviour documented in Annex C and, for `discover_wikidata.py`,
from its recorded output. They do what the originals did and produce the
same kind of output, but they are not the same bytes. This note is here so
that nobody mistakes one for the other.

`csv_to_sql.py` also gained the `--replace` mode, which the original did
not have.

## Corrections of 22 September 2026

An audit of the loaded table found contamination that traced back to four
defects in the build. Each is covered by a test in
`test_build_appellations.py`.

1. **Markup was deleted instead of replaced.** `clean_wiki` stripped HTML
   tags to nothing, so a `<br>` between two grapes glued them into one:
   `chasselas<br>gamay<br>pinot noir` became a single variety called
   "Chasselasgamaypinot Noir". The same deletion glued the INAO colour code
   to the French *et*, turning `chardonnay <small>B</small>et pinot noir`
   into "Chardonnay Bet Pinot Noir" and losing the colour with it. Tags now
   become a space and `<br>` becomes a newline.

2. **List items carried prose and headings.** Infobox grape fields contain
   sub-headings ("Cépages rouges :", "Red:"), qualifiers ("mostly", "plus
   rarement"), purpose clauses ("merlot N pour les rouges") and production
   figures. These arrived as grape names. They are now stripped or dropped.

3. **Shared EU labels were mapped to one country.** When an article has no
   country field, the country was inferred from the appellation type, and
   DOC was mapped to Italy. DOC is also Portugal's Denominação de Origem
   Controlada, so every Portuguese appellation on French Wikipedia, Douro,
   Porto, Madeira and Vinho Verde, was filed under Italy. DOP, IGP and AOP
   had the same problem. Ambiguous labels now leave the country empty, which
   is the rule the table already applied to colour.

4. **Legal category suffixes split appellations in two.** Title cleaning
   removed AOC, DOC, DOCG and AVA but not DOCa, DOP, DOQ or "(DO)", so
   "Rioja" and "Rioja DOCa" stayed separate rows and never merged. That
   mattered: the plain row listed only Tempranillo and Garnacha and was
   filed as red, while the DOCa row also listed Viura, which is white.
   Merged, Rioja correctly has no single colour. Six Spanish appellations
   were affected.

Defect 4 is worth noting for what it says about the measurement: the table
was contradicting the model on Rioja's colour, and the table was wrong.
Contrasting against an external reference measures the reference as much as
it measures the model.
