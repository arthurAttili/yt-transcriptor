// Botões ".txt" integrados à interface nativa do YouTube: um na barra de
// ações do vídeo (junto de like/compartilhar) e um nos controles do player
// (junto de legendas/engrenagem — visível também em tela cheia). O resultado
// do Gemini abre num painel lateral. Roda no world isolado (chrome.runtime).

(() => {
  const ACTION_BTN_ID = "ytt-action-btn";
  const PLAYER_BTN_ID = "ytt-player-btn";
  const PANEL_ID = "ytt-panel";
  let busy = false;

  const isWatchPage = () =>
    /^\/(watch|shorts\/|live\/)/.test(location.pathname) ||
    location.pathname === "/watch";

  // O YouTube ativa Trusted Types: innerHTML cru lança exceção. Todo HTML
  // passa por uma policy própria; se a criação dela falhar, DOMParser cobre.
  let ttPolicy = null;
  try {
    ttPolicy = window.trustedTypes
      ? trustedTypes.createPolicy("ytt-html", { createHTML: (s) => s })
      : null;
  } catch (e) {}

  function setHtml(el, html) {
    if (ttPolicy) {
      el.innerHTML = ttPolicy.createHTML(html);
      return;
    }
    try {
      el.innerHTML = html;
    } catch (e) {
      el.textContent = "";
      const doc = new DOMParser().parseFromString(html, "text/html");
      for (const n of [...doc.body.childNodes]) {
        el.appendChild(el.ownerDocument.importNode(n, true));
      }
    }
  }

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
      @keyframes ytt-fadein { from { opacity: 0; } to { opacity: 1; } }
      #${ACTION_BTN_ID} {
        display: inline-flex; align-items: center; gap: 6px; height: 36px;
        padding: 0 16px; margin-left: 8px; border: none; border-radius: 18px;
        background: var(--yt-spec-badge-chip-background, rgba(255,255,255,.1));
        color: var(--yt-spec-text-primary, #f1f1f1);
        font: 500 14px/36px "Roboto", Arial, sans-serif; cursor: pointer;
        white-space: nowrap; flex: none;
        animation: ytt-fadein 1.6s ease both;
      }
      #${ACTION_BTN_ID}:hover {
        background: var(--yt-spec-button-chip-background-hover, rgba(255,255,255,.2));
      }
      #${ACTION_BTN_ID}:disabled, #${PLAYER_BTN_ID}:disabled {
        opacity: .6; cursor: wait;
      }
      #${PLAYER_BTN_ID} {
        animation: ytt-fadein 1.6s ease both;
        width: auto; min-width: 36px; padding: 0 8px; vertical-align: top;
        color: #fff; font: 500 13px/1 "Roboto", Arial, sans-serif;
      }
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
    setHtml(panel, `
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
    `);
    panel.querySelector(".ytt-close").addEventListener("click", closePanel);
    // Em tela cheia o painel precisa ser filho do elemento em fullscreen
    // para ser exibido; fora dela, do documentElement.
    (document.fullscreenElement || document.documentElement).appendChild(panel);
    return panel;
  }

  function closePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  function showStatus(panel, html) {
    setHtml(
      panel.querySelector(".ytt-body"),
      `<div class="ytt-status">${html}</div>`
    );
  }

  function showSummary(panel, title, markdown) {
    panel.querySelector(".ytt-title").textContent = title;
    setHtml(panel.querySelector(".ytt-body"), renderMarkdown(markdown));
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
    "bad-url": "A URL informada não é de um vídeo do YouTube.",
    "other-no-transcript":
      "O segundo vídeo não tem transcrição disponível — sem ela não há como comparar.",
    "other-fetch-failed": "Erro ao obter a transcrição do segundo vídeo.",
    "other-not-watch": "A URL informada não abriu um vídeo do YouTube.",
    "other-error": "Erro ao abrir o segundo vídeo.",
    "other-transcript": "Não consegui ler a transcrição do segundo vídeo.",
  };

  function setButtonsDisabled(disabled) {
    for (const id of [ACTION_BTN_ID, PLAYER_BTN_ID]) {
      const b = document.getElementById(id);
      if (b) b.disabled = disabled;
    }
  }

  const summarize = () => run({ type: "summarize" });

  async function run(request) {
    if (busy) return;
    busy = true;
    setButtonsDisabled(true);
    const panel = openPanel();
    if (request.type === "compare") {
      showStatus(
        panel,
        `<div class="ytt-spinner"></div>
         <div>Abrindo o segundo vídeo e analisando os dois…<br>Costuma levar mais de um minuto.</div>`
      );
    }
    try {
      const resp = await chrome.runtime.sendMessage(request);
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
      setButtonsDisabled(false);
    }
  }

  // ---------- botões nativos ----------

  // Barra de ações do vídeo (junto de like/compartilhar).
  function injectActionButton() {
    if (document.getElementById(ACTION_BTN_ID)) return true;
    const container =
      document.querySelector(
        "ytd-watch-metadata #actions-inner #menu #top-level-buttons-computed"
      ) ||
      document.querySelector(
        "ytd-watch-metadata #actions #top-level-buttons-computed"
      ) ||
      document.querySelector("ytd-menu-renderer #top-level-buttons-computed");
    if (!container) return false;
    injectStyles();
    const btn = document.createElement("button");
    btn.id = ACTION_BTN_ID;
    btn.type = "button";
    btn.title = "Resumir vídeo com Gemini";
    btn.textContent = ".txt";
    btn.addEventListener("click", summarize);
    container.appendChild(btn);
    return true;
  }

  // Controles do player (junto de legendas/engrenagem) — vale em tela cheia.
  function injectPlayerButton() {
    if (document.getElementById(PLAYER_BTN_ID)) return true;
    const controls =
      document.querySelector("#movie_player .ytp-right-controls-left") ||
      document.querySelector("#movie_player .ytp-right-controls");
    if (!controls) return false;
    injectStyles();
    const btn = document.createElement("button");
    btn.id = PLAYER_BTN_ID;
    btn.className = "ytp-button";
    btn.type = "button";
    btn.title = "Resumir vídeo com Gemini";
    btn.textContent = ".txt";
    btn.addEventListener("click", summarize);
    controls.insertBefore(btn, controls.firstChild);
    return true;
  }

  // O YouTube renderiza a barra de ações de forma assíncrona; tenta injetar
  // por até 15s. getElementById não encontra nós removidos numa re-renderização
  // da página, então a checagem também cobre reinjeção.
  let retryTimer = null;
  function syncButtons() {
    clearInterval(retryTimer);
    if (!isWatchPage()) {
      document.getElementById(ACTION_BTN_ID)?.remove();
      document.getElementById(PLAYER_BTN_ID)?.remove();
      closePanel();
      return;
    }
    let tries = 0;
    const attempt = () => {
      const done = injectActionButton() & injectPlayerButton();
      if (done || ++tries > 30) clearInterval(retryTimer);
    };
    attempt();
    retryTimer = setInterval(attempt, 500);
  }

  // Os botões só entram depois que a página terminou de carregar.
  const whenLoaded = () =>
    new Promise((resolve) => {
      if (document.readyState === "complete") resolve();
      else window.addEventListener("load", resolve, { once: true });
    });

  let pageLoaded = false;

  // Navegação SPA do YouTube. No primeiro carregamento esse evento dispara
  // antes do "load" — nesse caso quem injeta os botões é o whenLoaded abaixo.
  window.addEventListener("yt-navigate-finish", () => {
    if (!pageLoaded) return;
    syncButtons();
  });
  whenLoaded().then(() => {
    pageLoaded = true;
    syncButtons();
  });

  // Ordens vindas do popup do ícone.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "open-summary") run({ type: "summarize" });
    if (msg?.type === "open-comparison")
      run({ type: "compare", otherUrl: msg.otherUrl });
  });
})();
