#!/usr/bin/env python3
"""Label PSS routes with mountain / region / difficulty (no external API).

Knowledge encoded by Claude: PSS route names almost always carry the massif or
a recognisable toponym, so a keyword table does most of the work; coordinate
bounding boxes are a fallback for the rest. Difficulty is derived from the
geometry computed by enrich_geometry.py.

Reads  output/routes_enriched.json  (for stats)
Writes output/route_labels.json     (slug -> {mountain, region, difficulty, category})

The labels are merged into the geojson by merge_labels.py so this file stays
reviewable and re-runnable.
"""
import json
import os
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "output", "routes_enriched.json")
OUT = os.path.join(HERE, "output", "route_labels.json")

# Region names (Serbian, latin) used consistently across the dataset.
ZAP = "Zapadna Srbija"
SUM = "Šumadija i Pomoravlje"
IST = "Istočna Srbija"
JUG = "Južna Srbija"
JZ = "Jugozapadna Srbija (Sandžak)"
VOJ = "Vojvodina"
CEN = "Centralna Srbija"


def norm(s):
    """Lowercase + strip diacritics so 'Čemernik' matches 'cemernik'."""
    s = s.lower()
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


# Ordered keyword rules: (substrings, mountain, region).
# First matching rule wins, so put specific names before generic ones.
KEYWORDS = [
    # --- Zlatibor / Tara / Zlatar (West) ---
    (["zlatibor", "tornik", "murtenica", "semegnjevo", "ljubis", "dobroselica",
      "negbina", "cigota", "gostilje", "cuker", "ribnica", "vodice", "jecmiste",
      "kobilja glava", "savino brdo", "viogor", "lecica", "marica stena",
      "tetrebovac", "kolijevka", "jokina cuprija", "stublo", "omarski",
      "donje selo", "lupoglav", "liska", "jablanica"], "Zlatibor", ZAP),
    (["tara", "kremna", "mokra gora", "zvijezda", "dreznik", "ravni",
      "kucista"], "Tara", ZAP),
    (["zlatar", "kratovske reke", "uvac", "krvavac"], "Zlatar", JZ),
    (["kamena gora", "sopotnica", "jabuka", "mazici", "pribojska", "priboj",
      "veliki bic", "mali bic", "jagat", "lisa stena", "kanjon panjice",
      "panjice", "brekovo", "banjsko brdo"], "Zlatar / Pešter", JZ),
    # --- Povlen / Valjevske planine / Maljen / Suvobor (West) ---
    (["povlen", "magles", "maglesa", "mravinjci", "samari", "kucerak",
      "mrka stena", "beden"], "Povlen", ZAP),
    (["jablanik", "debelo brdo", "pocuta", "medvednik"], "Jablanik", ZAP),
    (["divcibare", "maljen", "poljanama", "poljani", "golubac", "velika plec",
      "paljba", "subjel", "memorijal", "kostunici", "danilov vrh"], "Maljen", ZAP),
    (["suvobor", "rajac", "takovo", "dici", "slavkovica", "cika dusk",
      "banja vrujci", "ljig"], "Suvobor", ZAP),
    (["taorska vrela", "radanovci", "obradovic", "bele vode", "reke gradac",
      "klisura reke gradac"], "Valjevske planine", ZAP),
    (["narcis", "narcisiste"], "Goč i Stolovi", CEN),
    (["dobrilo nenadic", "miki mladenovic"], "Centralna Srbija", CEN),
    (["bobija", "tornicka", "soko grad", "ljubovija", "tri manastira",
      "razbojiste"], "Bobija", ZAP),
    (["gucevo", "koviljacka kosa", "crni vrh (gucevo)"], "Gučevo", ZAP),
    (["stazama cera", "cer - krupanj", "cer – krupanj"], "Cer", ZAP),
    (["vukove bogaze", "boranja", "jagodnja"], "Boranja", ZAP),
    (["tresnjice", "kanjon tresnjice", "azbukovica"], "Azbukovica", ZAP),
    (["zajaca", "tronosa", "radaljsko", "sarena bukva", "leskova ravan"],
     "Sokolske planine", ZAP),
    # --- Ovčarsko-kablarske planine (Central) ---
    (["ovcar", "kablar", "kadjenica", "kota 889", "devojacka stena",
      "grabova kosa", "debela gora", "sveti sava", "dule krnjajic",
      "ovcarsko-kablarska"], "Ovčar i Kablar", CEN),
    # --- Fruška gora & Vojvodina ---
    (["fruska", "fruskogorska", "cortanovacka", "bukovacki"], "Fruška gora", VOJ),
    (["vrsack", "guduricki", "lisicije glave", "lisic. glave", "kamenarice",
      "manastir srediste", "manastir mesic"], "Vršačke planine", VOJ),
    (["palic", "tresetiste", "jegrick", "horgos", "backi vinogradi",
      "stari zednik", "obalom jegricke"], "Vojvodina (ravnica)", VOJ),
    (["bojcinska"], "Srem", VOJ),
    # --- Šumadija / Pomoravlje ---
    (["avala"], "Avala", SUM),
    (["bukulja", "arandjelovac"], "Bukulja", SUM),
    (["juhor"], "Juhor", SUM),
    (["gledic", "bajcetina", "adzine livade", "kamenac"], "Gledićke planine", SUM),
    (["kotlenik", "kotlenjaca", "gruzansko", "knic", "leskovac"], "Kotlenik", SUM),
    (["zezelj", "besnjaja", "bukorovac", "kragujev"], "Šumadija (Kragujevac)", SUM),
    (["kalenic", "raletinac", "manastirak", "zupanjevac", "manastirska tura"],
     "Levač", SUM),
    (["draca", "manastir draca"], "Šumadija (Kragujevac)", SUM),
    (["jagodina", "djurdjevo brdo", "ribare", "kocin hrast", "ravanica",
      "bostava"], "Pomoravlje", SUM),
    (["manastirska staza"], "Šumadija", SUM),
    # --- Istočna Srbija: Beljanica/Kučaj/Homolje/Rtanj/Ozren/Devica ---
    (["beljanica", "golovrsac", "resav", "suvaja", "lisine",
      "bogojavljenski"], "Beljanica", IST),
    (["grza", "kozji rog", "javorak", "kucaj"], "Kučaj", IST),
    (["vukan", "stubej", "gornjak", "zdrelo", "jezevac", "krupajsk",
      "sumorovac", "vranj", "krepoljin", "homolj", "dubocice", "trest",
      "strnjak"], "Homolje", IST),
    (["rtanj", "rtnja", "siljak", "tomiceva koliba", "muzinac"], "Rtanj", IST),
    (["device", "devici", "propast", "krstatac", "slemen", "milusinac",
      "sesalac", "sesalacka", "citluk", "izgarske"], "Devica", IST),
    (["sokobanja", "ripaljka", "jermencic", "ozren", "lepterija", "sokograd",
      "kalinovica", "ostra cuka", "leskovik", "vrmdza", "kulin vrh",
      "oko ostre cuke", "maljica", "radenkovac", "ozrenska vrata",
      "golemi kamen", "sokobanje"], "Ozren (Sokobanja)", IST),
    (["gola planina", "sarbanovac", "baba"], "Gola planina", IST),
    (["vrska cuka", "vetren", "vlaski do"], "Vrška čuka", IST),
    (["kozelj", "marinovac", "glogovacki", "ledenicki"], "Tresta", IST),
    (["trubarevac", "bovansko", "vrbovac", "djurkov", "via militaris",
      "lipovac", "koviljaca", "sretenjski", "pozdrav prolecu", "drenovac",
      "aleksinac"], "Aleksinačko pomoravlje", IST),
    (["bastionska", "kalna", "knjazevac"], "Stara planina", IST),
    # --- Južna Srbija: Suva planina / Svrljiške / Vlasina / Kukavica ---
    (["vlasina", "cemernik", "vrtop", "borovnice", "promaja", "gramada",
      "vlasinski"], "Vlasina i Čemernik", JUG),
    (["trem", "bojanine vode", "sokolov kamen", "koritnik", "sicevo",
      "suva trail", "sokolov put", "devojacki grob", "rautovo", "koritnjak",
      "donja studena", "krcimir", "golemo straziste", "litica", "taskovici",
      "crni kamen", "pasarelo", "divljana", "beziste", "koritnica"],
     "Suva planina", JUG),
    (["cerje", "goli vrh", "ljuti vrh", "kravlje", "kamenica", "pecurina",
      "debeli vrh", "provalija"], "Svrljiške planine", JUG),
    (["kalafat", "matejevac", "knez selo", "gradac-sliva", "tvrdjava nis",
      "niska banja", "nisevacka", "prekonoska", "sicevo"], "Niška okolina", JUG),
    (["borince", "petrov vrh", "vranje", "pljackovica"], "Vranjske planine", JUG),
    (["ritopek", "vinca", "grocka"], "Beograd (Podunavlje)", SUM),
    (["ples", "beloinje", "gradiste", "cirin prolaz", "babicka"],
     "Babička gora", JUG),
    (["kukavice", "kukavica"], "Kukavica", JUG),
    (["mecje stene", "radan", "pasjaca", "lebane"], "Radan", JUG),
    (["device do izvora", "plato device", "4 vrha device", "moravice"],
     "Devica", IST),
    (["ostrovica", "oblik", "krupac", "zeleni vrh"], "Svrljiške planine", JUG),
    (["sijanka", "markov grad", "furniste", "repusnica", "krstovski",
      "strugara", "vlajna", "sokolica", "biser kukavice", "kita",
      "staza zdravlja"], "Kukavica", JUG),
]

