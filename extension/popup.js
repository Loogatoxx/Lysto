/* Lysto — popup.js : liste des séries suivies, reprise, gestion. */
(() => {
  "use strict";
  const api = typeof browser !== "undefined" && browser.runtime ? browser : chrome;

  const $list = document.getElementById("list");
  const $empty = document.getElementById("empty");
  const $count = document.getElementById("count");
  const $search = document.getElementById("search");
  const $ignoredInfo = document.getElementById("ignored-info");
  const $resetIgnored = document.getElementById("reset-ignored");

  const POSTER_COLORS = [
    ["#8b6cff", "#5a3ef0"], ["#ff6c9c", "#f03e6e"], ["#6cc7ff", "#3e7ef0"],
    ["#ffc46c", "#f0873e"], ["#6cffb8", "#3ecf8e"], ["#c76cff", "#8e3ef0"],
    ["#ff9c6c", "#f05e3e"], ["#6cffd4", "#3e9fcf"],
  ];

  let state = { shows: {}, ignored: {} };

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  }

  function fmtWhen(ts) {
    if (!ts) return "";
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 90) return "à l'instant";
    if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
    if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
    if (d < 86400 * 30) return `il y a ${Math.floor(d / 86400)} j`;
    return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  function initials(title) {
    return title.split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();
  }

  function posterColor(id) {
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return POSTER_COLORS[h % POSTER_COLORS.length];
  }

  function lastEpisodeOf(show) {
    if (show.lastEpisode && show.episodes && show.episodes[show.lastEpisode]) {
      return show.episodes[show.lastEpisode];
    }
    const eps = Object.values(show.episodes || {});
    eps.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return eps[0] || null;
  }

  function episodeCount(show) {
    return Object.keys(show.episodes || {}).length;
  }

  async function save() {
    await api.storage.local.set({ shows: state.shows, ignored: state.ignored });
  }

  function card(show) {
    const ep = lastEpisodeOf(show);
    const [c1, c2] = posterColor(show.id);
    const totalEps = episodeCount(show);
    const div = document.createElement("div");
    div.className = "card";

    const top = document.createElement("div");
    top.className = "card-top";

    const poster = document.createElement("div");
    poster.className = "poster";
    poster.style.background = `linear-gradient(160deg, ${c1}, ${c2})`;
    poster.textContent = initials(show.title);

    const info = document.createElement("div");
    info.className = "card-info";
    const t = document.createElement("div");
    t.className = "show-title";
    t.textContent = show.title;
    t.title = show.title;
    const l = document.createElement("div");
    l.className = "ep-label";
    const seen = Object.values(show.episodes || {}).filter((e) => e.finished).length;
    const parts = [];
    if (ep) parts.push(ep.label);
    if (seen) parts.push(`${seen} vu${seen > 1 ? "s" : ""}`);
    if (totalEps > 1) parts.push(`${totalEps} épisodes`);
    l.textContent = parts.length ? parts.join(" · ") : "Aucun épisode enregistré";
    info.append(t, l);

    const when = document.createElement("div");
    when.className = "when";
    when.textContent = fmtWhen(show.lastWatchedAt);

    top.append(poster, info, when);
    div.appendChild(top);

    if (ep && ep.duration > 0) {
      const row = document.createElement("div");
      row.className = "progress-row";
      const bar = document.createElement("div");
      bar.className = "bar" + (ep.finished ? " done" : "");
      const fill = document.createElement("div");
      fill.style.width = Math.min(100, Math.round((ep.position / ep.duration) * 100)) + "%";
      bar.appendChild(fill);
      const time = document.createElement("div");
      time.className = "time";
      time.textContent = ep.finished
        ? "Épisode terminé ✓"
        : `${fmtTime(ep.position)} / ${fmtTime(ep.duration)}`;
      row.append(bar, time);
      div.appendChild(row);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    if (ep && ep.url) {
      const resume = document.createElement("button");
      resume.className = "btn btn-primary";
      resume.textContent = ep.finished ? "▶ Revoir" : "▶ Reprendre";
      resume.addEventListener("click", () => {
        api.tabs.create({ url: ep.url });
        window.close();
      });
      actions.appendChild(resume);
    }

    const archive = document.createElement("button");
    archive.className = "btn btn-ghost";
    archive.textContent = show.archived ? "↩ Reprendre" : "✓ Terminée";
    archive.title = show.archived
      ? "Remettre dans les séries en cours"
      : "Marquer la série comme terminée";
    archive.addEventListener("click", async () => {
      show.archived = !show.archived;
      await save();
      render();
    });

    // confirm() est peu fiable dans un popup d'extension → confirmation inline
    const del = document.createElement("button");
    del.className = "btn btn-ghost btn-danger";
    del.textContent = "✕";
    del.title = "Supprimer la série et son historique";
    del.addEventListener("click", async () => {
      if (del.dataset.armed) {
        delete state.shows[show.id];
        await save();
        render();
        return;
      }
      del.dataset.armed = "1";
      del.textContent = "Sûr ?";
      del.style.color = "#ff7b7b";
      setTimeout(() => {
        delete del.dataset.armed;
        del.textContent = "✕";
        del.style.color = "";
      }, 3000);
    });

    actions.append(archive, del);
    div.appendChild(actions);

    // Clic sur l'en-tête de la carte → liste des épisodes vus
    top.style.cursor = "pointer";
    top.addEventListener("click", () => {
      const existing = div.querySelector(".episodes");
      if (existing) { existing.remove(); return; }
      const eps = Object.entries(show.episodes || {})
        .map(([key, e]) => ({ key, ...e }))
        .sort((a, b) => {
          // Tri par saison décroissante puis épisode décroissant
          const sDiff = (a.season || 0) - (b.season || 0);
          if (sDiff !== 0) return sDiff;
          const eDiff = (a.episode || 0) - (b.episode || 0);
          if (eDiff !== 0) return eDiff;
          return (a.updatedAt || 0) - (b.updatedAt || 0);
        });
      if (!eps.length) return;
      const box = document.createElement("div");
      box.className = "episodes";
      for (const e of eps) {
        const row = document.createElement("a");
        row.className = "ep-row";
        row.href = e.url || "#";
        row.addEventListener("click", (ev) => {
          ev.preventDefault();
          if (e.url) { api.tabs.create({ url: e.url }); window.close(); }
        });
        const name = document.createElement("span");
        name.className = "ep-name";
        name.textContent = e.label || e.key;
        const time = document.createElement("span");
        time.className = "ep-time";
        time.textContent = e.duration ? `${fmtTime(e.position)} / ${fmtTime(e.duration)}` : "";
        row.append(name, time);
        if (e.finished) {
          const done = document.createElement("span");
          done.className = "ep-done";
          done.textContent = "✓";
          row.appendChild(done);
        }
        box.appendChild(row);
      }
      div.appendChild(box);
    });

    return div;
  }

  function render() {
    const q = $search.value.trim().toLowerCase();
    const all = Object.values(state.shows).filter(
      (s) => !q || s.title.toLowerCase().includes(q)
    );
    all.sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0));

    const current = all.filter((s) => !s.archived);
    const done = all.filter((s) => s.archived);

    $list.textContent = "";
    $empty.hidden = all.length > 0 || !!q;

    if (current.length) {
      const h = document.createElement("div");
      h.className = "section-title";
      h.textContent = `En cours (${current.length})`;
      $list.appendChild(h);
      current.forEach((s) => $list.appendChild(card(s)));
    }
    if (done.length) {
      const h = document.createElement("div");
      h.className = "section-title";
      h.textContent = `Terminées (${done.length})`;
      $list.appendChild(h);
      done.forEach((s) => $list.appendChild(card(s)));
    }
    if (q && !all.length) {
      const p = document.createElement("p");
      p.className = "empty-sub";
      p.style.padding = "16px";
      p.style.textAlign = "center";
      p.textContent = "Aucune série ne correspond à ta recherche.";
      $list.appendChild(p);
    }

    const n = Object.keys(state.shows).length;
    $count.textContent = n ? `${n} série${n > 1 ? "s" : ""}` : "";

    const ni = Object.keys(state.ignored).length;
    $ignoredInfo.textContent = ni
      ? `${ni} série${ni > 1 ? "s" : ""} ignorée${ni > 1 ? "s" : ""}`
      : "100 % local · rien ne quitte ton navigateur";
    $resetIgnored.hidden = !ni;
  }

  $search.addEventListener("input", render);

  // Secours si la détection automatique n'a pas proposé la série :
  // formulaire pré-rempli avec ce que Lysto a reconnu, corrigeable à la main
  const $addCurrent = document.getElementById("add-current");
  const $addPanel = document.getElementById("add-panel");
  const $addTitle = document.getElementById("add-title");
  const $addSeason = document.getElementById("add-season");
  const $addEpisode = document.getElementById("add-episode");
  let addTabId = null;

  $addCurrent.addEventListener("click", async () => {
    if (!$addPanel.hidden) { $addPanel.hidden = true; return; }
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    addTabId = tab.id;
    const meta = await api.runtime
      .sendMessage({ type: "lysto:getMeta", tabId: tab.id })
      .catch(() => null);
    $addTitle.value = (meta && meta.showTitle) || "";
    $addSeason.value = meta && meta.season != null ? meta.season : "";
    $addEpisode.value = meta && meta.episode != null ? meta.episode : "";
    $addPanel.hidden = false;
    $addTitle.focus();
    $addTitle.select();
  });

  document.getElementById("add-cancel").addEventListener("click", () => {
    $addPanel.hidden = true;
  });

  document.getElementById("add-confirm").addEventListener("click", async () => {
    if (addTabId == null || !$addTitle.value.trim()) {
      $addTitle.style.borderColor = "rgba(255, 80, 80, 0.6)";
      $addTitle.focus();
      setTimeout(() => { $addTitle.style.borderColor = ""; }, 2000);
      return;
    }
    const override = {
      title: $addTitle.value.trim(),
      season: $addSeason.value !== "" ? parseInt($addSeason.value, 10) : null,
      episode: $addEpisode.value !== "" ? parseInt($addEpisode.value, 10) : null,
    };
    const res = await api.runtime
      .sendMessage({ type: "lysto:manualAdd", tabId: addTabId, override })
      .catch(() => null);
    $addPanel.hidden = true;
    $addCurrent.classList.remove("ok", "err");
    $addCurrent.classList.add(res && res.ok ? "ok" : "err");
    $addCurrent.textContent = res && res.ok ? "✓" : "?";
    setTimeout(() => {
      $addCurrent.classList.remove("ok", "err");
      $addCurrent.textContent = "＋";
    }, 2500);
  });

  // Raccourci : Enter dans le formulaire d'ajout
  $addTitle.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("add-confirm").click();
  });
  $addSeason.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("add-confirm").click();
  });
  $addEpisode.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("add-confirm").click();
  });

  // Réglages : clé API pour l'assistance IA (stockée en local uniquement)
  const $settingsPanel = document.getElementById("settings-panel");
  const $aiKey = document.getElementById("ai-key");
  const $aiStatus = document.getElementById("ai-status");

  document.getElementById("settings-toggle").addEventListener("click", async () => {
    if (!$settingsPanel.hidden) { $settingsPanel.hidden = true; return; }
    const { settings } = await api.storage.local.get("settings");
    $aiKey.value = (settings && settings.aiKey) || "";
    $aiStatus.textContent = "";
    $settingsPanel.hidden = false;
  });

  document.getElementById("ai-save").addEventListener("click", async () => {
    const { settings } = await api.storage.local.get("settings");
    await api.storage.local.set({
      settings: Object.assign({}, settings, { aiKey: $aiKey.value.trim() }),
    });
    $aiStatus.textContent = $aiKey.value.trim() ? "✓ Enregistré" : "IA désactivée";
    $aiStatus.style.color = $aiKey.value.trim() ? "#3ecf8e" : "";
    setTimeout(() => {
      $settingsPanel.hidden = true;
      $aiStatus.style.color = "";
    }, 1200);
  });

  $resetIgnored.addEventListener("click", async () => {
    state.ignored = {};
    await save();
    render();
  });

  // Rafraîchit en direct si un épisode est en cours de lecture dans un autre onglet
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.shows) state.shows = changes.shows.newValue || {};
    if (changes.ignored) state.ignored = changes.ignored.newValue || {};
    render();
  });

  (async () => {
    const data = await api.storage.local.get(["shows", "ignored"]);
    state.shows = data.shows || {};
    state.ignored = data.ignored || {};
    render();
  })();
})();
