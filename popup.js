// Popup do ícone: copiar transcrição, resumir, comparar com outro vídeo e
// editar a instrução usada pelo Gemini. A cópia é gravada aqui porque com o
// popup aberto o documento focado é ele, e não a página.

const $ = (id) => document.getElementById(id);

let tabId = null;
let defaultPrompt = "";

const COPY_ERRORS = {
  "not-watch": "Abra um vídeo do YouTube para copiar a transcrição.",
  "no-transcript": "Este vídeo não tem transcrição disponível.",
  "fetch-failed": "Erro ao obter a transcrição deste vídeo.",
  inject: "Não consegui ler esta aba. Recarregue a página e tente de novo.",
};

function setCopyStatus(text, kind) {
  const el = $("copy-status");
  el.textContent = text;
  el.className = kind || "";
  el.hidden = !text;
}

function setMsg(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = "msg " + (kind || "");
}

const isYouTubeVideo = (url) =>
  /^https?:\/\/(www\.|m\.)?youtube\.com\/(watch|shorts\/|live\/)/.test(
    url || ""
  );

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;

  if (!isYouTubeVideo(tab?.url)) {
    setCopyStatus("Abra um vídeo do YouTube para usar a extensão.", "err");
    for (const id of ["copy", "summarize", "compare-toggle"]) {
      $(id).disabled = true;
    }
  }

  loadPrompt();
}

async function copyTranscript() {
  setCopyStatus("Copiando a transcrição…");
  $("copy").disabled = true;
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "copy-transcript",
      tabId,
    });
    if (!resp?.ok) {
      setCopyStatus(
        COPY_ERRORS[resp?.reason] || "Erro ao copiar a transcrição.",
        "err"
      );
      return;
    }
    await navigator.clipboard.writeText(resp.text);
    setCopyStatus("Transcrição copiada!", "ok");
  } catch (e) {
    setCopyStatus("Não consegui acessar a área de transferência.", "err");
  } finally {
    $("copy").disabled = false;
  }
}

async function loadPrompt() {
  const [{ prompt } = {}, stored] = await Promise.all([
    chrome.runtime.sendMessage({ type: "get-default-prompt" }),
    chrome.storage.local.get("summaryPrompt"),
  ]);
  defaultPrompt = prompt || "";
  $("prompt").value = stored?.summaryPrompt?.trim()
    ? stored.summaryPrompt
    : defaultPrompt;
}

// O popup fecha só depois que a mensagem chega ao content script: fechar
// antes disso derruba o canal e a ordem se perde.
function order(message) {
  chrome.tabs
    .sendMessage(tabId, message)
    .catch(() => {})
    .finally(() => window.close());
}

$("copy").addEventListener("click", copyTranscript);
$("summarize").addEventListener("click", () => order({ type: "open-summary" }));

$("compare-toggle").addEventListener("click", () => {
  const box = $("compare-box");
  const open = box.style.display === "block";
  box.style.display = open ? "none" : "block";
  if (!open) $("other-url").focus();
});

$("compare-go").addEventListener("click", () => {
  const url = $("other-url").value.trim();
  if (!isYouTubeVideo(url)) {
    setMsg("compare-msg", "Cole a URL de um vídeo do YouTube.", "err");
    return;
  }
  order({ type: "open-comparison", otherUrl: url });
});

$("other-url").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("compare-go").click();
});

$("prompt-save").addEventListener("click", async () => {
  const value = $("prompt").value.trim();
  await chrome.storage.local.set({ summaryPrompt: value });
  setMsg("prompt-msg", "Instruções salvas.", "ok");
});

$("prompt-reset").addEventListener("click", async () => {
  $("prompt").value = defaultPrompt;
  await chrome.storage.local.remove("summaryPrompt");
  setMsg("prompt-msg", "Instruções padrão restauradas.", "ok");
});

$("options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();
