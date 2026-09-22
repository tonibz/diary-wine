"""
Find out how Wikidata actually models wine appellations, before writing a
query against it.

Why this script exists
----------------------
Two SPARQL queries against Wikidata came back nearly empty. The tempting
next move is to guess different Q-ids and try again, which wasted a run
twice. So instead of guessing, this asks Wikidata directly: take fifteen
appellations any wine drinker could name, look each one up by name, and
print what classes and properties it actually carries.

The answer decided the project. Only 2 of the 15 had grape data (P186), and
name lookup resolved "Barolo" to a family name, "Douro" to a person and
"Mosel" to a French department. Grapes and colour were the whole point of
the reference table, so Wikidata could not supply it and the build moved to
Wikipedia infoboxes instead (build_appellations_wikipedia.py).

The script is kept because that negative result is part of the method, and
because re-running it is the way to check whether Wikidata has improved.

Usage:
    pip install requests
    python discover_wikidata.py
"""

import time
from collections import Counter

import requests

USER_AGENT = "WineDiary-TFB/1.0 (student research project; antoni.bove3@gmail.com)"
API = "https://www.wikidata.org/w/api.php"

# Fifteen well-known appellations across six countries. Chosen to be ones a
# complete reference table would certainly have to cover.
SEEDS = [
    ("Chateauneuf-du-Pape", "France"),
    ("Corton-Charlemagne", "France"),
    ("Saint-Estephe", "France"),
    ("Chablis", "France"),
    ("Rioja", "Spain"),
    ("Priorat", "Spain"),
    ("Penedes", "Spain"),
    ("Rias Baixas", "Spain"),
    ("Barolo", "Italy"),
    ("Chianti Classico", "Italy"),
    ("Brunello di Montalcino", "Italy"),
    ("Douro", "Portugal"),
    ("Vinho Verde", "Portugal"),
    ("Napa Valley AVA", "United States"),
    ("Mosel", "Germany"),
]

# The properties that would matter if the data were there.
INTERESTING = {
    "P31": "instance of",
    "P279": "subclass of",
    "P17": "country",
    "P131": "located in admin entity",
    "P186": "made from material",
    "P1389": "product certification",
}


def api(params: dict) -> dict:
    params = {**params, "format": "json", "formatversion": "2"}
    for attempt in range(3):
        try:
            r = requests.get(API, params=params,
                             headers={"User-Agent": USER_AGENT}, timeout=45)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"    api error: {e} (attempt {attempt + 1}/3)")
            time.sleep(3 * (attempt + 1))
    return {}


def search(name: str) -> str | None:
    """First search hit for a name. Deliberately naive: that is the point."""
    data = api({"action": "wbsearchentities", "search": name,
                "language": "en", "type": "item", "limit": "1"})
    hits = data.get("search") or []
    return hits[0]["id"] if hits else None


def entity(qid: str) -> dict:
    data = api({"action": "wbgetentities", "ids": qid, "props": "claims|labels"})
    return (data.get("entities") or {}).get(qid, {})


def labels(qids: list[str]) -> dict[str, str]:
    if not qids:
        return {}
    out: dict[str, str] = {}
    for i in range(0, len(qids), 50):
        chunk = qids[i:i + 50]
        data = api({"action": "wbgetentities", "ids": "|".join(chunk),
                    "props": "labels", "languages": "en"})
        for qid, ent in (data.get("entities") or {}).items():
            out[qid] = (ent.get("labels", {}).get("en", {}).get("value") or qid)
        time.sleep(0.2)
    return out


def values(claims: dict, prop: str) -> list[str]:
    """Q-ids a property points at."""
    out = []
    for claim in claims.get(prop, []):
        snak = claim.get("mainsnak", {})
        val = snak.get("datavalue", {}).get("value")
        if isinstance(val, dict) and "id" in val:
            out.append(val["id"])
    return out


def main() -> None:
    print("Looking up how Wikidata models real appellations.\n")

    with_grapes = 0
    instance_classes: Counter = Counter()
    certifications: Counter = Counter()
    all_properties: Counter = Counter()
    pending: set[str] = set()
    found: list[tuple[str, str, str, dict]] = []

    for name, country in SEEDS:
        qid = search(name)
        if not qid:
            print(f"{name}  ({country})  ->  no search hit")
            continue
        ent = entity(qid)
        claims = ent.get("claims", {})
        found.append((name, country, qid, claims))
        for prop in claims:
            all_properties[prop] += 1
        for prop in ("P31", "P279", "P1389", "P186"):
            pending.update(values(claims, prop))
        time.sleep(0.2)

    names = labels(sorted(pending))

    for name, country, qid, claims in found:
        print(f"{name}  ({country})  ->  {qid}")
        for prop in ("P31", "P279", "P1389"):
            vals = [names.get(q, q) for q in values(claims, prop)]
            if vals:
                print(f"    {INTERESTING[prop]:16} {', '.join(vals)}")
            if prop == "P31":
                for q in values(claims, prop):
                    instance_classes[(q, names.get(q, q))] += 1
            if prop == "P1389":
                for q in values(claims, prop):
                    certifications[(q, names.get(q, q))] += 1
        grapes = [names.get(q, q) for q in values(claims, "P186")]
        if grapes:
            with_grapes += 1
            print(f"    {'made from':16} {', '.join(grapes)}")
        else:
            print(f"    {'made from':16} (none listed)")
        present = [f"{p} {INTERESTING[p]}" for p in INTERESTING if p in claims]
        print(f"    {'has properties':16} {', '.join(present)}")
        print()

    print("=" * 60)
    print(f"\n{with_grapes}/{len(SEEDS)} seeds had grape data (P186)\n")

    print("Most common 'instance of' classes across the seeds:")
    for (qid, label), n in instance_classes.most_common():
        print(f"    {n}  {qid:12} {label}")

    print("\nProduct certification values seen:")
    for (qid, label), n in certifications.most_common():
        print(f"    {n}  {qid:12} {label}")

    print("\nMost common properties overall:")
    for prop, n in all_properties.most_common(20):
        print(f"   {n:3}  {prop:8} {INTERESTING.get(prop, '')}")

    print("\nPaste this output back and the real query can be written from it.")


if __name__ == "__main__":
    main()
