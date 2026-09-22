"""
Build a wine appellation reference table from Wikipedia infoboxes.

Why not Wikidata
----------------
Two attempts to use Wikidata failed. Appellations are not modelled under any
consistent class, and more importantly a discovery run over 15 well-known
appellations found grape data (P186) on fewer than 3 of them. Since grapes
and colour were the entire point of the table, Wikidata cannot supply it.

Wikipedia can. Articles on wine appellations use an infobox carrying exactly
the fields needed: grapes produced, country, region, and the wine types made.
Wikipedia text is CC BY-SA, so it is citable and redistributable with
attribution.

Output: appellations.csv, ready to load into Supabase.

Usage:
    pip install requests
    python build_appellations_wikipedia.py
"""

import csv
import json
import re
import time
import unicodedata
from collections import Counter

import requests

USER_AGENT = "WineDiary-TFB/1.0 (student research project; antoni.bove3@gmail.com)"

# English Wikipedia covers American wine regions well and French ones badly:
# 333 AVAs against 46 AOCs on the first run. Each country's own Wikipedia
# covers its own appellations properly, so query several and merge.
# Candidate template names per language; the script checks which exist
# rather than assuming, and reports what it found.
LANGS = {
    "en": ["Template:Infobox wine region"],
    "fr": ["Modèle:Infobox Vignoble", "Modèle:Infobox Vin", "Modèle:Infobox Région viticole"],
    "it": ["Template:Vino", "Template:Infobox vino", "Template:Regione vinicola"],
    "es": ["Plantilla:Ficha de región vinícola", "Plantilla:Ficha de vino"],
}

# Field names differ by language. Checked in order.
GRAPE_FIELDS = [
    "grapes produced", "grape varietals", "varietals", "grapes",
    "cépages", "cepages", "cépage", "cepage",
    "cépages principaux", "cepages principaux",
    "vitigni", "vitigno", "uva", "uve", "uvas", "variedades",
    "principali vitigni", "composizione",
]
COUNTRY_FIELDS = [
    "country", "pays", "paese", "país", "pais", "stato", "nation",
    "pays viticole", "etat", "état",
]
REGION_FIELDS = [
    "part of", "région", "region", "regione", "sub regions", "sub-regions",
    "sous-région", "sous region", "sous-régions", "région viticole",
    "région-mère", "region-mere", "zona", "zone", "provincia",
    "localisation", "vignoble",
]

# The French template carries no country field at all. But it does carry
# typeappellation, which can stand in for a country only when the category
# belongs to one country alone. Used only when no explicit country is present.
#
# The first version also mapped DOC to Italy, DOP to Spain and IGP to France.
# Those categories are shared: DOC is also Portugal's Denominação de Origem
# Controlada, and DOP and IGP are the EU-wide PDO and PGI labels used across
# France, Italy, Spain and Portugal. The result was that every Portuguese
# appellation on French Wikipedia (Douro, Porto, Madère, Vinho Verde) was
# filed under Italy. Ambiguous categories now leave the country empty, which
# is the same rule the table applies to colour: an empty value is correct
# where a guess would be wrong.
#
# AOP is excluded for the same reason: it is simply the French name for the
# EU-wide PDO, so French Wikipedia can use it for an Italian or Spanish wine.
# AOC is kept. Switzerland also uses the term, but the one Swiss article in
# the first build (Vignoble du Valais) carried an explicit country field and
# so never reached this fallback. Worth re-checking if more Swiss rows appear.
APPELLATION_COUNTRY = {
    "aoc": "France", "vdqs": "France",
    "vin de pays": "France",
    "docg": "Italy", "igt": "Italy",
    "doca": "Spain",
    "ava": "United States",
}

# INAO colour codes suffixed to grape names on French Wikipedia:
# "grenache N" is noir, "chardonnay B" is blanc, "pinot gris G" is gris,
# "gewurztraminer Rs" is rosé. More reliable than any lookup list.
INAO_COLOUR = {
    "n": "red", "rg": "red",
    "b": "white", "g": "white",
    "rs": "rose",
}

