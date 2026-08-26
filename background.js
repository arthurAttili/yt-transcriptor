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
  const toast = (msg, ok) => {
    const old = document.getElementById("yt-transcriptor-toast");
    if (old) old.remove();
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
      "background:" + (ok ? "#1e8e3e" : "#c0392b"),
      "transition:opacity .3s",
    ].join(";");
    document.documentElement.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 350);
    }, 2600);
  };

  try {
    if (!isWatch) {
      toast("Abra um vídeo do YouTube para copiar a transcrição.", false);
      return;
    }

    // Player response atual (sobrevive à navegação SPA); fallback para o inicial.
    let pr = null;
    try {
      pr = document.getElementById("movie_player")?.getPlayerResponse?.();
    } catch (e) {}
    if (!pr?.captions) pr = window.ytInitialPlayerResponse;

    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks || !tracks.length) {
      toast("Este vídeo não tem transcrição disponível.", false);
      return;
    }

    // Prefere legenda manual; senão, a automática (asr).
    const track = tracks.find((t) => t.kind !== "asr") || tracks[0];
    const url = new URL(track.baseUrl, location.origin);
    url.searchParams.set("fmt", "json3");

    const res = await fetch(url.toString(), { credentials: "same-origin" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    const lines = [];
    for (const ev of data.events || []) {
      if (!ev.segs) continue;
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
      toast("Este vídeo não tem transcrição disponível.", false);
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
      copied
    );
  } catch (e) {
    toast("Erro ao obter a transcrição deste vídeo.", false);
  }
}
