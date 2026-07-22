const DEFAULT_API = "http://localhost:8000/api/v1";

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "GHST_OPEN_MENU" });
  } catch (_error) {
    // The supported content script may not be loaded on this tab.
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  if (message.type === "GHST_LOGIN") {
    const apiUrl = message.apiUrl || DEFAULT_API;
    const response = await fetch(`${apiUrl}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: message.username, password: message.password }),
    });
    const body = await parse(response);
    await chrome.storage.local.set({ ghstApiUrl: apiUrl, ghstToken: body.access_token, ghstUser: body.user });
    return { ok: true, user: body.user };
  }
  if (message.type === "GHST_LOGOUT") {
    await chrome.storage.local.remove(["ghstToken", "ghstUser"]);
    return { ok: true };
  }
  if (message.type === "GHST_STATUS") {
    const config = await chrome.storage.local.get(["ghstApiUrl", "ghstToken", "ghstUser"]);
    return { ok: true, authenticated: Boolean(config.ghstToken), user: config.ghstUser || null, apiUrl: config.ghstApiUrl || DEFAULT_API };
  }
  if (message.type === "GHST_EVALUATE") {
    const form = new FormData();
    for (const [key, value] of Object.entries(message.payload)) {
      if (key !== "fileBase64" && key !== "fileName" && value != null) form.append(key, String(value));
    }
    if (message.payload.fileBase64) {
      const bytes = Uint8Array.from(atob(message.payload.fileBase64), (char) => char.charCodeAt(0));
      form.append("file", new Blob([bytes], { type: "application/pdf" }), message.payload.fileName || "document.pdf");
    }
    return { ok: true, data: await authorisedFetch("/evaluations", { method: "POST", body: form }) };
  }
  if (message.type === "GHST_REDACT") {
    return { ok: true, data: await authorisedFetch(`/evaluations/${message.evaluationId}/redact`, { method: "POST", body: JSON.stringify(message.payload) }, true) };
  }
  if (message.type === "GHST_REFRESH") {
    return { ok: true, data: await authorisedFetch(`/evaluations/${message.evaluationId}`) };
  }
  if (message.type === "GHST_RELEASE") {
    const finalForm = new FormData();
    finalForm.append("prompt", message.prompt);
    finalForm.append("purpose", message.purpose);
    finalForm.append("destination_origin", message.destinationOrigin);
    finalForm.append("session_id", message.sessionId || `final-extension-${Date.now()}`);
    finalForm.append("device_id", "managed-extension-device");
    const finalEvaluation = await authorisedFetch("/evaluations", { method: "POST", body: finalForm });
    if (finalEvaluation.action !== "ALLOW") return { ok: true, data: { finalEvaluation, released: false } };
    const grant = await authorisedFetch(`/evaluations/${finalEvaluation.evaluation_id}/clearance-grant`, { method: "POST", body: JSON.stringify({ prompt: message.prompt, device_id: "managed-extension-device" }) }, true);
    const gateway = await authorisedFetch("/gateway/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "mock-approved-model", messages: [{ role: "user", content: message.prompt }], clearance_grant: grant.clearance_grant, device_id: "managed-extension-device" }) }, true);
    return { ok: true, data: { ...gateway, finalEvaluation, released: true } };
  }
  throw new Error("Unsupported GHST extension operation.");
}

async function authorisedFetch(path, init = {}, json = false) {
  const config = await chrome.storage.local.get(["ghstApiUrl", "ghstToken"]);
  if (!config.ghstToken) throw new Error("Open the GHST extension and sign in with a managed identity.");
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${config.ghstToken}`);
  if (json) headers.set("Content-Type", "application/json");
  const response = await fetch(`${config.ghstApiUrl || DEFAULT_API}${path}`, { ...init, headers });
  return parse(response);
}

async function parse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : `GHST request failed (${response.status}).`);
  return body;
}