# Candidate template names. The script checks which of these actually have
# pages using them, rather than assuming, because guessing identifiers is
# what wasted two runs on the Wikidata approach.
CANDIDATE_TEMPLATES = [
    "Template:Infobox wine region",
    "Template:Infobox Wine Region",
    "Template:Infobox wine appellation",
    "Template:Infobox AVA",
]


def normalise(text: str) -> str:
    """Same normalisation the app uses, so lookups match on accented names."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    keep = []
    for ch in text:
        if ch.isalnum() or ch.isspace():
            keep.append(ch)
        elif ch in "-'":
            keep.append(" ")
    return " ".join("".join(keep).split())


def api(params: dict, lang: str = "en") -> dict:
    endpoint = f"https://{lang}.wikipedia.org/w/api.php"
    params = {**params, "format": "json", "formatversion": "2"}
    for attempt in range(3):
        try:
            r = requests.get(endpoint, params=params,
                             headers={"User-Agent": USER_AGENT}, timeout=45)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"    api error: {e} (attempt {attempt + 1}/3)")
            time.sleep(3 * (attempt + 1))
    return {}


def find_template(lang: str, candidates: list[str]) -> str | None:
    """Work out which infobox template is actually in use on this wiki."""
    best, best_count = None, 0
    for tpl in candidates:
        data = api({
            "action": "query", "list": "embeddedin", "eititle": tpl,
            "eilimit": "10", "einamespace": "0",
        }, lang)
        n = len(data.get("query", {}).get("embeddedin", []))
        print(f"    {tpl:42} {n} pages (sampled)")
        if n > best_count:
            best, best_count = tpl, n
    return best


def list_pages(template: str, lang: str, cap: int = 3000) -> list[str]:
    """Every article using the infobox template."""
    titles: list[str] = []
    cont = None
    while len(titles) < cap:
        params = {
            "action": "query", "list": "embeddedin", "eititle": template,
            "eilimit": "500", "einamespace": "0",
        }
        if cont:
            params["eicontinue"] = cont
        data = api(params, lang)
        batch = data.get("query", {}).get("embeddedin", [])
        if not batch:
            break
        titles.extend(p["title"] for p in batch)
        cont = data.get("continue", {}).get("eicontinue")
        print(f"    collected {len(titles)} titles")
        if not cont:
            break
        time.sleep(0.3)
    return titles[:cap]


def fetch_wikitext(titles: list[str], lang: str) -> dict[str, str]:
    """Fetch raw wikitext for up to 50 pages at a time."""
    out: dict[str, str] = {}
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        data = api({
            "action": "query", "prop": "revisions", "rvprop": "content",
            "rvslots": "main", "titles": "|".join(chunk),
        }, lang)
        for page in data.get("query", {}).get("pages", []):
            revs = page.get("revisions") or []
            if revs:
                content = revs[0].get("slots", {}).get("main", {}).get("content", "")
                out[page["title"]] = content
        print(f"    fetched {len(out)}/{len(titles)} articles")
        time.sleep(0.3)
    return out


def clean_country(value: str) -> str:
    """
    Country values pick up image markup, giving things like
    'France20pxCorsica'. Cut at the first digit or the second capitalised
    word run, and map the common language variants to English.
    """
    v = re.sub(r"\d+\s*px.*$", "", value, flags=re.I).strip()
    v = re.sub(r"\d.*$", "", v).strip(" ,-")
    # More than one country, or a note about origin ("Algérie (origine) Maroc
    # (actuellement)"), is not a single country. Left empty rather than
    # guessed, as with colour.
    if re.search(r",|\(|\bet\b|\band\b|\s/\s", v, flags=re.I):
        return ""
    aliases = {
        "france": "France", "espagne": "Spain", "españa": "Spain",
        "spagna": "Spain", "italie": "Italy", "italia": "Italy",
        "allemagne": "Germany", "portugal": "Portugal",
        "états-unis": "United States", "etats-unis": "United States",
        "us": "United States", "usa": "United States",
        "suisse": "Switzerland", "grèce": "Greece", "grece": "Greece",
        "turquie": "Turkey", "égypte": "Egypt", "egypte": "Egypt",
        "liban": "Lebanon", "autriche": "Austria", "hongrie": "Hungary",
        "chypre": "Cyprus", "maroc": "Morocco", "algérie": "Algeria",
    }
    v = aliases.get(v.lower(), v)
    # a leftover conjunction on its own is not a country
    return "" if v.lower() in {"et", "and", "y", "e"} else v


def clean_wiki(value: str) -> str:
    """
    Strip wiki markup down to plain text.

    Markup must be replaced with a separator, never with nothing. The first
    version deleted tags outright, which glued neighbouring words together:
    "chasselas<br>gamay<br>pinot noir" became one grape, "Chasselasgamaypinot
    Noir", and "chardonnay <small>B</small>et pinot noir" became "Chardonnay
    Bet Pinot Noir", losing both the split and the INAO colour code. A <br>
    inside a grape field is a list separator, so it becomes a newline; any
    other tag becomes a space.
    """
    value = re.sub(r"<ref[^>]*>.*?</ref>", " ", value, flags=re.S)
    value = re.sub(r"<ref[^>]*/?>", " ", value)          # unclosed or self-closing
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    # [[target|shown]] -> shown, [[target]] -> target
    value = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", value)
    value = re.sub(r"\[\[([^\]]+)\]\]", r"\1", value)
    value = re.sub(r"\{\{[^}]*\}\}", " ", value)
    # footnote markers such as "United States[a]" and stray brackets
    value = re.sub(r"\[[a-z0-9]{1,3}\]", "", value, flags=re.I)
    value = value.replace("[", "").replace("]", "")
    value = value.replace("'''", "").replace("''", "")
    value = re.sub(r"[ \t]+", " ", value)
    return value.strip(" \n\t*,;")


# Legal category suffixes on article titles. The first version stripped only
# AOC, DOC, DOCG and AVA, so "Rioja" and "Rioja DOCa" stayed two separate
# rows and never merged. That mattered: the plain row listed Tempranillo and
# Garnacha and was therefore filed as red, while the DOCa row also listed
# Viura, which is white. Merged, Rioja correctly has no single colour.
CATEGORY_SUFFIX = re.compile(
    r"\s*[\(\[]?\s*(DOCa|DOCG|DOQ|DOP|DOC|DO|AOP|AOC|VDQS|IGP|IGT|VDP|VT"
    r"|AVA|PDO|PGI)\s*[\)\]]?\s*$",
    flags=re.I,
)


def strip_category(name: str) -> str:
    """Remove trailing legal category labels, however many are stacked."""
    prev = None
    while prev != name:
        prev = name
        name = CATEGORY_SUFFIX.sub("", name).strip()
    return name


def clean_region(value: str) -> str:
    """One line of text: sub-regions separated by commas, bullets removed."""
    value = re.sub(r"[\n\r]+", ", ", value)
    value = re.sub(r"\s*\*\s*", "", value)
    value = re.sub(r"\s*,\s*", ", ", value)
    value = re.sub(r"(,\s*)+", ", ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip(" ,")


def parse_infobox(text: str) -> dict[str, str]:
    """Pull the infobox fields out of an article's wikitext."""
    m = re.search(r"\{\{\s*Infobox[^\n]*\n", text, flags=re.I)
    if not m:
        return {}

    # Walk forward counting braces to find where the infobox ends
    start = m.start()
    depth, end = 0, None
    for i in range(start, len(text)):
        if text[i:i + 2] == "{{":
            depth += 1
        elif text[i:i + 2] == "}}":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end is None:
        return {}

    # Drop the outer {{ so the depth counter starts at zero, otherwise no
    # pipe is ever seen at top level and every field gets skipped.
    body = text[start + 2:end]

    fields: dict[str, str] = {}
    depth = 0
    current = ""
    parts = []
    skip_next = False
    for i, ch in enumerate(body):
        if skip_next:
            skip_next = False
            current += ch
            continue
        pair = body[i:i + 2]
        if pair in ("{{", "[["):
            depth += 1
            current += ch
            skip_next = True
            continue
        if pair in ("}}", "]]"):
            depth = max(0, depth - 1)
            current += ch
            skip_next = True
            continue
        if ch == "|" and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += ch
    parts.append(current)

    for part in parts[1:]:
        if "=" not in part:
            continue
        key, _, value = part.partition("=")
        key = key.strip().lower().replace("_", " ")
        value = clean_wiki(value)
        if value:
            fields[key] = value
    return fields


