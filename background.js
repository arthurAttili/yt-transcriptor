// Popup do ícone → copia a transcrição na abertura e oferece resumo,
// comparação entre dois vídeos e edição da instrução do resumo.
// Mensagens do content script / popup → coleta transcrições, chama o Gemini
// e devolve o texto para o painel na página.
// O coletor roda no MAIN world para ter acesso ao player do YouTube
// (movie_player / ytInitialPlayerResponse), invisível em worlds isolados.

const GEMINI_MODEL = "gemini-3.7-flash";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  GEMINI_MODEL +
  ":generateContent";

// Instrução padrão do resumo (otimizada a partir da instrução original do
// Arthur). O usuário pode substituí-la pelo popup; fica em storage.local.
const DEFAULT_SUMMARY_PROMPT = `Você é um assistente de resumos de vídeos do YouTube. Você receberá o título e a transcrição (com timestamps) de um vídeo e deve produzir um resumo crítico em português do Brasil, exatamente neste formato Markdown:

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

// Acrescentada à instrução do usuário quando dois vídeos são analisados juntos.
const COMPARE_ADDENDUM = `

--- ANÁLISE CONJUNTA DE DOIS VÍDEOS ---
Desta vez você recebe as transcrições de DOIS vídeos e deve analisá-los em conjunto. Ignore o formato de vídeo único descrito acima e use este:

# {título do vídeo 1} × {título do vídeo 2}

## O que cada um defende
Um parágrafo por vídeo, com a tese central de cada um.

## Onde concordam
- Pontos em que os dois chegam à mesma conclusão, ainda que por caminhos diferentes.

## Onde divergem
- Divergências reais de tese, dado ou método. Diga qual vídeo sustenta melhor cada ponto e por quê.

## O que um tem e o outro não
- Argumentos, dados ou recortes exclusivos de cada lado.

## Análise crítica
Sua avaliação dos dois: qual é mais bem fundamentado, onde cada um falha, que vieses aparecem.

## Perguntas para reflexão
- 2 ou 3 perguntas que surgem do confronto entre os dois vídeos.

Mantenha o tom e as regras da instrução acima. Identifique os vídeos pelo título, nunca por "vídeo 1" e "vídeo 2" no corpo do texto.`;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = msg?.tabId || sender.tab?.id;

  if (msg?.type === "summarize" && tabId) {
    summarize(tabId).then(sendResponse);
    return true; // resposta assíncrona
  }
  if (msg?.type === "compare" && tabId) {
    compare(tabId, msg.otherUrl).then(sendResponse);
    return true;
  }
  if (msg?.type === "copy-transcript" && tabId) {
    copyTranscript(tabId).then(sendResponse);
    return true;
  }
  if (msg?.type === "get-default-prompt") {
    sendResponse({ prompt: DEFAULT_SUMMARY_PROMPT });
    return;
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

async function getSummaryPrompt() {
  const { summaryPrompt } = await chrome.storage.local.get("summaryPrompt");
  return summaryPrompt?.trim() ? summaryPrompt : DEFAULT_SUMMARY_PROMPT;
}

// Roda o coletor numa aba e devolve { ok, title, text } ou { ok:false, reason }.
async function collectFrom(tabId, url) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: runTranscript,
    args: [isWatchUrl(url), "collect"],
  });
  return result;
}

// Devolve o texto pronto para o popup copiar. A gravação na área de
// transferência acontece no popup: com ele aberto a página perde o foco, e
// tanto a Clipboard API quanto execCommand exigem documento focado.
async function copyTranscript(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const result = await collectFrom(tabId, tab.url);
    if (result?.ok) {
      return {
        ok: true,
        text: (result.title ? result.title + "\n\n" : "") + result.text,
      };
    }
    return { ok: false, reason: result?.reason || "error" };
  } catch (e) {
    return { ok: false, reason: "inject" };
  }
}

async function summarize(tabId) {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) return { error: "no-key" };

  let collected;
  try {
    const tab = await chrome.tabs.get(tabId);
    collected = await collectFrom(tabId, tab.url);
  } catch (e) {
    return { error: "inject", detail: String(e) };
  }
  if (!collected?.ok) return { error: collected?.reason || "transcript" };

  const prompt = await getSummaryPrompt();
  const user =
    "Título do vídeo: " +
    collected.title +
    "\n\nTranscrição:\n" +
    collected.text.slice(0, 800000);

  const out = await callGemini(geminiApiKey, prompt, user);
  return out.error ? out : { summary: out.text, title: collected.title };
}

async function compare(tabId, otherUrl) {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) return { error: "no-key" };
  if (!isWatchUrl(otherUrl)) return { error: "bad-url" };

  let current;
  try {
    const tab = await chrome.tabs.get(tabId);
    current = await collectFrom(tabId, tab.url);
  } catch (e) {
    return { error: "inject", detail: String(e) };
  }
  if (!current?.ok) return { error: current?.reason || "transcript" };

  const other = await collectFromUrl(otherUrl);
  if (!other?.ok) return { error: "other-" + (other?.reason || "transcript") };

  const prompt = (await getSummaryPrompt()) + COMPARE_ADDENDUM;
  const user =
    "VÍDEO 1 — " +
    current.title +
    "\nTranscrição:\n" +
    current.text.slice(0, 400000) +
    "\n\n=====\n\nVÍDEO 2 — " +
    other.title +
    "\nTranscrição:\n" +
    other.text.slice(0, 400000);

  const out = await callGemini(geminiApiKey, prompt, user);
  return out.error
    ? out
    : { summary: out.text, title: current.title + " × " + other.title };
}

// A transcrição só sai com o player carregado (o endpoint exige o token pot),
// então o segundo vídeo abre numa aba em segundo plano, fechada no fim.
async function collectFromUrl(url) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabLoad(tab.id, 30000);
    // Duas tentativas: em aba de segundo plano o player demora mais a
    // registrar as faixas de legenda.
    let result = null;
    for (const wait of [1500, 3000]) {
      await sleep(wait);
      result = await collectFrom(tab.id, url);
      if (result?.ok) break;
    }
    return result;
  } catch (e) {
    return { ok: false, reason: "fetch-failed" };
  } finally {
    if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs
      .get(tabId)
      .then((t) => {
        if (t.status === "complete") finish();
      })
      .catch(finish);
    setTimeout(finish, timeoutMs);
  });
}

async function callGemini(apiKey, systemPrompt, userText) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300000);
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
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
    return { text };
  } catch (e) {
    return {
      error: "api",
      detail: e?.name === "AbortError" ? "tempo esgotado (300s)" : String(e),
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
