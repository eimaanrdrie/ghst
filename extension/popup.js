const STORAGE_KEY = "ghstPopupState";
const HISTORY_LIMIT = 50;
const HISTORY_FILTERS = ["ALL", "ALLOW", "BLOCK", "REDACT", "REVIEW", "REDIRECT"];
const identities = {
  "all-function": {
    username: "system.admin@ghst.demo",
    password: "DemoSystem!2026",
    claims: ["SYSTEM_ADMIN", "Technology", "Elena Garcia"],
  },
  reviewer: {
    username: "legal.reviewer@ghst.demo",
    password: "DemoReview!2026",
    claims: ["REVIEWER", "Legal", "Human review"],
  },
  "policy-admin": {
    username: "policy.admin@ghst.demo",
    password: "DemoPolicy!2026",
    claims: ["POLICY_ADMIN", "Governance", "Policies & ACE"],
  },
};

const tabCheck = document.querySelector("#tab-check");
const tabHistory = document.querySelector("#tab-history");
const panelCheck = document.querySelector("#panel-check");
const panelHistory = document.querySelector("#panel-history");
const safeState = document.querySelector("#safe-state");
const riskState = document.querySelector("#risk-state");
const riskTitle = document.querySelector("#risk-title");
const riskMessage = document.querySelector("#risk-message");
const historyCount = document.querySelector("#history-count");
const historyFilters = document.querySelector("#history-filters");
const historyList = document.querySelector("#history-list");
const actionRedact = document.querySelector("#action-redact");
const actionReview = document.querySelector("#action-review");
const actionBlock = document.querySelector("#action-block");
const authPanel = document.querySelector("#auth-panel");
const authAction = document.querySelector("#auth-action");
const popupStatus = document.querySelector("#popup-status");
const popupStatusLabel = document.querySelector("#popup-status-label");
const authForm = document.querySelector("#auth-form");
const authUsername = document.querySelector("#auth-username");
const authPassword = document.querySelector("#auth-password");
const authPasswordToggle = document.querySelector("#auth-password-toggle");
const authSubmit = document.querySelector("#auth-submit");
const authError = document.querySelector("#auth-error");
const authClaims = document.querySelector("#auth-claims");
const identityButtons = [...document.querySelectorAll("[data-identity]")];
const homeParts = [document.querySelector(".popup-tabs"), panelCheck, panelHistory, document.querySelector(".popup-footer")];
let selectedIdentity = "all-function";
let authenticated = false;
let selectedHistoryFilter = "ALL";
let latestState = defaultState();

globalThis.GHSTIcons.hydrate();

identityButtons.forEach((button) => {
  button.addEventListener("click", () => selectIdentity(button.dataset.identity));
});
authPasswordToggle.addEventListener("click", () => {
  const visible = authPassword.type === "text";
  authPassword.type = visible ? "password" : "text";
  authPasswordToggle.setAttribute("aria-label", visible ? "Show password" : "Hide password");
  authPasswordToggle.title = visible ? "Show password" : "Hide password";
  authPasswordToggle.innerHTML = globalThis.GHSTIcons.icon(visible ? "eye" : "eye-off", 16);
});
authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void signIn();
});
authAction.addEventListener("click", () => {
  if (authenticated) void signOut();
  else showAuth();
});

selectIdentity(selectedIdentity);
refreshAuth();

tabCheck.addEventListener("click", () => setTab("check"));
tabHistory.addEventListener("click", () => setTab("history"));
actionRedact.addEventListener("click", () => sendTabAction("GHST_POPUP_REDACT"));
actionReview.addEventListener("click", () => sendTabAction("GHST_POPUP_REVIEW"));
actionBlock.addEventListener("click", () => sendTabAction("GHST_POPUP_BLOCK"));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  renderState(changes[STORAGE_KEY].newValue || defaultState());
});

refresh();

async function refreshAuth() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GHST_STATUS" });
    setAuthenticated(Boolean(response?.authenticated), response?.user);
  } catch (_error) {
    setAuthenticated(false);
    showAuthError("GHST background service is unavailable. Reload the extension and try again.");
  }
}

function selectIdentity(identityId) {
  if (!identities[identityId]) return;
  selectedIdentity = identityId;
  const identity = identities[identityId];
  authUsername.value = identity.username;
  authPassword.value = identity.password;
  authClaims.innerHTML = identity.claims.map((claim) => `<span>${escapeHtml(claim)}</span>`).join("");
  identityButtons.forEach((button) => {
    const selected = button.dataset.identity === identityId;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", String(selected));
  });
}

async function signIn() {
  const username = authUsername.value.trim();
  const password = authPassword.value;
  if (!username || !password) {
    showAuthError("Email and password are required.");
    return;
  }
  authSubmit.disabled = true;
  authSubmit.querySelector("span:last-child").textContent = "Signing in...";
  clearAuthError();
  try {
    const response = await chrome.runtime.sendMessage({ type: "GHST_LOGIN", username, password });
    if (!response?.ok) throw new Error(response?.error || "Authentication failed.");
    setAuthenticated(true, response.user);
  } catch (error) {
    showAuthError(error.message || "Authentication failed.");
  } finally {
    authSubmit.disabled = false;
    authSubmit.querySelector("span:last-child").textContent = "Sign in";
  }
}

async function signOut() {
  await chrome.runtime.sendMessage({ type: "GHST_LOGOUT" });
  setAuthenticated(false);
}