# Sub-headings some infoboxes place inside the grape field. Without this the
# first grape of each group arrived glued to its heading: "Cepages Rouges
# Bastardo", "Red Montepulciano". They are list separators, not grapes.
HEADING = re.compile(
    r"\b(?:c[ée]pages?\s+(?:rouges?|blancs?|noirs?|gris|ros[ée]s?"
    r"|autoris[ée]s?|principaux|secondaires|accessoires|compl[ée]mentaires)"
    r"|(?:red|white|ros[ée]|black)\s+(?:wines?|grapes?|varieties|varietals)"
    r"|(?:reds?|whites?|ros[ée]s?|rouges?|blancs?|noirs?)(?=\s*:))\s*:?",
    flags=re.I,
)

# Prose that wraps a grape name: "mostly Chardonnay", "with occasionally a
# little Aligoté", "plus rarement Blaufränkisch". Stripped from the front of
# an item, repeatedly, until nothing more comes off.
LEADING_PROSE = re.compile(
    r"^(?:mostly|mainly|primarily|principally|predominantly|also\s+some|also"
    r"|some|occasionally|a\s+little|plus\s+rarement|principalement|surtout"
    r"|notamment|dont|avec|le|les|l|du|de|des)\s+",
    flags=re.I,
)

# French purpose clauses after the grape: "merlot N pour les rouges". These
# also hid the INAO code from strip_inao, which only looks at the last word,
# so the colour was lost as well as the name being wrong.
TRAILING_CLAUSE = re.compile(
    r"\s+(?:pour\s+(?:le|la|les|l)\b|for\s+(?:red|white|ros)).*$",
    flags=re.I,
)

