const keyInput = document.getElementById("key");
const saveBtn = document.getElementById("save");
const toggleBtn = document.getElementById("toggle");
const statusEl = document.getElementById("status");

chrome.storage.local.get("geminiApiKey").then(({ geminiApiKey }) => {
  if (geminiApiKey) keyInput.value = geminiApiKey;
});

toggleBtn.addEventListener("click", () => {
  keyInput.type = keyInput.type === "password" ? "text" : "password";
});

saveBtn.addEventListener("click", async () => {
  const key = keyInput.value.trim();
  statusEl.className = "";
  if (!key) {
    await chrome.storage.local.remove("geminiApiKey");
    statusEl.textContent = "Chave removida.";
    return;
  }

  statusEl.textContent = "Validando chave…";
  saveBtn.disabled = true;
  try {
    // Chamada barata só para validar a chave (não consome tokens).
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
      { headers: { "x-goog-api-key": key } }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      statusEl.className = "err";
      statusEl.textContent =
        "Chave recusada pela API: " +
        (data?.error?.message || "HTTP " + res.status);
      return;
    }
    await chrome.storage.local.set({ geminiApiKey: key });
    statusEl.className = "ok";
    statusEl.textContent = "Chave validada e salva. Pode fechar esta aba.";
  } catch (e) {
    statusEl.className = "err";
    statusEl.textContent = "Erro de rede ao validar a chave: " + e;
  } finally {
    saveBtn.disabled = false;
  }
});
