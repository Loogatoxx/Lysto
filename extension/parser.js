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
    "en ligne", "free", "online", "french", "multi", "bluray", "webrip",
    "hdtv", "dubbed", "sub", "subs", "subtitles", "sous-titres",
    "anime", "manga", "scan", "catalogue", "film",
    "saison complète", "saison complete",
    "télécharger", "telecharger", "download",
  ];

  // Noms de sites connus qu'on veut retirer du titre
  const SITE_NAMES = [
    "wiflix", "coflix", "french-stream", "french stream", "frenchstream",
    "papystreaming", "papy streaming", "streamcomplet", "stream complet",
    "dpstream", "hdss", "voirfilm", "voir film", "voirseries", "voir series",
    "serie streaming", "seriestreaming", "filmstreaming", "film streaming",
    "streamingseries", "senpai-stream", "senpai stream", "senpaistream",
    "anime-sama", "animesama", "anime sama", "neko-sama", "nekosama",
    "otakufr", "mavanimes", "vostanime", "voiranime", "franime",
    "justwatch", "betaseries", "senscritique",
    "streamsite", "ultrastream", "monsite", "monsite streaming",
    "empire-streaming", "empire streaming", "empirestreaming",
    "zustream", "cpasmieux", "cpasbien",
    "ianime", "toonanime",
  ];

  const EP_PATTERNS = [
    // S01E03, S01 E03, S01-E03, S1.E3
    { re: /\bS(\d{1,2})\s*[\s.\-_:]*E(?:p(?:isode)?)?\s*\.?\s*(\d{1,4})\b/i, s: 1, e: 2 },
    // 1x03
    { re: /\b(\d{1,2})\s*x\s*(\d{1,4})\b/i, s: 1, e: 2 },
    // Saison 1 Épisode 3 / Season 1 Episode 3  (pas de \b devant é : accent = non-word en regex JS)
    { re: /\bs(?:aison|eason)\s*(\d{1,2})\b[^0-9]{0,30}?(?<![a-z])[éeÉE]p(?:isode)?\s*\.?\s*(\d{1,4})\b/i, s: 1, e: 2 },
    // Épisode 3 seul (pas de saison)
    { re: /(?<![a-z])[éeÉE]p(?:isode)?\s*\.?\s*(\d{1,4})\b/i, s: null, e: 1 },
    // EP 3, Ep. 3, Ep3 (variante compacte souvent vue dans les selects)
    { re: /\bEP\s*\.?\s*(\d{1,4})\b/i, s: null, e: 1 },
  ];

  const URL_EP_PATTERNS = [
    // /saison-1/episode-3 ou /season1/episode3 ou /s1e3
    { re: /s(?:aison|eason)?[-_/]?(\d{1,2})[-_/]?(?:x|e|[éeÉE]pisode)[-_/]?(\d{1,4})/i, s: 1, e: 2 },
    // /episode-3 ou /episode/3 ou /ep-3 ou /ep/3
    { re: /(?:episode|ep)[-_/]?(\d{1,4})/i, s: null, e: 1 },
    // segment final « /1-2 » = saison 1 épisode 2 (ex. senpai-stream : /episode/<slug>/1-2)
    { re: /\/(\d{1,2})-(\d{1,4})(?:[/?#]|$)/, s: 1, e: 2 },
    // /saison-1-episode-3 (tout en un segment)
    { re: /saison[-_]?(\d{1,2})[-_]episode[-_]?(\d{1,4})/i, s: 1, e: 2 },
    // /s1/e3 (segments séparés par des /)
    { re: /\/s(\d{1,2})\/e(\d{1,4})(?:[/?#]|$)/i, s: 1, e: 2 },
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
      // segment = nom de site connu → on jette
      const sSlug = slugify(s);
      if (SITE_NAMES.some((n) => slugify(n) === sSlug || sSlug.includes(slugify(n)))) return false;
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
      // Noms de site en queue
      for (const s of SITE_NAMES) {
        const re = new RegExp("[\\s\\-:,.]*\\b" + s.replace(/[-\s]+/g, "[-\\s]*") + "\\b[\\s\\-:,.]*$", "i");
        t = t.replace(re, "");
      }
      t = t.replace(/[\s\-–—:,.|]+$/g, "").replace(/^[\s\-–—:,.|]+/g, "");
    } while (t !== prev);

    // Année entre parenthèses en fin de titre
    t = t.replace(/\s*\((19|20)\d{2}\)\s*$/, "");
    // Année seule en fin (ex: "Emily in Paris - 2020")
    t = t.replace(/\s*[-–]\s*(19|20)\d{2}\s*$/, "");
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
      // Patterns d'URL communs pour les sites de streaming
      const patterns = [
        // /series/breaking-bad/... ou /anime/one-piece/... etc
        /(?:series?|shows?|tv|animes?|watch|episodes?|ep|catalogue|film|video|voir|streaming|lecteur)\/([ a-z0-9][a-z0-9\-_]{2,})/i,
        // /breaking-bad-saison-1-episode-3 → on veut "breaking-bad"
        /\/([a-z0-9][a-z0-9\-]{2,})(?:-saison|-season|-s\d|-episode|-ep\d)/i,
      ];
      for (const re of patterns) {
        const m = re.exec(path);
        if (m && !/^[\d\-_]+$/.test(m[1])) {
          const slug = m[1]
            .replace(/-(saison|season|episode|streaming|vf|vostfr|french|multi|complete?)-?\d*.*$/i, "")
            .replace(/-+$/, "");
          if (slug.length >= 2) return unslugify(slug);
        }
      }
    } catch (_) { /* URL invalide */ }
    return "";
  }

  /** Construit l'objet méta final à partir des champs déjà extraits. */
  function makeMeta(showTitle, season, episode, url) {
    showTitle = String(showTitle || "").trim();
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
      season: season != null ? season : null,
      episode: episode != null ? episode : null,
      episodeKey,
      episodeLabel,
      url: url || "",
      isSeries: episode != null,
    };
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
    const GENERIC = /^(lecteur( vid[éeÉE]o)?|player|watch|vid[éeÉE]o|video|film|accueil|home|streaming|catalogue|index)$/i;
    if (!showTitle || GENERIC.test(showTitle)) {
      showTitle = showFromUrl(url) || showTitle;
    }

    let season = ep ? ep.season : null;
    const episode = ep ? ep.episode : null;

    // Saison seule dans l'URL (ex. anime-sama : /catalogue/one-piece/saison1/vostfr/)
    if (season == null) {
      const m = /s(?:aison|eason)[-_/]?(\d{1,2})(?!\d)/i.exec(String(url || ""));
      if (m) season = parseInt(m[1], 10);
    }

    return makeMeta(showTitle, season, episode, url);
  }

  /**
   * Fusionne plusieurs sources de texte (titre de page, og:title, h1/h2,
   * option sélectionnée d'un menu déroulant…). Le nom de la série vient de la
   * première source qui en donne un, la saison et l'épisode de n'importe
   * quelle source — même partielle.
   * Ex. senpai-stream : titre sans numéros, h2 = « … Saison 1 Épisode 2 ».
   * Ex. anime-sama : saison dans l'URL, épisode dans un <select>.
   */
  function parseMediaMulti(candidates, url) {
    const list = (candidates || []).filter((c) => c && String(c).trim());
    let showTitle = "";
    let season = null;
    let episode = null;

    for (const c of list) {
      const p = parseMedia(c, url);
      if (!showTitle && p.showTitle) showTitle = p.showTitle;
      if (season == null && p.season != null) season = p.season;
      if (episode == null && p.episode != null) episode = p.episode;
      if (showTitle && season != null && episode != null) break;
    }
    if (!showTitle) showTitle = showFromUrl(url);

    return makeMeta(showTitle, season, episode, url);
  }

  return { parseMedia, parseMediaMulti, makeMeta, cleanShowTitle, slugify, unslugify };
});