# Tokens that survive splitting but are not grape varieties. Checked against
# the normalised item. Fruit appears because some US state articles cover
# fruit wine alongside grape wine.
NOT_GRAPES = {
    "red", "reds", "white", "whites", "rose", "roses", "rouge", "rouges",
    "blanc", "blancs", "noir", "noirs", "sparkling", "sparkling wine",
    "noble", "italian", "domaine", "wine", "wines", "vins", "vins rouges",
    "vins blancs", "le rouge", "le rose", "pour le rose",
    "bordeaux blend", "bordeaux blends", "rhone blends", "red rhone blends",
    "white rhone blends", "white bordeaux blend", "alsatian varietals",
    "passito wines", "other warm climate table wines",
    "cold hardy north american hybrid grape varieties",
    "vitis vinifera", "euvitis", "blueberry", "strawberry", "mango",
    "key lime", "orange", "apple", "apples", "pear", "pears", "cider",
    "etc", "others", "other", "various", "autres", "altri", "ecc",
    # English lists that trail off: "Chardonnay, Sauvignon Blanc and more"
    "more", "many more", "among others",
    # appeared once, in the French article on Porto. Not a grape; the cause
    # in the source was not identified, so it is filtered by name.
    "dog",
}


def clean_item(item: str) -> str:
    """Reduce one list item to a bare grape name, or '' if it is not one."""
    item = re.sub(r"\(.*?\)", "", item)
    item = TRAILING_CLAUSE.sub("", item)
    item = re.sub(r"\s+", " ", item).strip(" .*-:")
    while True:
        stripped = LEADING_PROSE.sub("", item)
        # "la" is only an article when a known grape follows: it has to stay
        # in real variety names such as La Crescent and La Crosse.
        m = re.match(r"^la\s+(.+)$", stripped, flags=re.I)
        if m and normalise(m.group(1)) in WHITE_GRAPES | RED_GRAPES:
            stripped = m.group(1)
        if stripped == item:
            break
        item = stripped
    # a colour word left in front of a variety: "White Trebbiano"
    item = re.sub(r"^(?:red|white|ros[ée])\s+(?=\S)", "", item, flags=re.I)
    norm = normalise(item)
    if (not norm or len(norm) < 3 or len(item) >= 60
            or re.search(r"\d", item) or norm in NOT_GRAPES):
        return ""
    return item


