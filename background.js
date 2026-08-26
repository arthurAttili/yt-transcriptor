// Um clique no ícone → injeta o coletor na página ativa e copia a transcrição.
// Roda no MAIN world para ter acesso ao player do YouTube (movie_player /
// ytInitialPlayerResponse), que não é visível em content scripts isolados.

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  const isWatch =
    !!tab.url &&
    /^https?:\/\/(www\.|m\.)?youtube\.com\/(watch|shorts\/|live\/)/.test(tab.url);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: copyTranscript,
      args: [isWatch],
    });
  } catch (e) {
    // Página onde não dá para injetar (chrome://, Web Store etc.)
    await chrome.action.setBadgeBackgroundColor({ color: "#c0392b", tabId: tab.id });
    await chrome.action.setBadgeText({ text: "✕", tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 2500);
  }
});

// Executada dentro da página do YouTube.
async function copyTranscript(isWatch) {
  const toast = (msg, kind) => {
    const old = document.getElementById("yt-transcriptor-toast");
    if (old) old.remove();
    const colors = { ok: "#1e8e3e", err: "#c0392b", info: "#333" };
    const el = document.createElement("div");
    el.id = "yt-transcriptor-toast";
    el.textContent = msg;
    el.style.cssText = [
      "position:fixed",
      "top:20px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:2147483647",
      "padding:10px 18px",
      "border-radius:8px",
      "font:500 14px/1.4 Roboto,Arial,sans-serif",
      "color:#fff",
      "box-shadow:0 4px 16px rgba(0,0,0,.35)",
      "background:" + (colors[kind] || colors.info),
      "transition:opacity .3s",
    ].join(";");
    document.documentElement.appendChild(el);
    if (kind !== "info") {
      setTimeout(() => {
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 350);
      }, 2600);
    }
  };

  const fetchJson3 = async (rawUrl) => {
    const u = new URL(rawUrl, location.origin);
    u.searchParams.set("fmt", "json3");
    const res = await fetch(u.toString(), { credentials: "same-origin" });
    if (!res.ok) return null;
    const body = await res.text();
    // O endpoint timedtext responde 200 com corpo vazio quando falta o token
    // de origem (pot) — tratar como falha, não como "sem transcrição".
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch (e) {
      return null;
    }
  };

  // Espera o próprio player requisitar /api/timedtext (a URL dele vem com o
  // token pot). buffered=true reaproveita uma requisição já feita na sessão.
  const captureTimedtextUrl = (videoId, buffered, timeoutMs) =>
    new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        obs.disconnect();
        resolve(v);
      };
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (
            e.name.includes("/api/timedtext") &&
            e.name.includes("pot=") &&
            e.name.includes(videoId)
          ) {
            finish(e.name);
            return;
          }
        }
      });
      obs.observe({ type: "resource", buffered });
      setTimeout(() => finish(null), timeoutMs);
    });

  try {
    if (!isWatch) {
      toast("Abra um vídeo do YouTube para copiar a transcrição.", "err");
      return;
    }

    // Player response atual (sobrevive à navegação SPA); fallback para o inicial.
    const player = document.getElementById("movie_player");
    let pr = null;
    try {
      pr = player?.getPlayerResponse?.();
    } catch (e) {}
    if (!pr?.captions) pr = window.ytInitialPlayerResponse;

    const videoId = pr?.videoDetails?.videoId || "";
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks || !tracks.length) {
      toast("Este vídeo não tem transcrição disponível.", "err");
      return;
    }

    toast("Obtendo transcrição…", "info");

    // 1) Tentativa direta: baseUrl da faixa (prefere legenda manual à asr).
    const track = tracks.find((t) => t.kind !== "asr") || tracks[0];
    let data = await fetchJson3(track.baseUrl);

    // 2) O player já buscou a legenda nesta sessão? Reusa a URL com pot.
    if (!data) {
      const cached = await captureTimedtextUrl(videoId, true, 400);
      if (cached) data = await fetchJson3(cached);
    }

    // 3) Força o player a buscar a legenda (liga/desliga CC, estado do
    //    usuário volta ao que era) e captura a URL com pot dessa requisição.
    if (!data && player?.toggleSubtitles) {
      const urlPromise = captureTimedtextUrl(videoId, false, 6000);
      player.toggleSubtitles();
      setTimeout(() => player.toggleSubtitles(), 300);
      const fresh = await urlPromise;
      if (fresh) data = await fetchJson3(fresh);
    }

    if (!data) {
      toast("Erro ao obter a transcrição deste vídeo.", "err");
      return;
    }

    const lines = [];
    for (const ev of data.events || []) {
      if (!ev.segs || ev.aAppend) continue;
      const text = ev.segs
        .map((s) => s.utf8 || "")
        .join("")
        .replace(/\n/g, " ")
        .trim();
      if (!text) continue;
      const total = Math.floor((ev.tStartMs || 0) / 1000);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      const stamp =
        (h ? h + ":" + String(m).padStart(2, "0") : String(m)) +
        ":" +
        String(s).padStart(2, "0");
      lines.push(stamp + " " + text);
    }

    if (!lines.length) {
      toast("Este vídeo não tem transcrição disponível.", "err");
      return;
    }

    const title = pr?.videoDetails?.title;
    const out = (title ? title + "\n\n" : "") + lines.join("\n");

    let copied = false;
    try {
      await navigator.clipboard.writeText(out);
      copied = true;
    } catch (e) {
      // Sem permissão/foco: fallback via execCommand.
      const ta = document.createElement("textarea");
      ta.value = out;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      copied = document.execCommand("copy");
      ta.remove();
    }

    toast(
      copied
        ? "Transcrição copiada!"
        : "Não consegui acessar a área de transferência.",
      copied ? "ok" : "err"
    );
  } catch (e) {
    toast("Erro ao obter a transcrição deste vídeo.", "err");
  }
}
