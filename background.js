// Clique no ícone → injeta o coletor na página ativa e copia a transcrição.
// Mensagem "summarize" do content script → coleta a transcrição, chama o
// Gemini e devolve o resumo para o painel na página.
// O coletor roda no MAIN world para ter acesso ao player do YouTube
// (movie_player / ytInitialPlayerResponse), invisível em worlds isolados.

const GEMINI_MODEL = "gemini-3.1-pro-preview";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  GEMINI_MODEL +
  ":generateContent";

// Instrução do resumo (otimizada a partir da instrução original do Arthur).
const SUMMARY_SYSTEM_PROMPT = `Você é um assistente de resumos de vídeos do YouTube. Você receberá o título e a transcrição (com timestamps) de um vídeo e deve produzir um resumo crítico em português do Brasil, exatamente neste formato Markdown:

# {título do vídeo}

## Resumo
Síntese fiel do conteúdo em 2 a 4 parágrafos, cobrindo a tese central e a linha de argumentação do vídeo.

## Pontos principais
- 5 a 8 bullets com as ideias centrais, citando o timestamp aproximado de cada uma (ex.: "(12:40)").

## Análise crítica
Comentários seus sobre o conteúdo, para desenvolvimento de pensamento crítico sobre o tema.

### Prós
- Pontos fortes: argumentos bem fundamentados, dados apresentados, qualidade da didática, honestidade intelectual.

### Contras
- Fragilidades: afirmações sem evidência, vieses, exageros, omissões relevantes, conflitos de interesse aparentes.

## Perguntas para reflexão
- 2 ou 3 perguntas que estimulem o espectador a pensar criticamente sobre o tema além do vídeo.

Regras:
- O título (H1) deve ser sempre o nome do vídeo, sem alterações.
- Baseie-se apenas na transcrição; não invente fatos nem atribua ao vídeo o que não foi dito.
- Se a transcrição estiver em outro idioma, produza o resumo em português mesmo assim.
- Seja específico na análise crítica: aponte trechos e argumentos concretos, não generalidades.
- Transcrições automáticas contêm erros de reconhecimento de voz; interprete com bom senso.`;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: runTranscript,
      args: [isWatchUrl(tab.url), "copy"],
    });
  } catch (e) {
    // Página onde não dá para injetar (chrome://, Web Store etc.)
    await chrome.action.setBadgeBackgroundColor({ color: "#c0392b", tabId: tab.id });
    await chrome.action.setBadgeText({ text: "✕", tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 2500);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "summarize" && sender.tab?.id) {
    summarize(sender.tab).then(sendResponse);
    return true; // resposta assíncrona
  }
  if (msg?.type === "open-options") {
    chrome.runtime.openOptionsPage();
  }
});

function isWatchUrl(url) {
  return (
    !!url &&
    /^https?:\/\/(www\.|m\.)?youtube\.com\/(watch|shorts\/|live\/)/.test(url)
  );
}

async function summarize(tab) {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) return { error: "no-key" };

  let collected;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: runTranscript,
      args: [isWatchUrl(tab.url), "collect"],
    });
    collected = result;
  } catch (e) {
    return { error: "inject", detail: String(e) };
  }

  if (!collected?.ok) return { error: collected?.reason || "transcript" };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SUMMARY_SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  "Título do vídeo: " +
                  collected.title +
                  "\n\nTranscrição:\n" +
                  collected.text.slice(0, 800000),
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.4 },
      }),
    });
    clearTimeout(timer);

    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || "HTTP " + res.status;
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { error: "bad-key", detail: msg };
      }
      return { error: "api", detail: msg };
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join("");
    if (!text) {
      const reason =
        data?.candidates?.[0]?.finishReason ||
        data?.promptFeedback?.blockReason ||
        "resposta vazia";
      return { error: "api", detail: String(reason) };
    }
    return { summary: text, title: collected.title };
  } catch (e) {
    return {
      error: "api",
      detail: e?.name === "AbortError" ? "tempo esgotado (180s)" : String(e),
    };
  }
}

// Executada dentro da página do YouTube (MAIN world).
// mode "copy": copia para a área de transferência e mostra toasts.
// mode "collect": devolve { ok, title, text } sem tocar na UI.
async function runTranscript(isWatch, mode) {
  const silent = mode === "collect";
  const toast = (msg, kind) => {
    if (silent) return;
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
      return { ok: false, reason: "not-watch" };
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
      return { ok: false, reason: "no-transcript" };
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
      return { ok: false, reason: "fetch-failed" };
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
      return { ok: false, reason: "no-transcript" };
    }

    const title = pr?.videoDetails?.title || document.title;
    const body = lines.join("\n");

    if (silent) return { ok: true, title, text: body };

    const out = (title ? title + "\n\n" : "") + body;
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
    return { ok: copied, reason: copied ? "" : "clipboard" };
  } catch (e) {
    toast("Erro ao obter a transcrição deste vídeo.", "err");
    return { ok: false, reason: "error", detail: String(e) };
  }
}
