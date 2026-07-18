/*
 * Lysto — background.js (service worker)
 * Rôle : relais entre la frame vidéo et la frame principale d'un même onglet,
 * décisions (proposer l'ajout ? proposer la reprise ?) et écriture du stockage.
 *
 * storage.local : { shows: {showId: {...}}, ignored: {showId: {...}} }
 * état par onglet (meta, dernière position, "déjà demandé") : storage.session
 * avec repli mémoire si indisponible (vieux Safari).
 */
importScripts("parser.js");

const api = typeof browser !== "undefined" && browser.runtime ? browser : chrome;

/* --------------------- état par onglet (session) ---------------------- */
const memTabs = new Map(); // repli si storage.session absent

async function getTabState(tabId) {
  if (api.storage.session) {
    const data = await api.storage.session.get("tab:" + tabId);
    return data["tab:" + tabId] || {};
  }
  return memTabs.get(tabId) || {};
}

async function setTabState(tabId, state) {
  if (api.storage.session) {
    await api.storage.session.set({ ["tab:" + tabId]: state });
  } else {
    memTabs.set(tabId, state);
  }
}

async function clearTabState(tabId) {
  if (api.storage.session) {
    await api.storage.session.remove("tab:" + tabId);
  } else {
    memTabs.delete(tabId);
  }
}

/* --------------------------- stockage local --------------------------- */
async function getLocal() {
  const data = await api.storage.local.get(["shows", "ignored"]);
  return { shows: data.shows || {}, ignored: data.ignored || {} };
}

async function setLocal(patch) {
  await api.storage.local.set(patch);
}

/* --------------------------- assistance IA ---------------------------- */
/*
 * Dernier recours quand le parseur n'a pas identifié série + épisode.
 * Nécessite une clé API Anthropic dans les réglages du popup (stockée en
 * local uniquement). Un seul appel par page, résultat mis en cache.
 */
const AI_MODEL = "claude-opus-4-8";

const AI_SCHEMA = {
  type: "object",
  properties: {
    show: { anyOf: [{ type: "string" }, { type: "null" }] },
    season: { anyOf: [{ type: "integer" }, { type: "null" }] },
    episode: { anyOf: [{ type: "integer" }, { type: "null" }] },
  },
  required: ["show", "season", "episode"],
  additionalProperties: false,
};

async function aiEnrich(meta, candidates, sender) {
  const { settings } = await api.storage.local.get("settings");
  const aiKey = settings && settings.aiKey;
  if (!aiKey) return null;

  const url = (meta && meta.url) || (sender.tab && sender.tab.url) || "";
  const texts = (candidates && candidates.length)
    ? candidates
    : [sender.tab && sender.tab.title].filter(Boolean);
  if (!url && !texts.length) return null;

  // Cache par page (et par sélection d'épisode) pour ne payer qu'un appel
  const cacheKey = "ai:" + url + "::" + texts.join("|").slice(0, 300);
  if (api.storage.session) {
    const cached = await api.storage.session.get(cacheKey);
    if (cached[cacheKey] !== undefined) return cached[cacheKey];
  }

  let result = null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": aiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 256,
        output_config: { format: { type: "json_schema", schema: AI_SCHEMA } },
        messages: [{
          role: "user",
          content:
            "Voici les métadonnées d'une page d'un site de streaming vidéo. " +
            "Identifie la série (ou l'anime/le film) regardée, ainsi que le numéro " +
            "de saison et d'épisode si présents. Réponds null pour tout champ " +
            "introuvable. Le nom de la série doit être propre, sans mention du " +
            "site, de la langue (VF/VOSTFR) ou de la qualité.\n\n" +
            "URL : " + url + "\n" +
            "Textes de la page :\n" + texts.map((t) => "- " + t).join("\n"),
        }],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.stop_reason !== "refusal") {
        const text = ((data.content || []).find((b) => b.type === "text") || {}).text || "";
        const parsed = JSON.parse(text);
        const showTitle = parsed.show || (meta && meta.showTitle) || "";
        if (showTitle) {
          result = LystoParser.makeMeta(
            showTitle,
            parsed.season != null ? parsed.season : meta && meta.season,
            parsed.episode != null ? parsed.episode : meta && meta.episode,
            url
          );
        }
      }
    }
  } catch (_) { /* réseau/JSON : on retombe sur l'heuristique */ }

  if (api.storage.session) {
    await api.storage.session.set({ [cacheKey]: result });
  }
  return result;
}

