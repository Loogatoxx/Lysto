/*
 * Lysto — content.js
 * Injecté dans toutes les frames (les lecteurs vidéo sont souvent dans des iframes).
 *  - La frame principale (top) : analyse le titre de la page et affiche les toasts.
 *  - La frame qui contient la vidéo : suit la lecture et sauvegarde la position.
 * Les deux communiquent via le service worker (relay par tabId).
 */
(() => {
  "use strict";
  const api = typeof browser !== "undefined" && browser.runtime ? browser : chrome;
  if (!api || !api.runtime || !api.runtime.id) return;

  const IS_TOP = window === window.top;
  const MIN_DURATION = 120;      // secondes : réduit de 240→120 pour les animes (~22 min)
  const ASK_AFTER_PLAYED = 15;   // secondes réellement visionnées avant de proposer l'ajout (réduit de 20→15)
  const SAVE_INTERVAL = 5000;    // ms entre deux sauvegardes de position

  const send = (msg) => {
    try {
      return Promise.resolve(api.runtime.sendMessage(msg)).catch(() => null);
    } catch (_) {
      return Promise.resolve(null);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Frame principale : méta-données de la page + toasts                 */
  /* ------------------------------------------------------------------ */
  let toastHost = null;

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  }

  function removeToast() {
    if (toastHost) { toastHost.remove(); toastHost = null; }
  }

  function showToast({ kind, showTitle, episodeLabel, position }) {
    removeToast();
    toastHost = document.createElement("div");
    toastHost.style.cssText =
      "all:initial; position:fixed; z-index:2147483647; right:16px; bottom:16px;";
    const root = toastHost.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      .card{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        width:340px;box-sizing:border-box;background:#15151d;color:#f2f2f7;
        border:1px solid rgba(255,255,255,.09);border-radius:16px;
        box-shadow:0 12px 40px rgba(0,0,0,.55);padding:16px 18px;
        animation:lysto-in .32s cubic-bezier(.2,.9,.3,1.15)}
      @keyframes lysto-in{from{transform:translateY(18px) scale(.96);opacity:0}to{transform:none;opacity:1}}
      .head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
      .logo{width:22px;height:22px;border-radius:7px;flex:none;
        background:linear-gradient(160deg,#8b6cff,#5a3ef0);display:grid;place-items:center}
      .logo span{color:#fff;font-size:11px;transform:translateX(1px)}
      .brand{font-size:12px;font-weight:700;letter-spacing:.4px;color:#a99cff;flex:1}
      .close{cursor:pointer;border:none;background:none;color:#8e8e99;font-size:15px;
        padding:2px 6px;border-radius:6px;transition:all .15s}
      .close:hover{background:rgba(255,255,255,.08);color:#fff}
      .title{font-size:15px;font-weight:700;margin:0 0 3px;line-height:1.3}
      .sub{font-size:12.5px;color:#a0a0ab;margin:0 0 14px;line-height:1.45}
      .row{display:flex;gap:8px}
      button.btn{flex:1;cursor:pointer;border:none;border-radius:10px;padding:10px 12px;
        font-size:13px;font-weight:600;font-family:inherit;transition:all .15s}
      .primary{background:linear-gradient(160deg,#8b6cff,#5a3ef0);color:#fff}
      .primary:hover{filter:brightness(1.12);transform:translateY(-1px)}
      .ghost{background:rgba(255,255,255,.08);color:#c9c9d3}
      .ghost:hover{background:rgba(255,255,255,.14)}
      .dismiss{animation:lysto-out .22s ease-in forwards}
      @keyframes lysto-out{to{transform:translateY(18px);opacity:0}}`;
    root.appendChild(style);

    const card = document.createElement("div");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "head";
    const logo = document.createElement("div");
    logo.className = "logo";
    logo.innerHTML = "<span>▶</span>";
    const brand = document.createElement("div");
    brand.className = "brand";
    brand.textContent = "LYSTO";
    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "✕";
    close.addEventListener("click", () => {
      send({ type: "lysto:toastAction", kind, action: "dismiss" });
      card.classList.add("dismiss");
      setTimeout(removeToast, 250);
    });
    head.append(logo, brand, close);

    const title = document.createElement("p");
    title.className = "title";
    const sub = document.createElement("p");
    sub.className = "sub";
    const row = document.createElement("div");
    row.className = "row";

    const mkBtn = (label, cls, action, extra) => {
      const b = document.createElement("button");
      b.className = "btn " + cls;
      b.textContent = label;
      b.addEventListener("click", () => {
        send(Object.assign({ type: "lysto:toastAction", kind, action }, extra || {}));
        card.classList.add("dismiss");
        setTimeout(removeToast, 250);
      });
      return b;
    };

    if (kind === "add") {
      title.textContent = `Tu regardes « ${showTitle} » ?`;
      sub.textContent = episodeLabel
        ? `${episodeLabel} — je peux suivre cette série et retenir où tu en es.`
        : `Je peux suivre cette série et retenir où tu en es.`;
      row.append(
        mkBtn("✓ Suivre la série", "primary", "accept"),
        mkBtn("Ignorer", "ghost", "ignore")
      );
    } else if (kind === "resume") {
      title.textContent = `Reprendre « ${showTitle} » ?`;
      sub.textContent = episodeLabel
        ? `${episodeLabel} — tu t'étais arrêté à ${fmtTime(position)}.`
        : `Tu t'étais arrêté à ${fmtTime(position)}.`;
      row.append(
        mkBtn(`▶ Reprendre à ${fmtTime(position)}`, "primary", "accept", { position }),
        mkBtn("Depuis le début", "ghost", "restart")
      );
    }

    card.append(head, title, sub, row);
    root.appendChild(card);
    (document.body || document.documentElement).appendChild(toastHost);

    // Auto-dismiss après un délai
    setTimeout(() => {
      if (toastHost) {
        card.classList.add("dismiss");
        setTimeout(removeToast, 250);
      }
    }, kind === "add" ? 30000 : 20000);
  }

  let lastMetaSig = "";
  let metaSentCount = 0;

  function sendMeta() {
    if (!IS_TOP || typeof LystoParser === "undefined") return;
    // Plusieurs sources : titre d'onglet, og:title, h1/h2 (certains sites
    // n'affichent « Saison 1 Épisode 2 » que dans un heading), et l'option
    // sélectionnée des menus déroulants (anime-sama : <select> « Episode 5 »
    // qui change sans changer l'URL)
    const candidates = [document.title];
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) candidates.push(og.content);

    // og:description peut contenir des infos série
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc && ogDesc.content && ogDesc.content.length < 200) {
      candidates.push(ogDesc.content);
    }

    // Headings h1/h2/h3
    for (const h of document.querySelectorAll("h1, h2, h3")) {
      const txt = (h.textContent || "").trim();
      if (txt && txt.length < 140) candidates.push(txt);
      if (candidates.length > 12) break;
    }

    // Breadcrumbs (souvent contiennent le nom de la série)
    for (const bc of document.querySelectorAll('[class*="breadcrumb"] a, [class*="Breadcrumb"] a, nav[aria-label*="breadcrumb"] a')) {
      const txt = (bc.textContent || "").trim();
      if (txt && txt.length < 80 && txt.length > 2) candidates.push(txt);
      if (candidates.length > 16) break;
    }

    // Menus déroulants (anime-sama : <select> « Episode 5 »)
    for (const sel of document.querySelectorAll("select")) {
      const opt = sel.selectedOptions && sel.selectedOptions[0];
      const txt = opt ? (opt.text || "").trim() : "";
      if (txt && txt.length < 60 && /[éeÉE]p(?:isode)?\s*\.?\s*\d/i.test(txt)) {
        candidates.push(txt);
      }
      if (candidates.length > 18) break;
    }

    // Structured data (JSON-LD) — some sites embed episode info there
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent || "");
        const name = data.name || (data["@graph"] && data["@graph"][0] && data["@graph"][0].name);
        if (name && typeof name === "string" && name.length < 120) {
          candidates.push(name);
        }
        if (data.partOfSeason && data.partOfSeason.seasonNumber) {
          candidates.push("Saison " + data.partOfSeason.seasonNumber);
        }
        if (data.episodeNumber) {
          candidates.push("Episode " + data.episodeNumber);
        }
      } catch (_) { /* JSON invalide */ }
    }

    const meta = LystoParser.parseMediaMulti(candidates, location.href);
    const sig = JSON.stringify(meta);
    if (sig !== lastMetaSig || metaSentCount < 3) {
      lastMetaSig = sig;
      metaSentCount++;
      send({ type: "lysto:meta", meta, candidates: candidates.slice(0, 18) });
    }
  }

  if (IS_TOP) {
    // Envoyer les méta plusieurs fois au début pour s'assurer que le background les a
    sendMeta();
    setTimeout(sendMeta, 500);
    setTimeout(sendMeta, 2000);
    setTimeout(sendMeta, 5000);

    // Les sites de streaming changent souvent le titre après coup (SPA)
    try {
      new MutationObserver(() => {
        clearTimeout(sendMeta._t);
        sendMeta._t = setTimeout(sendMeta, 400);
      }).observe(document.head || document.documentElement, {
        subtree: true, childList: true, characterData: true,
      });
    } catch (_) { /* head absent */ }
    // Changement d'épisode via un <select> (SPA, l'URL ne change pas)
    document.addEventListener("change", () => setTimeout(sendMeta, 150), true);
    // Observer aussi les changements de body (pour les SPA qui chargent le contenu en AJAX)
    try {
      new MutationObserver(() => {
        clearTimeout(sendMeta._bodyT);
        sendMeta._bodyT = setTimeout(sendMeta, 800);
      }).observe(document.body || document.documentElement, {
        subtree: true, childList: true,
      });
    } catch (_) { /* body absent */ }
    setInterval(sendMeta, 4000);
  }

  /* ------------------------------------------------------------------ */
  /* Toutes les frames : détection de la vidéo + suivi de lecture        */
  /* ------------------------------------------------------------------ */
  let adopted = null; // { video, tracked, ignored, askSent, played, lastT }

  function sendProgress(reason) {
    if (!adopted) return;
    const v = adopted.video;
    if (!v.duration || !isFinite(v.duration) || v.currentTime <= 0) return;
    send({
      type: "lysto:progress",
      position: v.currentTime,
      duration: v.duration,
      reason: reason || "tick",
    });
  }

  function adopt(video) {
    adopted = { video, tracked: false, ignored: false, askSent: false, played: 0, lastT: null };

    send({ type: "lysto:videoFound", duration: video.duration }).then((res) => {
      if (!res || !adopted || adopted.video !== video) return;
      adopted.tracked = !!res.tracked;
      adopted.ignored = !!res.ignored;
      if (
        res.resume &&
        res.resume.position > 30 &&
        res.resume.position < video.duration * 0.96 &&
        Math.abs(video.currentTime - res.resume.position) > 15
      ) {
        send({ type: "lysto:requestToast", kind: "resume", position: res.resume.position });
      }
    });

    video.addEventListener("timeupdate", () => {
      if (!adopted || adopted.video !== video) return;
      const t = video.currentTime;
      if (adopted.lastT != null && !video.paused) {
        const d = t - adopted.lastT;
        if (d > 0 && d < 3) adopted.played += d; // saute les seeks
      }
      adopted.lastT = t;
    });
    video.addEventListener("pause", () => sendProgress("pause"));
    video.addEventListener("ended", () => sendProgress("ended"));
  }

  // Certains lecteurs cachent la balise <video> dans un shadow DOM
  function findVideos() {
    const found = [...document.querySelectorAll("video")];
    const walk = (root, depth) => {
      if (depth > 5) return;
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          found.push(...el.shadowRoot.querySelectorAll("video"));
          walk(el.shadowRoot, depth + 1);
        }
      }
    };
    if (!found.length) {
      try { walk(document, 0); } catch (_) { /* page hostile */ }
    }
    return found;
  }

  // Quand aucune vidéo longue n'est trouvée, on surveille les nouvelles vidéos
  let videoObserver = null;
  function startVideoObserver() {
    if (videoObserver) return;
    try {
      videoObserver = new MutationObserver(() => {
        if (!adopted) scanVideos();
      });
      videoObserver.observe(document.body || document.documentElement, {
        subtree: true, childList: true,
      });
    } catch (_) { /* body absent */ }
  }

  function scanVideos() {
    if (adopted && adopted.video.isConnected) return;
    adopted = null;
    for (const v of findVideos()) {
      // Accepter les vidéos dont la durée est connue et >= MIN_DURATION
      if (v.duration && isFinite(v.duration) && v.duration >= MIN_DURATION) {
        adopt(v);
        return;
      }
      // Si la durée n'est pas encore connue (lazy load), on attend
      if (!v.duration || !isFinite(v.duration)) {
        const onMeta = () => {
          v.removeEventListener("loadedmetadata", onMeta);
          v.removeEventListener("durationchange", onMeta);
          if (!adopted && v.duration && isFinite(v.duration) && v.duration >= MIN_DURATION) {
            adopt(v);
          }
        };
        v.addEventListener("loadedmetadata", onMeta, { once: false });
        v.addEventListener("durationchange", onMeta, { once: false });
      }
    }
  }

  // Scan initial + observer
  scanVideos();
  startVideoObserver();

  setInterval(() => {
    // La vidéo peut être retirée du DOM par le lecteur → on ré-adopte
    if (adopted && !adopted.video.isConnected) adopted = null;
    if (!adopted) {
      scanVideos();
    }
    if (adopted) {
      const v = adopted.video;
      if (!v.paused && !v.ended) sendProgress("tick");
      if (!adopted.askSent && !adopted.tracked && !adopted.ignored &&
          adopted.played >= ASK_AFTER_PLAYED) {
        adopted.askSent = true;
        send({ type: "lysto:suggestAdd" });
      }
    }
  }, Math.min(SAVE_INTERVAL, 2000));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sendProgress("hidden");
  });
  window.addEventListener("pagehide", () => sendProgress("pagehide"));

  /* ------------------------------------------------------------------ */
  /* Messages venant du service worker                                   */
  /* ------------------------------------------------------------------ */
  api.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "lysto:toast" && IS_TOP) {
      showToast(msg);
    }

    if (msg.type === "lysto:toastResult" && adopted) {
      const v = adopted.video;
      if (msg.kind === "resume" && msg.action === "accept" && msg.position) {
        const seek = () => { try { v.currentTime = msg.position; } catch (_) {} };
        if (v.readyState >= 1) seek();
        else v.addEventListener("loadedmetadata", seek, { once: true });
      }
      if (msg.kind === "add" && msg.action === "accept") {
        adopted.tracked = true;
        sendProgress("added");
      }
      if (msg.kind === "add" && msg.action === "ignore") {
        adopted.ignored = true;
      }
    }
  });
})();
