# Translations

- One JSON file per language in `src/i18n/locales/` (`en.json`, `es.json`). Adding a
  language means adding one file and one line in `locales/index.ts`. Components never change.
- Keys are namespaced by feature: `common.*`, `nav.*`, `wineType.*`, `add.*`, `bulk.*`,
  `menu.*`, `diary.*`, `entry.*`, `wishlist.*`, `taste.*`, `settings.*`, `auth.*`,
  `recommend.*`, `dupe.*`, `provenance.*`.
- Components: `const { t } = useTranslation()` then `t("add.title")`.
- Non-component modules: `import { i18next } from "@/i18n"` then `i18next.t(...)`.
- Runtime sentences are assembled from translated fragments with interpolation and
  i18next plurals (`key_one` / `key_other`), never string concatenation.
- Dates, numbers and money go through `@/lib/format` (`formatDate`, `formatNumber`, `formatMoney`).
- Wine data (producer, wine name, appellation, region, country, grapes) is never translated —
  those values are matching keys. Only `wineType` display labels are translated,
  via `wineTypeLabel()` in `@/lib/wine-type`.
- Tone: warm, plain, short sentences. Spanish uses **tú**, never usted.
