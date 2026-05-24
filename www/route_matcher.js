/*
 * route_matcher.js — structured (no-AI) hiking route matcher for TOTSKII Wild.
 *
 * Parses a free-text query (Serbian / Russian / English) into structured
 * filters, then scores and ranks routes from routes_index.json. No API key,
 * runs fully client-side. Returns ranked routes with a human-readable reason
 * for each match, so the UI can explain the choice.
 *
 * Usage:
 *   const results = matchRoutes("lagana tura blizu Beograda do 12km", routes);
 *   // -> [{ route, score, reasons:[...] }, ...]
 *
 * Drop-in for a future AI ranker: same signature, same result shape.
 */
(function (root) {
  "use strict";

  // ---- text normalisation ------------------------------------------------
  // Cyrillic -> latin (Serbian + Russian), so "Београд"/"Белград" both reduce.
  var CYR = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "ђ": "dj", "е": "e", "ё": "e",
    "ж": "z", "з": "z", "и": "i", "й": "i", "ј": "j", "к": "k", "л": "l", "љ": "lj",
    "м": "m", "н": "n", "њ": "nj", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "ћ": "c", "у": "u", "ф": "f", "х": "h", "ц": "c", "ч": "c", "џ": "dz", "ш": "s",
    "щ": "s", "ъ": "", "ы": "i", "ь": "", "э": "e", "ю": "u", "я": "a",
  };
  function norm(s) {
    s = (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      out += (CYR[ch] !== undefined ? CYR[ch] : ch);
    }
    return out;
  }

  // ---- gazetteer: place -> [lon, lat] (major SRB cities + hiking hubs) ----
  // Keys are normalised (no diacritics). Used for "near <place>" queries.
  var PLACES = {
    beograd: [20.457, 44.787], "novi sad": [19.833, 45.267], nis: [21.896, 43.321],
    kragujevac: [20.917, 44.013], kraljevo: [20.689, 43.726], cacak: [20.349, 43.891],
    uzice: [19.842, 43.857], valjevo: [19.89, 44.275], sabac: [19.69, 44.755],
    loznica: [19.224, 44.533], zajecar: [22.27, 43.904], bor: [22.097, 44.075],
    vranje: [21.9, 42.551], leskovac: [21.946, 42.998], pirot: [22.586, 43.153],
    sokobanja: [21.873, 43.644], arandjelovac: [20.56, 44.308], jagodina: [21.261, 43.977],
    paracin: [21.408, 43.86], knjazevac: [22.258, 43.567], prijepolje: [19.651, 43.39],
    "nova varos": [19.81, 43.46], sjenica: [20.0, 43.27], ivanjica: [20.23, 43.58],
    "gornji milanovac": [20.46, 44.025], "bajina basta": [19.567, 43.972],
    ljubovija: [19.371, 44.187], zlatibor: [19.7, 43.73], "sremska mitrovica": [19.61, 44.977],
    subotica: [19.665, 46.1], pozarevac: [21.186, 44.617], smederevo: [20.93, 44.663],
    cuprija: [21.38, 43.93], gadjin: [22.03, 43.23], "gadzin han": [22.03, 43.23],
    // Russian-language aliases (transliterate differently from Serbian)
    belgrad: [20.457, 44.787],
  };

  // ---- difficulty synonyms (multi-lingual) -> canonical -------------------
  var DIFFICULTY = {
    lak: ["lak", "lagan", "lako", "laku", "lake", "easy", "lahka",
      "legk", "nesloz", "prost", "nacetnic", "pocetni", "blaga"],
    umeren: ["umeren", "srednj", "moderate", "sredn", "umerenu"],
    "težak": ["tezak", "tesk", "zahtevn", "hard", "tjazel", "tyazh", "naporn"],
    "vrlo težak": ["vrlo tezak", "vrlo tesk", "very hard", "ekstrem", "najtez",
      "ocen sloz", "ochen slozh"],
  };

  // Generic words that appear across many massif names — ignored when stem-
  // matching so "planina"/"gora" alone don't match every mountain.
  var MTN_STOP = { planina: 1, planine: 1, gora: 1, gore: 1, vrh: 1, i: 1, na: 1, srbija: 1 };

  // Match massif names tolerant of case endings ("Тару"->"Tara", "Suvoj"->"Suva")
  // via a prefix-stem comparison of query tokens against significant name words.
  function matchMountains(q, mountains) {
    var tokens = q.split(/[^a-z]+/).filter(function (t) { return t.length >= 3; });
    var hits = [];
    (mountains || []).forEach(function (m) {
      var nm = norm(m);
      if (nm.length >= 4 && q.indexOf(nm) !== -1) { hits.push(m); return; } // full name present
      var words = nm.split(/[^a-z]+/).filter(function (w) { return w.length >= 3 && !MTN_STOP[w]; });
      var ok = words.some(function (w) {
        return tokens.some(function (t) {
          var n = Math.min(t.length, w.length), p = 0;
          while (p < n && t[p] === w[p]) p++;
          if (p >= 4) return true;                              // long shared prefix
          return w.length <= 4 && p >= 3 && p >= w.length - 1;  // short word, near-full stem
        });
      });
      if (ok) hits.push(m);
    });
    return hits;
  }

  // Find a gazetteer place in the (normalised) query, tolerant of Serbian/
  // Russian case endings via a 5-char stem match ("Sokobanje" -> "sokobanja").
  function findNear(q) {
    var tokens = q.split(/[^a-z]+/).filter(function (t) { return t.length >= 3; });
    var best = null;
    Object.keys(PLACES).forEach(function (key) {
      var hit = false;
      if (key.indexOf(" ") !== -1) {
        hit = q.indexOf(key) !== -1 || q.indexOf(key.split(" ")[0] + " ") !== -1;
      } else {
        hit = tokens.some(function (t) {
          if (t === key) return true;
          return key.length >= 5 && t.length >= 5 &&
            t.slice(0, 5) === key.slice(0, 5) && Math.abs(t.length - key.length) <= 4;
        });
      }
      if (hit && (!best || key.length > best.length)) best = key;
    });
    return best;
  }

  // ---- query parsing ------------------------------------------------------
  function parseQuery(query, vocab) {
    var q = " " + norm(query) + " ";
    var f = {
      difficulty: new Set(), regions: new Set(), mountains: new Set(),
      distanceMin: null, distanceMax: null, durationMax: null, durationMin: null,
      near: null, loop: false, raw: query,
    };

    // difficulty
    Object.keys(DIFFICULTY).forEach(function (canon) {
      if (DIFFICULTY[canon].some(function (w) { return q.indexOf(w) !== -1; })) {
        f.difficulty.add(canon);
      }
    });
    // Russian/Serbian "složen/сложный" -> hard, but NOT "nesložen/несложный"
    if (q.indexOf("sloz") !== -1 && q.indexOf("nesloz") === -1) f.difficulty.add("težak");

    // explicit distance: "do 12 km", "<12km", "manje od 12", "preko 20 km", "12-20 km"
    var range = q.match(/(\d{1,3})\s*[-–]\s*(\d{1,3})\s*km/);
    if (range) { f.distanceMin = +range[1]; f.distanceMax = +range[2]; }
    if (f.distanceMax == null) {
      // patterns are matched against transliterated text: менее->menee, меньше->mense
      var mx = q.match(/(?:do|<|manje od|ispod|maks\w*|max|menee|mense)\s*(\d{1,3})\s*km/);
      if (mx) f.distanceMax = +mx[1];
    }
    // preko/od (sr), bolee/bolse/ot (ru transliterated)
    var mn = q.match(/(?:preko|>|vise od|iznad|min\w*|od|bolee|bolse|ot)\s*(\d{1,3})\s*km/);
    if (mn) f.distanceMin = +mn[1];

    // qualitative length
    if (/\b(kratk|short|korot|korat|kratka)/.test(q) && f.distanceMax == null) f.distanceMax = 10;
    if (/\b(dug|long|dlinn|duga)/.test(q) && f.distanceMin == null) f.distanceMin = 20;

    // duration: weekend/multi-day -> long; "pola dana"/half-day -> short
    // (transliterated: выходн->vihodn, многодневн->mnogodnevn, полдня->poldna)
    if (/(vikend|weekend|vihodn|visednevn|mnogodnevn)/.test(q)) f.durationMin = 6;
    if (/(pola dana|poldnevn|half day|poldna)/.test(q)) f.durationMax = 4;
    var hrs = q.match(/(\d{1,2})\s*(?:h|sat|cas|hour)/); // час->cas
    if (hrs) { var h = +hrs[1]; f.durationMin = h - 1.5; f.durationMax = h + 1.5; }

    // loop / category (круг->krug)
    if (/(kruzn|loop|krug|polukruzn)/.test(q)) f.loop = true;

    // "near <place>" + optional radius ("X km od/from")
    var place = findNear(q);
    if (place) {
      var rad = q.match(/(\d{1,3})\s*km\s*(?:od|ot|from)/);
      f.near = { center: PLACES[place], radiusKm: rad ? +rad[1] : 50, place: place };
    }

    // region / mountain names present in the data
    (vocab.regions || []).forEach(function (r) {
      if (q.indexOf(norm(r)) !== -1) f.regions.add(r);
    });
    matchMountains(q, vocab.mountains).forEach(function (m) { f.mountains.add(m); });

    return f;
  }

  // ---- geo ----------------------------------------------------------------
  function haversineKm(a, b) {
    var R = 6371, toRad = Math.PI / 180;
    var dLat = (b[1] - a[1]) * toRad, dLon = (b[0] - a[0]) * toRad;
    var s = Math.sin(dLat / 2) ** 2 +
      Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // ---- scoring ------------------------------------------------------------
  function scoreRoute(route, f) {
    var score = 0, reasons = [], anyFilter = false;

    if (f.difficulty.size) {
      anyFilter = true;
      if (f.difficulty.has(route.difficulty)) { score += 5; reasons.push("težina: " + route.difficulty); }
      else { score -= 4; }
    }

    if (f.distanceMax != null || f.distanceMin != null) {
      anyFilter = true;
      var d = route.distance_km;
      var okMax = f.distanceMax == null || d <= f.distanceMax;
      var okMin = f.distanceMin == null || d >= f.distanceMin;
      if (okMax && okMin) { score += 3; reasons.push(d + " km"); }
      else {
        var over = okMax ? (f.distanceMin - d) : (d - f.distanceMax);
        score -= Math.min(5, over / 5);
      }
    }

    if (f.durationMax != null || f.durationMin != null) {
      anyFilter = true;
      var t = route.duration_h;
      if (t != null) {
        var okt = (f.durationMax == null || t <= f.durationMax) &&
                  (f.durationMin == null || t >= f.durationMin);
        if (okt) { score += 2; reasons.push("~" + t + " h"); }
        else score -= 1.5;
      }
    }

    if (f.mountains.size) {
      anyFilter = true;
      if (f.mountains.has(route.mountain)) { score += 6; reasons.push(route.mountain); }
    }
    if (f.regions.size) {
      anyFilter = true;
      if (f.regions.has(route.region)) { score += 4; reasons.push(route.region); }
    }

    if (f.near && route.start) {
      anyFilter = true;
      var km = haversineKm(f.near.center, route.start);
      if (km <= f.near.radiusKm) {
        score += 4 * (1 - km / f.near.radiusKm); // closer = higher
        reasons.push(Math.round(km) + " km od " + cap(f.near.place));
      } else {
        score -= Math.min(5, (km - f.near.radiusKm) / 25);
      }
    }

    if (f.loop) {
      anyFilter = true;
      if (route.category === "kružna") { score += 2; reasons.push("kružna"); }
    }

    return { score: score, reasons: reasons, anyFilter: anyFilter };
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // ---- structured (faceted) hard filtering --------------------------------
  // Mirrors the iOS RouteMatcher.passes(): every active facet is an AND
  // constraint, so adding a facet only narrows the result set. Difficulty is
  // bucketed into the same 4 canonical levels the app uses.
  function canonDiff(d) {
    if (d === "lak") return "easy";
    if (d === "umeren") return "medium";
    if (d === "težak" || d === "tezak") return "hard";
    return "expert"; // "vrlo težak", "višednevna transverzala", null …
  }

  function passesFacets(route, f) {
    if (f.difficulty && f.difficulty.size && !f.difficulty.has(canonDiff(route.difficulty))) return false;
    if (f.regions && f.regions.size) {
      if (!route.region || !f.regions.has(route.region)) return false;
    }
    if (f.categories && f.categories.size) {
      if (!route.category || !f.categories.has(route.category)) return false;
    }
    if (f.distanceMax != null && route.distance_km > f.distanceMax) return false;
    if (f.distanceMin != null && route.distance_km < f.distanceMin) return false;
    if (f.durationMin != null || f.durationMax != null) {
      if (route.duration_h == null) return false;
      if (f.durationMax != null && route.duration_h > f.durationMax) return false;
      if (f.durationMin != null && route.duration_h < f.durationMin) return false;
    }
    return true;
  }

  // Filter + order (by distance asc) for the structured picker.
  function filterRoutes(f, routes) {
    return routes
      .filter(function (r) { return passesFacets(r, f); })
      .sort(function (a, b) { return a.distance_km - b.distance_km; });
  }

  // ---- public API ---------------------------------------------------------
  function matchRoutes(query, routes, opts) {
    opts = opts || {};
    var limit = opts.limit || 8;
    var vocab = {
      regions: Array.from(new Set(routes.map(function (r) { return r.region; }).filter(Boolean))),
      mountains: Array.from(new Set(routes.map(function (r) { return r.mountain; }).filter(Boolean))),
    };
    var f = parseQuery(query, vocab);

    var scored = routes.map(function (r) {
      var s = scoreRoute(r, f);
      return { route: r, score: s.score, reasons: s.reasons, anyFilter: s.anyFilter };
    });

    var hasFilters = scored.length && scored[0].anyFilter;
    if (!hasFilters) {
      // no parseable constraints -> show shortest/easiest accessible first
      scored.sort(function (a, b) { return a.route.distance_km - b.route.distance_km; });
    } else {
      scored.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.route.distance_km - b.route.distance_km;
      });
      // keep only positively-scored when filters exist; fall back if too few
      var positive = scored.filter(function (x) { return x.score > 0; });
      if (positive.length >= 3) scored = positive;
    }

    return { filters: f, results: scored.slice(0, limit) };
  }

  var api = {
    matchRoutes: matchRoutes, parseQuery: parseQuery, norm: norm, haversineKm: haversineKm,
    filterRoutes: filterRoutes, passesFacets: passesFacets, canonDiff: canonDiff,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RouteMatcher = api;
})(typeof window !== "undefined" ? window : globalThis);