function setAuthenticated(value, user = null) {
  authenticated = value;
  authPanel.hidden = value;
  homeParts.forEach((part) => { if (part) part.hidden = !value; });
  authAction.hidden = false;
  authAction.textContent = value ? `${user?.display_name || "Signed in"} - Sign out` : "Sign in";
  popupStatus.classList.toggle("unauthenticated", !value);
  popupStatusLabel.textContent = value ? "Protected" : "Sign in required";
  if (!value) authUsername.focus();
}

function showAuth() {
  setAuthenticated(false);
  authUsername.focus();
}

function showAuthError(message) {
  authError.hidden = false;
  authError.textContent = message;
}

function clearAuthError() {
  authError.hidden = true;
  authError.textContent = "";
}

async function refresh() {
  const stored = await chrome.storage.local.get([STORAGE_KEY]);
  renderState(stored[STORAGE_KEY] || defaultState());
}

function renderState(state) {
  latestState = state || defaultState();
  const history = Array.isArray(state.history) ? state.history.slice(0, HISTORY_LIMIT) : [];
  const risky = Boolean(state.current?.risky);
  safeState.hidden = risky;
  riskState.hidden = !risky;

  if (risky) {
    riskTitle.textContent = state.current?.title || "Review required";
    riskMessage.textContent = state.current?.message || "GHST found risky content in the current prompt.";
  }

  historyCount.textContent = String(history.length);
  renderHistoryFilters(history);
  renderHistory(history);
}

function renderHistoryFilters(history) {
  if (!historyFilters) return;
  const counts = Object.fromEntries(HISTORY_FILTERS.map((filter) => [filter, 0]));
  counts.ALL = history.length;
  for (const item of history) {
    const action = normalizeAction(item.action);
    counts[action] = (counts[action] || 0) + 1;
  }
  historyFilters.innerHTML = HISTORY_FILTERS.map((filter) => `
    <button
      type="button"
      class="popup-history-filter${selectedHistoryFilter === filter ? " active" : ""}"
      data-history-filter="${filter}"
      role="tab"
      aria-selected="${selectedHistoryFilter === filter}"
    >
      ${escapeHtml(filter === "ALL" ? `All ${counts.ALL}` : `${filter} ${counts[filter] || 0}`)}
    </button>
  `).join("");
  [...historyFilters.querySelectorAll("[data-history-filter]")].forEach((button) => {
    button.addEventListener("click", () => {
      selectedHistoryFilter = button.dataset.historyFilter || "ALL";
      renderState(latestState);
    });
  });
}

function renderHistory(history) {
  const filteredHistory = selectedHistoryFilter === "ALL"
    ? history
    : history.filter((item) => normalizeAction(item.action) === selectedHistoryFilter);
  if (!history.length) {
    historyList.innerHTML = `
      <div class="popup-history-empty">
        <span data-lucide="history" data-size="26"></span>
        <span>No recent GHST checks.</span>
      </div>
    `;
    globalThis.GHSTIcons.hydrate();
    return;
  }

  if (!filteredHistory.length) {
    historyList.innerHTML = `
      <div class="popup-history-empty">
        <span data-lucide="history" data-size="26"></span>
        <span>No ${escapeHtml(selectedHistoryFilter.toLowerCase())} history yet.</span>
      </div>
    `;
    globalThis.GHSTIcons.hydrate();
    return;
  }

  historyList.innerHTML = filteredHistory.map((item) => {
    const action = normalizeAction(item.action);
    return `
      <article class="popup-history-item">
        <div class="popup-history-top">
          <span class="popup-history-title">${escapeHtml(item.title || "ChatGPT prompt")}</span>
          <span class="popup-history-badge ${action.toLowerCase()}">${action}</span>
        </div>
        <div class="popup-history-meta">${escapeHtml(item.timestamp || "Just now")}</div>
        <div class="popup-history-message">${escapeHtml(item.message || defaultHistoryMessage(action))}</div>
        <div class="popup-history-prompt">${escapeHtml(item.prompt || "No prompt captured.")}</div>
      </article>
    `;
  }).join("");
}

function setTab(tab) {
  const checkActive = tab === "check";
  tabCheck.classList.toggle("active", checkActive);
  tabHistory.classList.toggle("active", !checkActive);
  tabCheck.setAttribute("aria-selected", String(checkActive));
  tabHistory.setAttribute("aria-selected", String(!checkActive));
  panelCheck.hidden = !checkActive;
  panelHistory.hidden = checkActive;
}

async function sendTabAction(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type });
  } catch (_error) {
    return;
  }
  window.close();
}

function normalizeAction(action) {
  if (["ALLOW", "REDACT", "REVIEW", "REDIRECT", "BLOCK"].includes(action)) return action;
  return "ALLOW";
}

function defaultHistoryMessage(action) {
  if (action === "ALLOW") return "Prompt released silently.";
  if (action === "REDACT") return "Redaction was required before release.";
  if (action === "REVIEW") return "Prompt escalated to human review.";
  if (action === "REDIRECT") return "Prompt required an approved destination.";
  return "Prompt was blocked before release.";
}

function defaultState() {
  return {
    current: {
      risky: false,
      title: "Review required",
      message: "GHST found risky content in the current prompt.",
    },
    history: [],
  };
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value || "");
  return div.innerHTML;
}