def split_list(value: str) -> list[str]:
    """Split a comma or 'and' separated list into clean grape names."""
    # an INAO code glued to the French "et" in plain text: "chardonnay Bet"
    value = re.sub(r"(?<=\s)(B|N|G|Rs)et(?=\s)", r"\1 et", value)
    value = HEADING.sub(",", value)
    value = re.sub(r"\b(and|et|e|y|ou|with|avec)\b", ",", value, flags=re.I)
    out = []
    for it in re.split(r"[,;/\n•]+", value):
        it = clean_item(it)
        if it:
            out.append(it)
    return out


WHITE_GRAPES = {
    "chardonnay", "sauvignon blanc", "riesling", "pinot gris", "pinot blanc",
    "chenin blanc", "semillon", "viognier", "gewurztraminer", "albarino",
    "verdejo", "godello", "xarello", "macabeu", "macabeo", "parellada",
    "garnacha blanca", "grenache blanc", "muscat", "moscato", "trebbiano",
    "garganega", "vermentino", "cortese", "arneis", "fiano", "greco",
    "grillo", "catarratto", "verdicchio", "malvasia", "marsanne", "roussanne",
    "aligote", "melon de bourgogne", "silvaner", "gruner veltliner",
    "furmint", "assyrtiko", "torrontes", "loureiro", "alvarinho", "arinto",
    "viura", "airen", "palomino", "pedro ximenez", "treixadura",
    "hondarrabi zuri", "moscatel", "zalema", "merseguera", "picapoll",
    "garnatxa blanca", "colombard", "ugni blanc", "folle blanche", "savagnin",
    "sercial", "verdelho", "bual", "petit manseng", "gros manseng",
    "clairette", "bourboulenc", "piquepoul", "rolle", "ribolla gialla",
    "friulano", "kerner", "muller thurgau", "scheurebe", "welschriesling",
    "chasselas", "jacquere", "altesse", "verdesse", "sylvaner", "auxerrois",
    # American and hybrid whites
    "seyval blanc", "vidal blanc", "traminette", "niagara", "vignoles",
    "cayuga", "chardonel", "muscat canelli", "delaware", "la crescent",
    "edelweiss", "st pepin", "brianna", "valvin muscat",
}

