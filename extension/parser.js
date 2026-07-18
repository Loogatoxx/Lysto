/*
 * Lysto — parser.js
 * Extrait « quelle série / quel épisode » depuis le titre de la page et l'URL.
 * Chargé à la fois dans les content scripts et le service worker (importScripts),
 * et testable sous Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LystoParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Mots parasites qu'on retire du titre (sites de streaming, qualité, langue…)
  const NOISE_WORDS = [
    "en streaming", "streaming", "vostfr", "vostr", "vost", "vf", "vo",
    "gratuit", "gratuitement", "complet", "complete", "hd", "full hd", "4k",
    "regarder", "voir", "watch", "serie", "série", "episode complet",
    "en ligne", "free", "online",
  ];

  const EP_PATTERNS = [
    // S01E03, S01 E03, S01-E03, S1.E3
    { re: /\bS(\d{1,2})\s*[\s.\-_:]*E(?:p(?:isode)?)?\s*\.?\s*(\d{1,4})\b/i, s: 1, e: 2 },
    // 1x03
    { re: /\b(\d{1,2})\s*x\s*(\d{1,4})\b/i, s: 1, e: 2 },
    // Saison 1 Épisode 3 / Season 1 Episode 3  (pas de \b devant é : accent = non-word en regex JS)
    { re: /\bs(?:aison|eason)\s*(\d{1,2})\b[^0-9]{0,30}?(?<![a-z])[ée]p(?:isode)?\s*\.?\s*(\d{1,4})\b/i, s: 1, e: 2 },
    // Épisode 3 seul (pas de saison)
    { re: /(?<![a-z])[ée]p(?:isode)?\s*\.?\s*(\d{1,4})\b/i, s: null, e: 1 },
  ];

  const URL_EP_PATTERNS = [
    { re: /s(?:aison|eason)?[-_/]?(\d{1,2})[-_/]?(?:x|e|[ée]pisode)[-_/]?(\d{1,4})/i, s: 1, e: 2 },
    { re: /episode[-_/]?(\d{1,4})/i, s: null, e: 1 },
  ];

  function pad(n, len) {
    return String(n).padStart(len, "0");
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function unslugify(slug) {
    return String(slug || "")
      .replace(/[-_]+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Nettoie un fragment de titre : séparateurs, mots parasites, nom du site…
  function cleanShowTitle(raw) {
    if (!raw) return "";
    let t = String(raw);

    // On garde ce qui précède un « | » (le site est presque toujours après)
    t = t.split("|")[0];

    // Sépare sur les tirets/points médians et retire les segments 100% parasites
    t = t.replace(/[–—·•»«]/g, "-");
    const segments = t.split(/\s+-\s+|\s+:\s+/).filter((seg) => {
      const s = seg.trim().toLowerCase();
      if (!s) return false;
      // segment composé uniquement de mots parasites → on jette
      const words = s.split(/\s+/).filter(Boolean);
      const noise = words.filter((w) =>
        NOISE_WORDS.some((n) => w === n || n.split(" ").includes(w))
      );
      return noise.length < words.length;
    });
    t = (segments[0] || "").trim();

    // Verbes d'accroche en tête
    t = t.replace(/^(regarder|voir|watch|streaming)\s+/i, "");
    // Mots parasites en queue (répété tant que ça en retire)
    let prev;
    do {
      prev = t;
      for (const n of NOISE_WORDS) {
        const re = new RegExp("[\\s\\-:,.]*\\b" + n.replace(/ /g, "\\s+") + "\\b[\\s\\-:,.]*$", "i");
        t = t.replace(re, "");
      }
      t = t.replace(/[\s\-–—:,.|]+$/g, "").replace(/^[\s\-–—:,.|]+/g, "");
    } while (t !== prev);

    // Année entre parenthèses en fin de titre
    t = t.replace(/\s*\((19|20)\d{2}\)\s*$/, "");
    return t.trim();
  }

  function matchEpisode(text, patterns) {
    for (const p of patterns) {
      const m = p.re.exec(text);
      if (m) {
        return {
          season: p.s ? parseInt(m[p.s], 10) : null,
          episode: parseInt(m[p.e], 10),
          index: m.index,
          length: m[0].length,
        };
      }
    }
    return null;
  }

  // Essaie de retrouver le nom de la série dans le chemin de l'URL
  function showFromUrl(url) {
    try {
      const path = new URL(url).pathname;
      const m = /(?:series?|show|tv|anime|watch)\/([a-z0-9][a-z0-9\-_]{2,})/i.exec(path);
      if (m) {
        const slug = m[1].replace(/-(saison|season|episode|streaming|vf|vostfr)-?\d*.*$/i, "");
        return unslugify(slug);
      }
    } catch (_) { /* URL invalide */ }
    return "";
  }

  /**
   * Point d'entrée : titre de page + URL → infos série/épisode.
   * Retourne toujours un objet ; showTitle vide = rien de reconnu.
   */
  function parseMedia(title, url) {
    const t = String(title || "");
    let ep = matchEpisode(t, EP_PATTERNS);
    let showTitle = "";

    if (ep) {
      const before = t.slice(0, ep.index);
      const after = t.slice(ep.index + ep.length);
      showTitle = cleanShowTitle(before) || cleanShowTitle(after);
    } else {
      ep = matchEpisode(String(url || ""), URL_EP_PATTERNS);
      showTitle = cleanShowTitle(t);
    }

    // Titre générique de lecteur vidéo → on préfère le slug de l'URL
    const GENERIC = /^(lecteur( vid[ée]o)?|player|watch|vid[ée]o|video|film|accueil|home|streaming)$/i;
    if (!showTitle || GENERIC.test(showTitle)) {
      showTitle = showFromUrl(url) || showTitle;
    }

    const season = ep ? ep.season : null;
    const episode = ep ? ep.episode : null;

    let episodeKey, episodeLabel;
    if (episode != null && season != null) {
      episodeKey = "S" + pad(season, 2) + "E" + pad(episode, 3);
      episodeLabel = "Saison " + season + " · Épisode " + episode;
    } else if (episode != null) {
      episodeKey = "E" + pad(episode, 4);
      episodeLabel = "Épisode " + episode;
    } else {
      // Pas d'info épisode : chaque page devient sa propre entrée
      let tail = "";
      try { tail = new URL(url).pathname; } catch (_) { tail = String(url || ""); }
      episodeKey = "url:" + slugify(tail).slice(0, 80);
      episodeLabel = "Épisode en cours";
    }

    return {
      showId: slugify(showTitle),
      showTitle,
      season,
      episode,
      episodeKey,
      episodeLabel,
      url: url || "",
      isSeries: episode != null,
    };
  }

  return { parseMedia, cleanShowTitle, slugify, unslugify };
});