# Coordinate bounding-box fallback: (lon_min, lon_max, lat_min, lat_max, mountain, region)
BBOXES = [
    (19.0, 20.2, 45.0, 46.3, "Vojvodina (ravnica)", VOJ),
    (20.2, 21.6, 45.0, 46.3, "Vojvodina (ravnica)", VOJ),
    (21.0, 21.7, 45.0, 45.4, "Vršačke planine", VOJ),
    (19.0, 20.0, 44.0, 44.7, "Valjevske planine", ZAP),
    (19.0, 19.6, 43.2, 44.0, "Zlatar / Pešter", JZ),
    (19.6, 20.1, 43.4, 44.0, "Zlatibor", ZAP),
    (20.0, 20.5, 43.7, 44.2, "Ovčar i Kablar", CEN),
    (20.4, 21.3, 43.7, 44.5, "Šumadija", SUM),
    (21.3, 21.9, 43.8, 44.6, "Homolje", IST),
    (21.4, 22.0, 43.9, 44.2, "Kučaj", IST),
    (21.6, 22.6, 43.5, 44.0, "Sokobanjska kotlina", IST),
    (21.7, 22.6, 42.6, 43.5, "Južna Srbija", JUG),
    (20.0, 21.5, 42.6, 43.6, "Jugozapadna Srbija (Sandžak)", JZ),
    # E-path segments that fall outside the massif boxes above
    (21.9, 22.8, 44.3, 44.9, "Đerdap", IST),       # e4-9, e4-10
    (20.3, 20.9, 44.7, 45.0, "Beograd (Podunavlje)", SUM),  # e4-5
    (19.4, 19.9, 44.8, 45.0, "Srem", VOJ),         # e7-6
]