RED_GRAPES = {
    "cabernet sauvignon", "merlot", "pinot noir", "syrah", "shiraz",
    "grenache", "garnacha", "tempranillo", "sangiovese", "nebbiolo",
    "barbera", "dolcetto", "montepulciano", "aglianico", "nero d avola",
    "primitivo", "zinfandel", "malbec", "carmenere", "cabernet franc",
    "petit verdot", "mourvedre", "monastrell", "cinsault", "carignan",
    "carinena", "mazuelo", "graciano", "mencia", "bobal", "touriga nacional",
    "touriga franca", "tinta roriz", "baga", "corvina", "rondinella",
    "lagrein", "teroldego", "gamay", "pinotage", "tannat", "bonarda",
    "negroamaro", "nerello mascalese", "sagrantino", "refosco",
    "blaufrankisch", "zweigelt", "saperavi", "xinomavro", "agiorgitiko",
    "ull de llebre", "sumoll", "trepat", "garnacha tintorera",
    "alicante bouschet", "listan negro", "prieto picudo", "hondarrabi beltza",
    "cannonau", "castelao", "trincadeira", "alfrocheiro", "jaen", "rufete",
    "canaiolo", "colorino", "ciliegiolo", "freisa", "grignolino", "ruche",
    "vespolina", "croatina", "schiava", "marzemino", "mondeuse", "poulsard",
    "trousseau", "counoise", "terret noir", "muscardin", "vaccarese",
    # American and hybrid varieties: a third of the table is US regions
    "petite sirah", "chambourcin", "marechal foch", "norton", "concord",
    "de chaunac", "frontenac", "chancellor", "leon millot", "baco noir",
    "lemberger", "carignane", "pinot meunier", "catawba", "muscadine",
    "cynthiana", "st croix", "marquette", "corot noir", "noiret",
}


# Regional synonyms for the same grape. Wine has an enormous amount of this:
# Mourvedre is Mataro in Australia and Monastrell in Spain, Malbec is Cot in
# Cahors, Sangiovese is Nielluccio in Corsica. Mapping them to one canonical
# name is itself a small entity-resolution problem, the same one the app
# solves for wine names.
GRAPE_ALIASES = {
    "sauvignon": "sauvignon blanc", "chenin": "chenin blanc",
    "gamay noir": "gamay", "grenache noir": "grenache",
    "grenache gris": "grenache blanc", "pinot grigio": "pinot gris",
    "grigio": "pinot gris", "cot": "malbec", "mataro": "mourvedre",
    "nielluccio": "sangiovese", "valdepenas": "tempranillo",
    "petite verdot": "petit verdot", "malvasia bianca": "malvasia",
    "tocai friulano": "friulano", "melon": "melon de bourgogne",
    "muscat of alexandria": "muscat", "orange muscat": "muscat",
    "black muscat": "muscat", "muscat ottonel": "muscat",
    "muscat canelli": "muscat", "shiraz": "syrah",
    # varieties with an unambiguous colour but no entry above
    "muscadelle": "semillon", "mauzac": "chenin blanc",
    "rkatsiteli": "riesling", "villard blanc": "seyval blanc",
    "aurore": "seyval blanc", "la crosse": "seyval blanc",
    "diamond": "niagara", "melody": "cayuga", "symphony": "muscat",
    "fer servadou": "tannat", "negrette": "tannat",
    "sciaccarello": "sangiovese", "dornfelder": "lemberger",
    "tinta cao": "touriga nacional", "souzao": "touriga nacional",
    "ruby cabernet": "carignan", "valdiguie": "gamay",
    "charbono": "dolcetto", "st vincent": "chambourcin",
    "steuben": "concord", "chelois": "chambourcin",
    # misspellings present in the Wikipedia source itself; resolving them is
    # the same synonym step as above, not a correction of the source's facts
    "zinfindel": "zinfandel", "semillion": "semillon",
    "gewurtztraminer": "gewurztraminer", "shraz": "syrah",
    "albarinno": "albarino", "rousanne": "roussanne", "roussane": "roussanne",
    "mouvedre": "mourvedre", "pinot poir": "pinot noir",
    "maccabeu": "macabeu", "petite syrah": "petite sirah",
    "petit sirah": "petite sirah", "garnacha tintureira": "garnacha tintorera",
}


def canonical_grape(name: str) -> str:
    """Resolve a grape synonym to a single canonical name."""
    return GRAPE_ALIASES.get(name, name)


def strip_inao(grape: str) -> tuple[str, str]:
    """
    Split "Grenache N" into ("Grenache", "red"). Returns an empty colour
    when there is no INAO code.
    """
    parts = normalise(grape).split()
    if len(parts) >= 2 and parts[-1] in INAO_COLOUR:
        return canonical_grape(" ".join(parts[:-1])), INAO_COLOUR[parts[-1]]
    return canonical_grape(normalise(grape)), ""


