"""
Offline tests for build_appellations_wikipedia.py.

Each case reproduces a defect found in the first build of the appellations
table, using the kind of raw infobox wikitext that produced it. The expected
output is what the table should have held. Regression cases check that clean
lists still come out exactly as they did before the fixes.

No network access is needed: only the parsing and cleaning functions run.

    python test_build_appellations.py
"""

import re
import sys

import build_appellations_wikipedia as b


def grapes(raw: str) -> list[str]:
    """The exact path main() takes: clean_wiki -> split_list -> finalise."""
    return b.finalise_grapes(b.split_list(b.clean_wiki(raw)))


def colour(raw: str) -> str:
    return b.infer_colour(b.split_list(b.clean_wiki(raw)))


def fallback_country(atype: str) -> str:
    """The typeappellation fallback main() uses when no country field exists."""
    norm = b.normalise(atype)
    for kw, c in b.APPELLATION_COUNTRY.items():
        if kw and re.search(rf"\b{re.escape(kw)}\b", norm):
            return c
    return ""


FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}")
    if not ok:
        print(f"          got:  {got!r}")
        print(f"          want: {want!r}")
        FAILED.append(label)


print("\nDefects from the first build")
check("A. INAO code glued to 'et' by a <small> tag",
      grapes("chardonnay <small>B</small>et pinot noir <small>N</small>"),
      ["Chardonnay", "Pinot Noir"])
check("A. ...and the colour, which that hid, is now mixed -> empty",
      colour("chardonnay <small>B</small>et pinot noir <small>N</small>"), "")
check("B. <br> between grapes no longer glues them",
      grapes("chasselas<br>gamay<br>pinot noir"),
      ["Chasselas", "Gamay", "Pinot Noir"])
check("C. French section headings inside the field",
      grapes("Cépages rouges : bastardo, tinta roriz<br />"
             "Cépages blancs : donzelinho branco"),
      ["Bastardo", "Tinta Roriz", "Donzelinho Branco"])
check("D. English colour headings inside the field",
      grapes("Red: Montepulciano, Sangiovese<br>White: Trebbiano"),
      ["Montepulciano", "Sangiovese", "Trebbiano"])
check("E. prose around the grape",
      grapes("mostly Chardonnay, with occasionally a little Aligoté"),
      ["Chardonnay", "Aligote"])
check("F. French 'pour les ...' clause",
      grapes("merlot N pour les rouges, sémillon B pour les blancs"),
      ["Merlot", "Semillon"])
check("F. ...and the INAO codes it hid now give a mixed colour",
      colour("merlot N pour les rouges, sémillon B pour les blancs"), "")
check("G. production figures are not grapes",
      grapes("2 000 tonnes, cabernet sauvignon"), ["Cabernet Sauvignon"])
check("G. nor are units or area",
      grapes("syrah, 48 tn, 12 km2"), ["Syrah"])
check("   non-grape tokens and fruit are dropped",
      grapes("Merlot, Blueberry, Strawberry, Bordeaux Blends, etc"), ["Merlot"])
check("   'X ou Y' synonyms are split",
      grapes("grolleau ou groslot"), ["Grolleau", "Groslot"])
check("   misspellings in the source resolve to the variety",
      grapes("Zinfindel, Semillion, Gewurtztraminer"),
      ["Zinfandel", "Semillon", "Gewurztraminer"])
check("   unclosed <ref> no longer leaks into a grape name",
      grapes("chenin<ref name=figaro>, sauvignon"), ["Chenin Blanc", "Sauvignon Blanc"])
check("   French articles before a known grape are dropped",
      grapes("la syrah, le gamay"), ["Syrah", "Gamay"])