def label_geo(slug, name, lon, lat):
    n = norm(name) + " " + norm(slug)
    for subs, mtn, reg in KEYWORDS:
        if any(norm(s) in n for s in subs):
            return mtn, reg
    if lon is not None and lat is not None:
        for lo, hi, la, ha, mtn, reg in BBOXES:
            if lo <= lon <= hi and la <= lat <= ha:
                return mtn, reg
    return None, None


def difficulty(dist, ascent):
    if not dist:
        return None
    if dist > 55:
        return "višednevna transverzala"
    if ascent is not None:
        eff = dist + ascent / 100.0
        if eff < 10:
            return "lak"
        if eff < 20:
            return "umeren"
        if eff < 32:
            return "težak"
        return "vrlo težak"
    # distance only (no elevation yet)
    if dist < 8:
        return "lak"
    if dist < 16:
        return "umeren"
    if dist < 28:
        return "težak"
    return "vrlo težak"


def category(name):
    n = norm(name)
    if "e4-" in norm(name) or "e7-" in norm(name) or "e7 " in n:
        return "E-transverzala"
    if "transverzala" in n or "maraton" in n:
        return "transverzala"
    if "kruzna" in n:
        return "kružna"
    return "linijska"


def main():
    with open(SRC, encoding="utf-8") as f:
        rows = json.load(f)

    labels = {}
    unknown = []
    for r in rows:
        slug, name = r["slug"], r["name"]
        s = r.get("start") or [None, None]
        mtn, reg = label_geo(slug, name, s[0], s[1])
        labels[slug] = {
            "mountain": mtn,
            "region": reg,
            "difficulty": difficulty(r.get("distance_km"), r.get("ascent_m")),
            "category": category(name),
        }
        if mtn is None:
            unknown.append((slug, name, s))

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(labels, f, ensure_ascii=False, indent=2)

    from collections import Counter
    reg_c = Counter(v["region"] for v in labels.values())
    dif_c = Counter(v["difficulty"] for v in labels.values())
    print(f"labeled {len(labels)} routes -> {OUT}")
    print("\nby region:")
    for k, c in reg_c.most_common():
        print(f"  {k}: {c}")
    print("\nby difficulty:")
    for k, c in dif_c.most_common():
        print(f"  {k}: {c}")
    print(f"\nUNLABELED mountain ({len(unknown)}):")
    for slug, name, s in unknown:
        print(f"  {slug} | {name} | {s}")


if __name__ == "__main__":
    main()