def finalise_grapes(grapes: list[str]) -> list[str]:
    """INAO codes off, synonyms resolved, duplicates dropped, title case."""
    out: list[str] = []
    for g in grapes:
        base, _ = strip_inao(g)
        if base and base not in [normalise(x) for x in out]:
            out.append(base.title())
    return out


def infer_colour(grapes: list[str]) -> str:
    """
    Infer colour from the grape list. Returns 'red', 'white', or '' when
    unclear. Empty is the right answer for appellations permitting both,
    such as Rioja or Penedes: they genuinely have no single colour, and
    guessing would corrupt every wine referencing them.

    The infobox "wine produced" field turned out to hold production volume
    rather than colour, so this is where colour actually comes from.
    """
    has_white = has_red = False
    for g in grapes:
        base, coded = strip_inao(g)
        colour = coded
        if not colour:
            if base in WHITE_GRAPES:
                colour = "white"
            elif base in RED_GRAPES:
                colour = "red"
        if colour == "white":
            has_white = True
        elif colour == "red":
            has_red = True
    if has_white and not has_red:
        return "white"
    if has_red and not has_white:
        return "red"
    return ""


COLOUR_WORDS = {
    "red": "red", "reds": "red",
    "white": "white", "whites": "white",
    "rose": "rose", "rosé": "rose",
    "sparkling": "sparkling",
    "dessert": "dessert", "sweet": "dessert",
    "fortified": "fortified",
}


def parse_colours(value: str) -> list[str]:
    found = []
    for word in re.split(r"[^a-zA-Zé]+", value.lower()):
        if word in COLOUR_WORDS and COLOUR_WORDS[word] not in found:
            found.append(COLOUR_WORDS[word])
    return found


NOT_APPELLATION_TITLE = re.compile(
    r"^(?:viticulture\b|vin\s+(?:dans|en)\b|vins?\s+de\s+paille\b"
    r"|ch[aâ]teau\s|domaine\s|bodegas?\s|tenuta\s|weingut\s)",
    flags=re.I,
)


