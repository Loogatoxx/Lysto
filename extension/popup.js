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

  async function save() {
    await api.storage.local.set({ shows: state.shows, ignored: state.ignored });
  }

  function card(show) {
    const ep = lastEpisodeOf(show);
    const [c1, c2] = posterColor(show.id);
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
    l.textContent = ep
      ? `${ep.label}${seen ? ` · ${seen} vu${seen > 1 ? "s" : ""}` : ""}`
      : "Aucun épisode enregistré";
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
      resume.textContent = ep.finished ? "▶ Revoir la page" : "▶ Reprendre";
      resume.addEventListener("click", () => {
        api.tabs.create({ url: ep.url });
        window.close();
      });
      actions.appendChild(resume);
    }

    const archive = document.createElement("button");
    archive.className = "btn btn-ghost";
    archive.textContent = show.archived ? "Reprendre le suivi" : "Terminée";
    archive.title = show.archived
      ? "Remettre dans les séries en cours"
      : "Marquer la série comme terminée";
    archive.addEventListener("click", async () => {
      show.archived = !show.archived;
      await save();
      render();
    });

    const del = document.createElement("button");
    del.className = "btn btn-ghost btn-danger";
    del.textContent = "✕";
    del.title = "Supprimer la série et son historique";
    del.addEventListener("click", async () => {
      if (!confirm(`Supprimer « ${show.title} » et tout son historique ?`)) return;
      delete state.shows[show.id];
      await save();
      render();
    });

    actions.append(archive, del);
    div.appendChild(actions);
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
      h.textContent = "En cours";
      $list.appendChild(h);
      current.forEach((s) => $list.appendChild(card(s)));
    }
    if (done.length) {
      const h = document.createElement("div");
      h.className = "section-title";
      h.textContent = "Terminées";
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
      : "Historique 100 % local — rien ne quitte ton navigateur.";
    $resetIgnored.hidden = !ni;
  }

  $search.addEventListener("input", render);

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
