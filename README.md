# Wine Diary

**Remember the wines you loved. Order better next time.**

Live at **[diary.wine](https://www.diary.wine)** · Available in English and Spanish

Wine Diary is a mobile web app for people who don't know much about wine. You photograph a bottle, it recognises the label and saves it to a personal diary with your rating and notes. Over time it learns what you like. Then, when a restaurant hands you a wine list with a hundred names on it, you photograph the list and it tells you which ones you'd probably enjoy — and why, naming the wine from your own diary that each suggestion is based on.

Built as a final year project (Trabajo Final de Bàtxelor) for the BSc in Data Science at Universitat Carlemany.

---

## The problem

Two situations most wine drinkers recognise.

You try something good at a restaurant, photograph the bottle so you'll remember it, and that photo disappears into your camera roll forever. Months later you want to buy it again and there's no way to find it.

Or: you're handed a wine list with fifty entries in three languages, the prices are high, and you have no idea what to order.

The app addresses both with the same data. The diary solves the first. The diary is also what makes the second possible.

---

## How it works

**Recognition.** A photo of a label goes to a vision-language model, which returns structured fields: name, producer, appellation, region, country, vintage, type, grapes, alcohol.

**Provenance.** Here's the interesting part. Most European labels print the appellation but *not* the colour or the grape — a Corton-Charlemagne label never says "white" or "Chardonnay". So the model infers those from what it knows about the appellation. Every field is therefore tagged with where it came from: `label` (read off the bottle), `inferred` (recalled by the model), `reference` (looked up in the appellation table), or `user` (typed by a person). These have very different reliability, and separating them is what lets the app tell you which values to double-check.

**Entity resolution.** The wine catalogue is shared and grows from what users scan, so the same wine gets entered many different ways. Matching uses normalised trigram similarity on name and producer, with a visual label comparison for ambiguous cases and a question to the user when that still isn't decisive. Wines named after their appellation get a different weighting — every estate in Montalcino makes a "Brunello di Montalcino", so the producer is what distinguishes them, not the name.

**Appellation reference.** A table of 1,283 wine appellations with their country, region and permitted grape varieties, built from Wikipedia infoboxes in English, French and Italian. Used to check the model's inferences against a citable source rather than taking them on trust.

**Menu scanning.** Photograph a wine list and it extracts every wine with its price, handling section headings for colour, page headings for serving size (a Barolo at €29 by the glass is not a €29 bottle), decimal commas, four currencies, and menus that mix wine with cocktails and beer.

**Recommendation.** Content-based scoring of each menu item against your taste profile — grape overlap, region, country, colour — with an explanation naming the wine from your diary that justifies it.

---

## Findings

From 81 recognitions, 54 wines and 816 priced wines across 22 restaurant lists:

- **Only 44% of grape values were read from the label.** The rest were inferred. The two fields a beginner most needs, colour and grape, are the two least often printed.
- **Self-reported confidence did not predict error.** Wines the model was most confident about were corrected *more* often, not less. Per-field provenance turned out to be a better guide than the model's opinion of itself.
- **The model's inferences agreed with Wikipedia on 100% of grapes and colours checked.** Disagreements clustered in `region` and were almost all differences of granularity — "Burgundy" vs "vignoble de la côte de Nuits" — rather than errors of fact.
- **Wikidata was unusable for this domain.** Grape data on 2 of 15 known appellations, and name lookup resolved "Barolo" to a surname and "Douro" to a person. Wikipedia infoboxes gave 1,283 appellations with 86% grape coverage.

---

## Stack

React · Supabase (PostgreSQL, auth, storage, edge functions) · Anthropic Claude API for vision · `pg_trgm` for similarity matching · Scaffolded with [Lovable](https://lovable.dev)

---

## Where things live

| Path | What it does |
|---|---|
| `src/lib/recognise.functions.ts` | Label recognition: the vision call and its prompt |
| `src/lib/read-menu-prompt.ts` | Menu parsing rules — headings, serving size, currencies, non-wine filtering |
| `src/lib/compare-labels-prompt.ts` | Visual comparison of two labels for ambiguous duplicates |
| `src/lib/wine-match.ts` | Entity resolution: normalisation, trigram scoring, thresholds |
| `src/lib/field-provenance.ts` | Per-field source tracking |
| `src/lib/appellation-check.ts` | Comparing model inferences against the reference table |
| `src/lib/menu-recommend.ts` | Taste profile scoring and explanations |
| `scripts/` | Building the appellation table from Wikipedia |

Every rule in those prompts exists because something specific went wrong. The instruction not to put "Riserva" in the appellation field was added after "Chianti Classico Riserva" failed to match "Chianti Classico". The rule about sake was added after a drinks menu produced a Junmai Ginjo classified as a white wine.

---

## Running it

The app needs a Supabase project and an Anthropic API key. Copy `.env.example` to `.env` and fill in the values. Secrets are read server-side only and never reach the client bundle.

```bash
npm install
npm run dev
```

The appellation table is built separately:

```bash
cd scripts
pip install requests
python build_appellations_wikipedia.py   # writes appellations.csv
python csv_to_sql.py                     # converts to batched INSERT statements
```

---

## Data and privacy

All 14 database tables have row-level security enabled. Users can only read and write their own diary entries, menu scans and recognitions. The wine catalogue and the appellation reference are shared and readable by all. Photos live in a private bucket served through short-lived signed URLs. Location data from photo EXIF is opt-in and off by default.

---

## Licence and attribution

Appellation data derived from Wikipedia, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

---

Antoni Bové i Zulaica · Universitat Carlemany · 2026