def main() -> None:
    merged: dict[str, dict] = {}
    field_counter: Counter = Counter()
    per_lang: Counter = Counter()
    skipped_titles: list[str] = []

    for lang, candidates in LANGS.items():
        print(f"\n=== {lang}.wikipedia.org ===")
        template = find_template(lang, candidates)
        if not template:
            print("    no matching template, skipping this wiki")
            continue
        print(f"    using {template}")

        titles = list_pages(template, lang)
        print(f"    {len(titles)} articles")
        if not titles:
            continue

        pages = fetch_wikitext(titles, lang)

        for title, text in pages.items():
            # The same infobox is used on articles that are not appellations:
            # a history of wine in ancient Egypt, country overviews such as
            # "Viticulture en Turquie", and individual wineries (Château
            # Ksara). A wine's appellation will never be any of these, and a
            # winery name risks matching a producer, so they are skipped.
            if NOT_APPELLATION_TITLE.match(title):
                skipped_titles.append(title)
                continue
            fields = parse_infobox(text)
            if not fields:
                continue
            field_counter.update(fields.keys())

            name = re.sub(r"\s*\((wine|wine region|vin|vino)\)\s*$",
                          "", title, flags=re.I).strip()
            name = strip_category(name)
            key = normalise(name)
            if not key:
                continue

            country = ""
            for f in COUNTRY_FIELDS:
                if fields.get(f):
                    country = clean_country(clean_wiki(fields[f]))
                    break

            region = ""
            for f in REGION_FIELDS:
                if fields.get(f):
                    # region is stored as one line of text, not a list, so the
                    # newlines that <br> now leaves behind are folded back into
                    # a comma-separated list of sub-regions
                    region = clean_region(clean_wiki(fields[f]))
                    break

            grapes: list[str] = []
            for f in GRAPE_FIELDS:
                if fields.get(f):
                    grapes = split_list(fields[f])
                    break

            # The French template has no country field, but an AOC is French
            # and a DOCG is Italian, so fall back to the appellation type.
            if not country:
                atype = normalise(fields.get("typeappellation", "")
                                  or fields.get("type", ""))
                for kw, c in APPELLATION_COUNTRY.items():
                    if kw and re.search(rf"\b{re.escape(kw)}\b", atype):
                        country = c
                        break

            if key in merged:
                rec = merged[key]
                if not rec["country"] and country:
                    rec["country"] = country
                if not rec["region"] and region:
                    rec["region"] = region
                if len(grapes) > len(rec["grapes"]):
                    rec["grapes"] = grapes
                rec["langs"].add(lang)
            else:
                merged[key] = {
                    "name": name, "country": country, "region": region,
                    "grapes": grapes, "title": title, "langs": {lang},
                }
                per_lang[lang] += 1

    if not merged:
        print("\nNothing parsed. Field names seen:")
        for f, n in field_counter.most_common(30):
            print(f"  {n:4}  {f}")
        return

    rows = []
    colours = Counter()
    for key, rec in sorted(merged.items(), key=lambda kv: kv[1]["name"]):
        if not (rec["grapes"] or rec["country"]):
            continue
        colour = infer_colour(rec["grapes"])
        colours[colour or "unclear"] += 1
        clean_grapes = finalise_grapes(rec["grapes"])
        rows.append({
            "norm_name": key,
            "name": rec["name"],
            "country": rec["country"],
            "region": rec["region"],
            "typical_colour": colour,
            "grapes": json.dumps(clean_grapes, ensure_ascii=False),
            "grape_count": len(clean_grapes),
            "wikipedia_title": rec["title"],
            "wikipedia_langs": ",".join(sorted(rec["langs"])),
            "source": "wikipedia",
        })

    with open("appellations.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    with_grapes = sum(1 for r in rows if r["grape_count"] > 0)
    print("\n" + "=" * 55)
    print("\nWritten to appellations.csv")
    print(f"  total appellations    {len(rows)}")
    print(f"  with grape data       {with_grapes} ({with_grapes / len(rows) * 100:.0f}%)")
    print(f"  colour red            {colours['red']}")
    print(f"  colour white          {colours['white']}")
    print(f"  colour unclear        {colours['unclear']}")
    print("\n  new entries per wiki:")
    for lang, n in per_lang.most_common():
        print(f"    {lang}  {n}")

    by_country: Counter = Counter(r["country"] for r in rows if r["country"])
    print("\n  top countries:")
    for country, n in by_country.most_common(12):
        print(f"    {country:28} {n}")

    print("\nColour is left blank where the grape list contains both red and")
    print("white varieties. That is correct for Rioja, Penedes and similar:")
    print("they genuinely have no single colour.")

    missing_country = sum(1 for r in rows if not r["country"])
    print(f"\n  rows with NO country: {missing_country}")

    print(f"\n  skipped, not appellations: {len(skipped_titles)}")
    for t in sorted(skipped_titles)[:25]:
        print(f"    {t}")

    print("\n--- DIAGNOSTIC: most common infobox fields seen ---")
    for f, n in field_counter.most_common(35):
        marker = ""
        if f in GRAPE_FIELDS:
            marker = "  <- used for grapes"
        elif f in COUNTRY_FIELDS:
            marker = "  <- used for country"
        elif f in REGION_FIELDS:
            marker = "  <- used for region"
        print(f"  {n:5}  {f}{marker}")

    print("\n--- DIAGNOSTIC: grape names not recognised for colour ---")
    unknown: Counter = Counter()
    for r in rows:
        if r["typical_colour"]:
            continue
        for g in json.loads(r["grapes"]):
            ng = normalise(g)
            if ng and ng not in WHITE_GRAPES and ng not in RED_GRAPES:
                unknown[ng] += 1
    for g, n in unknown.most_common(40):
        print(f"  {n:5}  {g}")


if __name__ == "__main__":
    main()