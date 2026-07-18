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

function episodeRecord(existing, meta, position, duration) {
  const finished = duration > 0 && position / duration >= 0.95;
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

/* ------------------------------ messages ------------------------------ */
async function handleMessage(msg, sender) {
  const tabId = sender.tab ? sender.tab.id : null;
  if (tabId == null || !msg || typeof msg.type !== "string") return null;

  switch (msg.type) {
    case "lysto:meta": {
      const state = await getTabState(tabId);
      state.meta = msg.meta;
      await setTabState(tabId, state);
      return null;
    }

    case "lysto:videoFound": {
      const meta = await metaForTab(tabId, sender);
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
      const meta = await metaForTab(tabId, sender);
      if (!meta || !meta.showId || !meta.showTitle) return null;
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
      const meta = await metaForTab(tabId, sender);
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
        const state = await getTabState(tabId);
        if (state.lastProgress) {
          shows[meta.showId].episodes[meta.episodeKey] = episodeRecord(
            null, meta, state.lastProgress.position, state.lastProgress.duration
          );
          shows[meta.showId].lastEpisode = meta.episodeKey;
        }
        await setLocal({ shows, ignored });
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
