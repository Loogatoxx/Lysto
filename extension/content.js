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
  const MIN_DURATION = 240;      // secondes : en dessous, c'est une pub / un extrait
  const ASK_AFTER_PLAYED = 20;   // secondes réellement visionnées avant de proposer l'ajout
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
        width:330px;box-sizing:border-box;background:#15151d;color:#f2f2f7;
        border:1px solid rgba(255,255,255,.09);border-radius:16px;
        box-shadow:0 12px 40px rgba(0,0,0,.45);padding:14px 16px;
        animation:lysto-in .28s cubic-bezier(.2,.9,.3,1.2)}
      @keyframes lysto-in{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}
      .head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
      .logo{width:20px;height:20px;border-radius:6px;flex:none;
        background:linear-gradient(160deg,#8b6cff,#5a3ef0);display:grid;place-items:center}
      .logo span{color:#fff;font-size:10px;transform:translateX(1px)}
      .brand{font-size:12px;font-weight:700;letter-spacing:.4px;color:#a99cff;flex:1}
      .close{cursor:pointer;border:none;background:none;color:#8e8e99;font-size:15px;
        padding:2px 6px;border-radius:6px}
      .close:hover{background:rgba(255,255,255,.08);color:#fff}
      .title{font-size:14.5px;font-weight:700;margin:0 0 2px;line-height:1.3}
      .sub{font-size:12.5px;color:#a0a0ab;margin:0 0 12px}
      .row{display:flex;gap:8px}
      button.btn{flex:1;cursor:pointer;border:none;border-radius:10px;padding:9px 10px;
        font-size:13px;font-weight:600;font-family:inherit;transition:filter .15s}
      .primary{background:linear-gradient(160deg,#8b6cff,#5a3ef0);color:#fff}
      .primary:hover{filter:brightness(1.12)}
      .ghost{background:rgba(255,255,255,.08);color:#c9c9d3}
      .ghost:hover{background:rgba(255,255,255,.14)}`;
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
      removeToast();
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
        removeToast();
      });
      return b;
    };

    if (kind === "add") {
      title.textContent = `Tu regardes « ${showTitle} » ?`;
      sub.textContent = `${episodeLabel} — je peux suivre cette série et retenir où tu en es.`;
      row.append(
        mkBtn("Suivre la série", "primary", "accept"),
        mkBtn("Ignorer", "ghost", "ignore")
      );
    } else if (kind === "resume") {
      title.textContent = `Reprendre « ${showTitle} » ?`;
      sub.textContent = `${episodeLabel} — tu t'étais arrêté à ${fmtTime(position)}.`;
      row.append(
        mkBtn(`Reprendre à ${fmtTime(position)}`, "primary", "accept", { position }),
        mkBtn("Depuis le début", "ghost", "restart")
      );
    }

    card.append(head, title, sub, row);
    root.appendChild(card);
    (document.body || document.documentElement).appendChild(toastHost);

    setTimeout(removeToast, kind === "add" ? 25000 : 18000);
  }

  let lastMetaSig = "";
  function sendMeta() {
    if (!IS_TOP || typeof LystoParser === "undefined") return;
    const meta = LystoParser.parseMedia(document.title, location.href);
    const sig = JSON.stringify(meta);
    if (sig !== lastMetaSig) {
      lastMetaSig = sig;
      send({ type: "lysto:meta", meta });
    }
  }

  if (IS_TOP) {
    sendMeta();
    // Les sites de streaming changent souvent le titre après coup (SPA)
    try {
      new MutationObserver(() => {
        clearTimeout(sendMeta._t);
        sendMeta._t = setTimeout(sendMeta, 400);
      }).observe(document.head || document.documentElement, {
        subtree: true, childList: true, characterData: true,
      });
    } catch (_) { /* head absent */ }
    setInterval(sendMeta, 3000);
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
        res.resume.position > 45 &&
        res.resume.position < video.duration * 0.96 &&
        Math.abs(video.currentTime - res.resume.position) > 20
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

  setInterval(() => {
    // La vidéo peut être retirée du DOM par le lecteur → on ré-adopte
    if (adopted && !document.contains(adopted.video)) adopted = null;
    if (!adopted) {
      for (const v of document.querySelectorAll("video")) {
        if (v.duration && isFinite(v.duration) && v.duration >= MIN_DURATION) {
          adopt(v);
          break;
        }
      }
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
