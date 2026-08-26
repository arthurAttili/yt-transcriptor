// Botão flutuante "Resumo" nas páginas de vídeo + painel lateral com o
// resultado do Gemini. Roda no world isolado (tem acesso a chrome.runtime).

(() => {
  const FAB_ID = "ytt-fab";
  const PANEL_ID = "ytt-panel";
  let busy = false;

  const isWatchPage = () =>
    /^\/(watch|shorts\/|live\/)/.test(location.pathname) ||
    location.pathname === "/watch";

  // ---------- markdown mínimo (títulos, negrito, itálico, listas) ----------
  const escapeHtml = (s) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const inline = (s) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  function renderMarkdown(md) {
    const out = [];
    let listOpen = false;
    const closeList = () => {
      if (listOpen) {
        out.push("</ul>");
        listOpen = false;
      }
    };
    for (const raw of md.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) {
        closeList();
        continue;
      }
      const h = line.match(/^(#{1,4})\s+(.*)/);
      if (h) {
        closeList();
        const level = h[1].length;
        out.push(`<h${level}>${inline(escapeHtml(h[2]))}</h${level}>`);
        continue;
      }
      const li = line.match(/^[-*]\s+(.*)/);
      if (li) {
        if (!listOpen) {
          out.push("<ul>");
          listOpen = true;
        }
        out.push(`<li>${inline(escapeHtml(li[1]))}</li>`);
        continue;
      }
      closeList();
      out.push(`<p>${inline(escapeHtml(line))}</p>`);
    }
    closeList();
    return out.join("\n");
  }

  // ---------- estilos ----------
  function injectStyles() {
    if (document.getElementById("ytt-styles")) return;
    const st = document.createElement("style");
    st.id = "ytt-styles";
    st.textContent = `
      #${FAB_ID} {
        position: fixed; right: 20px; bottom: 20px; z-index: 2147483645;
        display: flex; align-items: center; gap: 8px;
        padding: 10px 16px; border: none; border-radius: 24px;
        background: #E22117; color: #fff; cursor: pointer;
        font: 500 14px/1 Roboto, Arial, sans-serif;
        box-shadow: 0 4px 14px rgba(0,0,0,.4);
        transition: transform .15s, box-shadow .15s;
      }
      #${FAB_ID}:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,.5); }
      #${FAB_ID}:disabled { opacity: .6; cursor: wait; transform: none; }
      #${PANEL_ID} {
        position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483646;
        width: min(440px, 92vw); display: flex; flex-direction: column;
        background: #181818; color: #eee;
        font: 400 14px/1.6 Roboto, Arial, sans-serif;
        box-shadow: -6px 0 24px rgba(0,0,0,.5);
      }
      #${PANEL_ID} .ytt-head {
        display: flex; align-items: center; gap: 10px;
        padding: 14px 16px; background: #E22117; color: #fff; flex: 0 0 auto;
      }
      #${PANEL_ID} .ytt-head .ytt-title {
        flex: 1; font-weight: 600; font-size: 14px; line-height: 1.3;
        overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      }
      #${PANEL_ID} .ytt-head button {
        border: none; background: rgba(255,255,255,.18); color: #fff;
        border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 13px;
      }
      #${PANEL_ID} .ytt-head button:hover { background: rgba(255,255,255,.32); }
      #${PANEL_ID} .ytt-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
      #${PANEL_ID} .ytt-body h1 { font-size: 18px; margin: 4px 0 12px; line-height: 1.35; color: #fff; }
      #${PANEL_ID} .ytt-body h2 { font-size: 15px; margin: 18px 0 8px; color: #ff8a80; }
      #${PANEL_ID} .ytt-body h3 { font-size: 14px; margin: 14px 0 6px; color: #ffb3ab; }
      #${PANEL_ID} .ytt-body p { margin: 0 0 10px; }
      #${PANEL_ID} .ytt-body ul { margin: 0 0 12px; padding-left: 20px; }
      #${PANEL_ID} .ytt-body li { margin: 0 0 6px; }
      #${PANEL_ID} .ytt-body code { background: #2a2a2a; padding: 1px 5px; border-radius: 4px; }
      #${PANEL_ID} .ytt-status {
        display: flex; flex-direction: column; align-items: center; gap: 14px;
        padding: 48px 24px; text-align: center; color: #bbb;
      }
      #${PANEL_ID} .ytt-spinner {
        width: 34px; height: 34px; border-radius: 50%;
        border: 3px solid #444; border-top-color: #E22117;
        animation: ytt-spin 1s linear infinite;
      }
      @keyframes ytt-spin { to { transform: rotate(360deg); } }
      #${PANEL_ID} .ytt-status button {
        border: none; background: #E22117; color: #fff; border-radius: 6px;
        padding: 9px 16px; cursor: pointer; font-size: 13px;
      }
    `;
    document.documentElement.appendChild(st);
  }

  // ---------- painel ----------
  function openPanel() {
    closePanel();
    injectStyles();
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="ytt-head">
        <span class="ytt-title">Resumo do vídeo</span>
        <button class="ytt-copy" style="display:none">Copiar</button>
        <button class="ytt-close">✕</button>
      </div>
      <div class="ytt-body">
        <div class="ytt-status">
          <div class="ytt-spinner"></div>
          <div>Gerando resumo com Gemini…<br>Vídeos longos podem levar um minuto.</div>
        </div>
      </div>
    `;
    panel.querySelector(".ytt-close").addEventListener("click", closePanel);
    document.documentElement.appendChild(panel);
    return panel;
  }

  function closePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  function showStatus(panel, html) {
    panel.querySelector(".ytt-body").innerHTML =
      `<div class="ytt-status">${html}</div>`;
  }

  function showSummary(panel, title, markdown) {
    panel.querySelector(".ytt-title").textContent = title;
    panel.querySelector(".ytt-body").innerHTML = renderMarkdown(markdown);
    const btn = panel.querySelector(".ytt-copy");
    btn.style.display = "";
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(markdown);
        btn.textContent = "Copiado!";
        setTimeout(() => (btn.textContent = "Copiar"), 2000);
      } catch (e) {}
    });
  }

  const ERROR_MESSAGES = {
    "no-transcript":
      "Este vídeo não tem transcrição disponível — sem ela não há como resumir.",
    "not-watch": "Abra um vídeo do YouTube para gerar o resumo.",
    "fetch-failed": "Erro ao obter a transcrição deste vídeo.",
  };

  async function summarize() {
    if (busy) return;
    busy = true;
    const fab = document.getElementById(FAB_ID);
    if (fab) fab.disabled = true;
    const panel = openPanel();
    try {
      const resp = await chrome.runtime.sendMessage({ type: "summarize" });
      if (!document.getElementById(PANEL_ID)) return; // usuário fechou
      if (resp?.summary) {
        showSummary(panel, resp.title || "Resumo do vídeo", resp.summary);
      } else if (resp?.error === "no-key") {
        showStatus(
          panel,
          `<div>Cadastre sua chave da API do Gemini para gerar resumos.</div>
           <button class="ytt-options">Cadastrar chave</button>`
        );
        panel.querySelector(".ytt-options").addEventListener("click", () => {
          chrome.runtime.sendMessage({ type: "open-options" });
        });
      } else if (resp?.error === "bad-key") {
        showStatus(
          panel,
          `<div>A API do Gemini recusou a chamada:<br><small>${escapeHtml(
            resp.detail || ""
          )}</small></div>
           <button class="ytt-options">Revisar chave</button>`
        );
        panel.querySelector(".ytt-options").addEventListener("click", () => {
          chrome.runtime.sendMessage({ type: "open-options" });
        });
      } else {
        const msg =
          ERROR_MESSAGES[resp?.error] ||
          "Erro ao gerar o resumo." +
            (resp?.detail
              ? `<br><small>${escapeHtml(resp.detail)}</small>`
              : "");
        showStatus(panel, `<div>${msg}</div>`);
      }
    } catch (e) {
      if (document.getElementById(PANEL_ID)) {
        showStatus(
          panel,
          `<div>Erro de comunicação com a extensão. Recarregue a página e tente de novo.</div>`
        );
      }
    } finally {
      busy = false;
      const f = document.getElementById(FAB_ID);
      if (f) f.disabled = false;
    }
  }

  // ---------- botão flutuante ----------
  function syncFab() {
    const existing = document.getElementById(FAB_ID);
    if (!isWatchPage()) {
      existing?.remove();
      closePanel();
      return;
    }
    if (existing) return;
    injectStyles();
    const fab = document.createElement("button");
    fab.id = FAB_ID;
    fab.type = "button";
    fab.title = "Resumir vídeo com Gemini";
    fab.innerHTML = "✨ Resumo";
    fab.addEventListener("click", summarize);
    document.documentElement.appendChild(fab);
  }

  // Navegação SPA do YouTube
  window.addEventListener("yt-navigate-finish", syncFab);
  syncFab();
})();