print("\nCountry from the appellation type, when no country field exists")
check("H. DOC is shared by Italy and Portugal -> empty", fallback_country("DOC"), "")
check("H. DOP is EU-wide -> empty", fallback_country("DOP"), "")
check("H. IGP is EU-wide -> empty", fallback_country("IGP"), "")
check("H. AOP is the French name for the EU PDO -> empty", fallback_country("AOP"), "")
check("H. DOCG is Italy only", fallback_country("DOCG"), "Italy")
check("H. DOCa is Spain only", fallback_country("DOCa"), "Spain")
check("H. AOC stays France", fallback_country("AOC"), "France")
check("H. AVA stays United States", fallback_country("AVA"), "United States")

print("\nCountry cleaning")
for raw, want in [
    ("United States[a]", "United States"),
    ("[[United States]]", "United States"),
    ("USA", "United States"),
    ("Suisse", "Switzerland"),
    ("Grèce", "Greece"),
    ("Liban", "Lebanon"),
    ("France, Italie, Espagne, Autriche", ""),
    ("Algérie (origine) Maroc (actuellement)", ""),
    ("Hungary, Slovakia", ""),
    ("et", ""),
    ("Portugal", "Portugal"),
]:
    check(f"I. {raw!r}", b.clean_country(b.clean_wiki(raw)), want)

print("\nTitles that are not appellations")
for title, skip in [
    ("Vin dans l'Égypte antique", True),
    ("Viticulture en Turquie", True),
    ("Viticulture in Sicily", True),
    ("Château Ksara", True),
    ("Château Kefraya", True),
    ("Vin de paille", True),
    ("Châteauneuf-du-Pape", False),   # a real AOC: no space after Château
    ("Château-Chalon", False),        # a real AOC: hyphen, not space
    ("Château-Grillet", False),       # a real AOC
    ("Rioja (wine)", False),
    ("Douro", False),
]:
    check(f"J. {title!r} skipped={skip}",
          bool(b.NOT_APPELLATION_TITLE.match(title)), skip)

print("\nRegression: clean lists come out exactly as the first build gave them")
# Each expected value below was confirmed against the original script, not
# just written by hand: these inputs were already parsed correctly, and the
# fixes must not change them.
for raw, want in [
    ("cabernet sauvignon, merlot et cabernet franc",
     ["Cabernet Sauvignon", "Merlot", "Cabernet Franc"]),
    ("Tempranillo, Garnacha, Graciano, Mazuelo",
     ["Tempranillo", "Garnacha", "Graciano", "Mazuelo"]),
    ("La Crescent, Frontenac, Marquette",   # "La" is part of the name here
     ["La Crescent", "Frontenac", "Marquette"]),
    ("Nero d'Avola, Frappato", ["Nero D Avola", "Frappato"]),
    ("grenache N, syrah N, mourvèdre N", ["Grenache", "Syrah", "Mourvedre"]),
    ("Black Muscat", ["Muscat"]),
]:
    check(f"K. {raw!r}", grapes(raw), want)

print("\nColour inference")
check("L. all red -> red", colour("grenache N, syrah N"), "red")
check("L. all white -> white", colour("chardonnay B"), "white")
check("L. red and white -> empty", colour("tempranillo, viura"), "")

print("\nLegal category suffixes on titles (the Rioja duplicate)")
for raw, want in [
    ("Rioja DOCa", "Rioja"),
    ("Penedès (DO)", "Penedès"),
    ("Penedès DOP", "Penedès"),
    ("Priorat DOQ", "Priorat"),
    ("Ribera del Duero (DO)", "Ribera del Duero"),
    ("Cariñena DOP", "Cariñena"),
    ("Chianti Classico DOCG", "Chianti Classico"),
    ("Napa Valley AVA", "Napa Valley"),
    ("Douro", "Douro"),              # nothing to strip
    ("Côtes du Rhône", "Côtes du Rhône"),
    ("Do Ferreiro", "Do Ferreiro"),  # leading "Do" is not a suffix
]:
    check(f"M. {raw!r}", b.strip_category(raw), want)

print(f"\n{len(FAILED)} failed")
sys.exit(1 if FAILED else 0)