/* ------------------------------ helpers ------------------------------- */
function sendToTab(tabId, msg) {
  try {
    api.tabs.sendMessage(tabId, msg).catch(() => {});
  } catch (_) { /* onglet fermé */ }
}

async function metaForTab(tabId, sender) {
  const state = await getTabState(tabId);
  if (state.meta && state.meta.showTitle) return state.meta;
  // Repli : la frame top n'a rien envoyé → on analyse le titre de l'onglet
  const tab = sender && sender.tab;
  if (tab && (tab.title || tab.url)) {
    return LystoParser.parseMedia(tab.title || "", tab.url || "");
  }
  return null;
}

/**
 * Attend que le meta soit disponible pour un onglet (retry avec backoff).
 * Utile quand la frame vidéo envoie suggestAdd avant que la frame top
 * ait eu le temps d'envoyer ses méta.
 */
async function metaForTabWithRetry(tabId, sender, maxRetries) {
  maxRetries = maxRetries || 3;
  for (let i = 0; i <= maxRetries; i++) {
    const meta = await metaForTab(tabId, sender);
    if (meta && meta.showTitle) return meta;
    if (i < maxRetries) {
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  // Dernier recours : essayer de récupérer les infos directement du tab
  try {
    const tab = await api.tabs.get(tabId);
    if (tab && (tab.title || tab.url)) {
      return LystoParser.parseMedia(tab.title || "", tab.url || "");
    }
  } catch (_) { /* onglet fermé */ }
  return null;
}

function episodeRecord(existing, meta, position, duration) {
  const finished = duration > 0 && position / duration >= 0.93;
  return Object.assign({}, existing, {
    season: meta.season,
    episode: meta.episode,
    label: meta.episodeLabel,
    url: meta.url,
    position: Math.floor(position),
    duration: Math.floor(duration || 0),
    finished,
    updatedAt: Date.now(),
  });
}

async function saveProgress(meta, position, duration) {
  const { shows } = await getLocal();
  const show = shows[meta.showId];
  if (!show) return false;
  const key = meta.episodeKey;
  show.episodes = show.episodes || {};
  show.episodes[key] = episodeRecord(show.episodes[key], meta, position, duration);
  show.lastEpisode = key;
  show.lastWatchedAt = Date.now();
  await setLocal({ shows });
  return true;
}

async function addShowFromMeta(meta, tabState) {
  const { shows, ignored } = await getLocal();
  if (!shows[meta.showId]) {
    shows[meta.showId] = {
      id: meta.showId,
      title: meta.showTitle,
      addedAt: Date.now(),
      lastWatchedAt: Date.now(),
      archived: false,
      episodes: {},
    };
  }
  delete ignored[meta.showId];
  const show = shows[meta.showId];
  const progress = tabState && tabState.lastProgress;
  show.episodes[meta.episodeKey] = episodeRecord(
    show.episodes[meta.episodeKey],
    meta,
    progress ? progress.position : 0,
    progress ? progress.duration : 0
  );
  show.lastEpisode = meta.episodeKey;
  show.lastWatchedAt = Date.now();
  await setLocal({ shows, ignored });
}

/* ------------------------------ messages ------------------------------ */
async function handleMessage(msg, sender) {
  if (!msg || typeof msg.type !== "string") return null;

  // Messages du popup (pas d'onglet émetteur) : tabId explicite
  if (msg.type === "lysto:getMeta") {
    if (msg.tabId == null) return null;
    const state = await getTabState(msg.tabId);
    if (state.meta && state.meta.showTitle) return state.meta;
    try {
      const tab = await api.tabs.get(msg.tabId);
      return LystoParser.parseMedia(tab.title || "", tab.url || "");
    } catch (_) { return null; }
  }

  if (msg.type === "lysto:manualAdd") {
    const tabId = msg.tabId;
    if (tabId == null) return { ok: false };
    const state = await getTabState(tabId);
    let meta = state.meta && state.meta.showTitle ? state.meta : null;
    let url = (meta && meta.url) || "";
    if (!meta || !url) {
      try {
        const tab = await api.tabs.get(tabId);
        url = url || tab.url || "";
        if (!meta) meta = LystoParser.parseMedia(tab.title || "", tab.url || "");
      } catch (_) { /* onglet fermé */ }
    }
    // Le popup peut corriger titre/saison/épisode avant l'ajout
    const o = msg.override || {};
    const title = (o.title || (meta && meta.showTitle) || "").trim();
    if (!title) return { ok: false };
    meta = LystoParser.makeMeta(
      title,
      o.season != null ? o.season : meta && meta.season,
      o.episode != null ? o.episode : meta && meta.episode,
      url
    );
    state.meta = meta;
    await setTabState(tabId, state);
    await addShowFromMeta(meta, state);
    sendToTab(tabId, { type: "lysto:toastResult", kind: "add", action: "accept", position: null });
    return { ok: true, title: meta.showTitle };
  }

  const tabId = sender.tab ? sender.tab.id : null;
  if (tabId == null) return null;

  switch (msg.type) {
    case "lysto:meta": {
      const state = await getTabState(tabId);
      state.meta = msg.meta;
      state.candidates = msg.candidates || [];
      await setTabState(tabId, state);
      return null;
    }

    case "lysto:videoFound": {
      let meta = await metaForTabWithRetry(tabId, sender, 3);
      // L'algo n'a pas tout trouvé ? On demande de l'aide à Claude (optionnel)
      if (!meta || !meta.showTitle || !meta.isSeries) {
        const state = await getTabState(tabId);
        const enriched = await aiEnrich(meta, state.candidates, sender);
        if (enriched) {
          meta = enriched;
          state.meta = meta;
          await setTabState(tabId, state);
        }
      }
      if (!meta || !meta.showId) return { tracked: false, ignored: false, resume: null };
      const { shows, ignored } = await getLocal();
      const show = shows[meta.showId];
      const ep = show && show.episodes ? show.episodes[meta.episodeKey] : null;
      return {
        tracked: !!show,
        ignored: !!ignored[meta.showId],
        resume: ep && !ep.finished && ep.position > 0 ? { position: ep.position } : null,
      };
    }

    case "lysto:progress": {
      const meta = await metaForTab(tabId, sender);
      if (!meta || !meta.showId) return null;
      const state = await getTabState(tabId);
      state.lastProgress = { position: msg.position, duration: msg.duration, at: Date.now() };
      await setTabState(tabId, state);
      await saveProgress(meta, msg.position, msg.duration);
      return null;
    }

    case "lysto:suggestAdd": {
      // Utilise retry pour attendre que le meta arrive de la frame top
      const meta = await metaForTabWithRetry(tabId, sender, 4);
      if (!meta || !meta.showId || !meta.showTitle) return null;
      const { ignored } = await getLocal();
      if (ignored[meta.showId]) return null; // déjà ignorée par l'utilisateur
      const state = await getTabState(tabId);
      state.asked = state.asked || {};
      if (state.asked[meta.showId]) return null; // déjà proposé dans cet onglet
      state.asked[meta.showId] = true;
      await setTabState(tabId, state);
      sendToTab(tabId, {
        type: "lysto:toast",
        kind: "add",
        showTitle: meta.showTitle,
        episodeLabel: meta.episodeLabel,
      });
      return null;
    }

    case "lysto:requestToast": {
      const meta = await metaForTabWithRetry(tabId, sender, 2);
      if (!meta) return null;
      sendToTab(tabId, {
        type: "lysto:toast",
        kind: msg.kind,
        showTitle: meta.showTitle,
        episodeLabel: meta.episodeLabel,
        position: msg.position,
      });
      return null;
    }

    case "lysto:toastAction": {
      const meta = await metaForTab(tabId, sender);
      if (!meta) return null;

      if (msg.kind === "add" && msg.action === "accept") {
        await addShowFromMeta(meta, await getTabState(tabId));
      }

      if (msg.kind === "add" && msg.action === "ignore") {
        const { ignored } = await getLocal();
        ignored[meta.showId] = { title: meta.showTitle, at: Date.now() };
        await setLocal({ ignored });
      }

      // On relaie le résultat à la frame vidéo (reprise, suivi activé…)
      sendToTab(tabId, {
        type: "lysto:toastResult",
        kind: msg.kind,
        action: msg.action,
        position: msg.position || null,
      });
      return null;
    }
  }
  return null;
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(() => sendResponse(null));
  return true; // réponse asynchrone
});

api.tabs.onRemoved.addListener((tabId) => { clearTabState(tabId); });
