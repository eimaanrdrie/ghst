(() => {
  if (window.__GHST_PROTECTED_COMPOSER__) return;
  window.__GHST_PROTECTED_COMPOSER__ = true;

  const siteAdapter = globalThis.GHSTSiteAdapters?.resolve(location);
  if (!siteAdapter) return;

  const sessionId = `extension-${crypto.randomUUID()}`;
  const icon = globalThis.GHSTIcons.icon;
  const logoUrl = chrome.runtime.getURL("ghst-logo.png");
  let latest = null;
  let promptValue = "";
  let adapterHealthMessageActive = false;
  let positionTimer = null;
  let lastNativePrompt = "";
  let approvedSubmitInProgress = false;
  let validationRequestId = 0;
  let lastValidatedPrompt = "";
  let notificationTimer = null;
  let reviewSubmitted = false;
  let lastAttachmentSignature = "";
  const popupStateKey = "ghstPopupState";

  const host = document.createElement("div");
  host.id = "ghst-protected-root";
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    :host{--line:rgba(129,145,170,.24);--line-strong:rgba(24,239,224,.86);--text:#f4f6fb;--muted:#9db3d5;--teal:#18efe0;--green:#59f089;--danger:#ff6b72;--danger-soft:rgba(255,107,114,.12);--warning:#ffcf68;--warning-soft:rgba(255,207,104,.12);--redirect:#9ec4ff;--redirect-soft:rgba(108,155,255,.14);--shadow:0 18px 42px rgba(0,0,0,.44)}*{box-sizing:border-box}[hidden]{display:none!important}button{font:inherit}.lucide{display:block;flex:0 0 auto}.status-pill{position:fixed;z-index:2147483647;display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;background:rgba(15,23,42,.92);color:#fff;border:1px solid rgba(59,130,246,.28);box-shadow:0 10px 30px rgba(0,0,0,.28);font:700 12px Inter,system-ui,sans-serif;letter-spacing:.01em;white-space:nowrap;pointer-events:none}.status-dot{width:9px;height:9px;border-radius:999px;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.18)}.submit-notice{position:fixed;right:18px;top:108px;z-index:2147483647;display:grid;grid-template-columns:auto 1fr;align-items:start;gap:10px;width:min(316px,calc(100vw - 24px));padding:12px 14px;border:1px solid rgba(255,107,114,.28);border-radius:14px;background:rgba(43,11,18,.96);box-shadow:0 18px 40px rgba(0,0,0,.3);color:#ffd7da;font:600 12px Inter,system-ui,sans-serif;line-height:1.4;opacity:0;transform:translateY(-6px) scale(.98);pointer-events:none;transition:opacity .18s ease,transform .2s ease}.submit-notice.show{opacity:1;transform:translateY(0) scale(1)}.submit-notice .lucide{color:var(--danger)}.submit-notice strong{display:block;color:#fff;font-size:12px}.submit-notice span:last-child{display:block;color:#ffb8be;font-weight:500}.drawer-toggle{position:fixed;right:18px;top:64px;z-index:2147483647;width:34px;height:34px;border-radius:10px;border:1px solid rgba(96,165,250,.38);background:rgba(29,78,216,.95);color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.28);transition:opacity .18s ease,transform .22s ease,visibility .22s ease}.drawer-toggle img{width:24px;height:24px;object-fit:contain;display:block}.drawer-toggle.hidden{opacity:0;visibility:hidden;transform:scale(.92);pointer-events:none}.drawer{position:fixed;top:64px;right:18px;width:min(316px,calc(100vw - 24px));max-height:min(508px,calc(100vh - 88px));background:rgba(4,16,38,.985);color:var(--text);border:1px solid rgba(140,160,187,.32);border-radius:18px;box-shadow:var(--shadow);z-index:2147483647;font-family:Inter,system-ui,sans-serif;backdrop-filter:blur(18px);overflow:hidden;transform:translateX(10px) translateY(-4px) scale(.95);transform-origin:top right;opacity:0;pointer-events:none;transition:transform .22s cubic-bezier(.22,1,.36,1),opacity .18s ease}.drawer.open{transform:translateX(0) translateY(0) scale(1);opacity:1;pointer-events:auto}.drawer-head{min-height:68px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:10px;font-size:12px;font-weight:700;letter-spacing:.02em}.brand-mark{width:40px;height:40px;display:grid;place-items:center}.brand-mark img{width:30px;height:30px;object-fit:contain;display:block}.head-status{display:inline-flex;align-items:center;gap:8px;color:var(--green);font-size:13px;font-weight:600}.head-status-dot{width:9px;height:9px;border-radius:999px;background:var(--green);box-shadow:0 0 0 4px rgba(89,240,137,.14)}.drawer-close{width:28px;height:28px;border:0;border-radius:10px;background:transparent;color:#b7c7df;display:grid;place-items:center;cursor:pointer}.drawer-body{max-height:calc(min(508px,calc(100vh - 88px)) - 68px);display:grid;grid-template-rows:58px minmax(0,1fr);overflow:hidden}.drawer-tabs{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--line);padding:0 16px}.drawer-tab{position:relative;border:0;background:transparent;color:#a5b7d8;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-size:14px;font-weight:600}.drawer-tab.active{color:var(--teal)}.drawer-tab.active::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--line-strong)}.drawer-tab-count{min-width:22px;min-height:22px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:rgba(255,255,255,.12);color:var(--text);font-size:12px}.panel{min-height:0;padding:14px 16px 12px}.panel-check{display:grid;grid-template-rows:auto auto auto auto;align-content:start;gap:12px}.safe-state{display:grid;justify-items:center;gap:10px;text-align:center}.safe-icon{color:var(--teal);filter:drop-shadow(0 0 16px rgba(24,239,224,.16))}.safe-title{margin:0;font-size:20px;font-weight:700}.connection{width:100%;min-height:52px;display:grid;grid-template-columns:auto auto 1fr auto;align-items:center;gap:10px;padding:0 12px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(255,255,255,.03)}.connection-dot{width:9px;height:9px;border-radius:999px;background:var(--green)}.connection-label{font-size:15px;font-weight:600}.connection-state{color:var(--green);font-size:13px;font-weight:600}.risk-state{display:grid;gap:12px;padding:12px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(255,255,255,.03)}.risk-head{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center}.risk-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:12px;color:var(--warning);background:var(--warning-soft)}.risk-copy h2,.risk-copy p{margin:0}.risk-copy h2{font-size:16px;font-weight:700}.risk-copy p{margin-top:4px;color:var(--muted);font-size:11px;line-height:1.35}.risk-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.action{min-height:36px;border-radius:10px;border:1px solid transparent;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;padding:0 8px}.action:disabled{opacity:.45;cursor:not-allowed}.action.redact{background:rgba(24,239,224,.14);border-color:rgba(24,239,224,.28);color:var(--teal)}.action.review{background:var(--warning-soft);border-color:rgba(255,207,104,.28);color:var(--warning)}.action.redirect{background:var(--redirect-soft);border-color:rgba(108,155,255,.24);color:var(--redirect)}.action.block{background:var(--danger-soft);border-color:rgba(255,107,114,.28);color:var(--danger)}.flow{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:5px}.flow-step{display:grid;justify-items:center;gap:6px;text-align:center}.flow-ring{width:46px;height:46px;display:grid;place-items:center;border-radius:999px;border:1px solid rgba(255,255,255,.28);color:#d6e2f7;background:rgba(255,255,255,.03)}.flow-step span:last-child{color:#b3c5e0;font-size:11px}.flow-line{width:100%;border-top:2px dashed rgba(208,222,247,.42)}.inline-message{min-height:15px;color:var(--muted);font-size:11px;line-height:1.35;text-align:center}.panel-history{padding-top:12px;overflow:auto}.history-list{display:grid;align-content:start;gap:8px}.history-item,.history-empty{border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(255,255,255,.03)}.history-item{padding:10px 12px;display:grid;gap:5px}.history-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.history-title{font-size:12px;font-weight:600;color:var(--text)}.history-badge{min-height:20px;padding:0 8px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.05em}.history-badge.allow{color:var(--green);background:rgba(89,240,137,.12)}.history-badge.redact{color:var(--teal);background:rgba(24,239,224,.12)}.history-badge.review,.history-badge.redirect{color:var(--warning);background:var(--warning-soft)}.history-badge.block{color:var(--danger);background:var(--danger-soft)}.history-meta,.history-message{color:var(--muted);font-size:10px;line-height:1.35}.history-empty{min-height:160px;display:grid;place-content:center;justify-items:center;gap:10px;text-align:center;color:var(--muted);padding:20px}.drawer-foot{min-height:46px;display:flex;align-items:center;gap:8px;padding:0 16px;border-top:1px solid var(--line);color:#afc2df;font-size:12px}.drawer-foot .lucide{color:#b7cff4}
  </style>
  <div class="status-pill" id="ghst-status-pill"><span class="status-dot"></span><span id="ghst-status-label">Protected By GHST</span></div>
  <div class="submit-notice" id="submit-notice" role="alert" aria-live="assertive"><span>${icon("triangle-alert",18)}</span><div><strong id="submit-notice-title">Submission stopped</strong><span id="submit-notice-text">GHST needs attention before this prompt can be released.</span></div></div>
  <button class="drawer-toggle" id="drawer-toggle" aria-label="Open GHST menu" title="Open GHST menu"><img src="${logoUrl}" alt=""></button>
  <section class="drawer" id="drawer"><header class="drawer-head"><span class="brand"><span class="brand-mark"><img src="${logoUrl}" alt=""></span>GHST</span><div class="drawer-head-actions"><button class="drawer-signout" id="drawer-signout" hidden>${icon("log-out",14)}<span>Sign out</span></button><button class="drawer-close" id="drawer-close" aria-label="Close GHST menu" title="Close GHST menu">${icon("minimize-2",16)}</button></div></header><div class="drawer-body" hidden><div class="drawer-tabs"><button class="drawer-tab active" id="tab-check" aria-selected="true">${icon("search",20)}<span>Check</span></button><button class="drawer-tab" id="tab-history" aria-selected="false">${icon("history",20)}<span>History</span><span class="drawer-tab-count" id="history-count">0</span></button></div><section class="panel panel-check" id="panel-check"><div class="safe-state" id="safe-state"><div class="safe-icon">${icon("shield-check",58)}</div><h1 class="safe-title">Protection is active</h1><div class="connection"><span class="connection-dot"></span>${icon("sparkles",24)}<strong class="connection-label">ChatGPT</strong><span class="connection-state">Connected</span></div></div><div class="risk-state" id="risk-state" hidden><div class="risk-head"><div class="risk-icon" id="risk-icon">${icon("triangle-alert",34)}</div><div class="risk-copy"><span class="risk-eyebrow" id="risk-eyebrow">Action required</span><h2 id="risk-title">Review required</h2><p id="risk-message">GHST found risky content in the current prompt.</p></div></div><div class="result-pages" aria-live="polite"><section class="result-page redact-page" data-result-page="REDACT" hidden><strong>Sensitive values found</strong><span>Use typed placeholders, then GHST rescans before release.</span></section><section class="result-page review-page" data-result-page="REVIEW" hidden><strong>Human approval needed</strong><span>The prompt is held for an authorised reviewer.</span></section><section class="result-page redirect-page" data-result-page="REDIRECT" hidden><strong>Use approved destination</strong><span>Open the approved GHST destination before sending.</span></section><section class="result-page block-page" data-result-page="BLOCK" hidden><strong>Release blocked</strong><span>This content cannot be sent from the extension.</span></section></div><div class="risk-actions"><button class="action redact" id="action-redact">${icon("eraser",14)}<span>Redact</span></button><button class="action review" id="action-review">${icon("user-check",14)}<span>Submit to reviewer</span></button><button class="action redirect" id="action-redirect">${icon("external-link",14)}<span>Redirect</span></button><button class="action block" id="action-block">${icon("ban",14)}<span>Blocked</span></button></div></div><div class="flow"><div class="flow-step"><div class="flow-ring">${icon("search",22)}</div><span>Inspect</span></div><div class="flow-line"></div><div class="flow-step"><div class="flow-ring">${icon("shield-check",22)}</div><span>Enforce</span></div><div class="flow-line"></div><div class="flow-step"><div class="flow-ring">${icon("send",22)}</div><span>Release</span></div></div><div class="inline-message" id="inline-message"></div><footer class="drawer-foot">${icon("activity",20)}<span>Monitoring this ChatGPT tab</span></footer></section><section class="panel panel-history" id="panel-history" hidden><div class="history-filters" id="history-filters"></div><div class="history-list" id="history-list"></div></section></div></section>`;

  const statusPill = root.querySelector("#ghst-status-pill");
  const statusLabel = root.querySelector("#ghst-status-label");
  const submitNotice = root.querySelector("#submit-notice");
  const submitNoticeTitle = root.querySelector("#submit-notice-title");
  const submitNoticeText = root.querySelector("#submit-notice-text");
  const drawer = root.querySelector("#drawer");
  const drawerBody = root.querySelector(".drawer-body");
  const drawerToggle = root.querySelector("#drawer-toggle");
  const drawerClose = root.querySelector("#drawer-close");
  const drawerSignOut = root.querySelector("#drawer-signout");
  const tabCheck = root.querySelector("#tab-check");
  const tabHistory = root.querySelector("#tab-history");
  const panelCheck = root.querySelector("#panel-check");
  const panelHistory = root.querySelector("#panel-history");
  const safeState = root.querySelector("#safe-state");
  const riskState = root.querySelector("#risk-state");
  const riskIcon = root.querySelector("#risk-icon");
  const riskEyebrow = root.querySelector("#risk-eyebrow");
  const riskTitle = root.querySelector("#risk-title");
  const riskMessage = root.querySelector("#risk-message");
  const resultPages = [...root.querySelectorAll("[data-result-page]")];
  const historyCount = root.querySelector("#history-count");
  const historyFilters = root.querySelector("#history-filters");
  const historyList = root.querySelector("#history-list");
  const inlineMessage = root.querySelector("#inline-message");
  const flow = root.querySelector(".flow");
  const drawerFoot = root.querySelector(".drawer-foot");
  const actionRedact = root.querySelector("#action-redact");
  const actionReview = root.querySelector("#action-review");
  const actionRedirect = root.querySelector("#action-redirect");
  const actionBlock = root.querySelector("#action-block");
  const riskActions = [actionRedact, actionReview, actionRedirect, actionBlock];
  const historyLimit = 50;
  const historyFiltersList = ["ALL", "ALLOW", "BLOCK", "REDACT", "REVIEW", "REDIRECT"];
  let selectedHistoryFilter = "ALL";
  let latestDrawerState = { current: null, history: [] };
  const managedIdentities = {
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
  let authenticated = false;
  let selectedIdentity = "all-function";
  const drawerAuth = document.createElement("section");
  drawerAuth.className = "drawer-auth";
  drawerAuth.hidden = true;
  drawerAuth.setAttribute("aria-labelledby", "drawer-auth-title");
  drawerAuth.innerHTML = `<div class="drawer-auth-heading"><span class="drawer-auth-icon">${icon("shield-check",22)}</span><div><h2 id="drawer-auth-title">Sign in required</h2><p>Choose a managed identity before submitting prompts.</p></div></div><div class="drawer-auth-identities" role="radiogroup" aria-label="Seeded identities"><button type="button" data-drawer-identity="all-function" role="radio" aria-checked="true"><strong>All Function</strong><span>Elena Garcia</span></button><button type="button" data-drawer-identity="reviewer" role="radio" aria-checked="false"><strong>Reviewer</strong><span>Human review</span></button><button type="button" data-drawer-identity="policy-admin" role="radio" aria-checked="false"><strong>Policy Admin</strong><span>Policies &amp; ACE</span></button></div><div class="drawer-auth-claims" id="drawer-auth-claims"></div><form class="drawer-auth-form" id="drawer-auth-form" novalidate><label for="drawer-auth-username">Email</label><input id="drawer-auth-username" type="email" autocomplete="username" required><label for="drawer-auth-password">Password</label><div class="drawer-auth-password"><input id="drawer-auth-password" type="password" autocomplete="current-password" required><button type="button" id="drawer-auth-password-toggle" aria-label="Show password" title="Show password">${icon("eye",16)}</button></div><div id="drawer-auth-error" class="drawer-auth-error" role="alert" hidden></div><button type="submit" id="drawer-auth-submit" class="drawer-auth-submit">${icon("log-in",16)}<span>Sign in</span></button></form>`;
  drawer.insertBefore(drawerAuth, drawerBody);
  const drawerAuthForm = drawerAuth.querySelector("#drawer-auth-form");
  const drawerAuthUsername = drawerAuth.querySelector("#drawer-auth-username");
  const drawerAuthPassword = drawerAuth.querySelector("#drawer-auth-password");
  const drawerAuthPasswordToggle = drawerAuth.querySelector("#drawer-auth-password-toggle");
  const drawerAuthSubmit = drawerAuth.querySelector("#drawer-auth-submit");
  const drawerAuthError = drawerAuth.querySelector("#drawer-auth-error");
  const drawerAuthClaims = drawerAuth.querySelector("#drawer-auth-claims");
  const drawerIdentityButtons = [...drawerAuth.querySelectorAll("[data-drawer-identity]")];
  const authStyle = document.createElement("style");
  authStyle.textContent = `.drawer-head-actions{display:flex;align-items:center;gap:8px}.drawer-signout{height:28px;padding:0 9px;display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(24,239,224,.24);border-radius:8px;background:rgba(24,239,224,.08);color:var(--teal);cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap}.drawer-signout[hidden]{display:none!important}.risk-state{position:relative;overflow:hidden}.risk-state::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:var(--warning);opacity:.95}.risk-state.redact::before{background:var(--teal)}.risk-state.review::before{background:var(--warning)}.risk-state.redirect::before{background:var(--redirect)}.risk-state.block::before{background:var(--danger)}.risk-eyebrow{display:block;margin-bottom:3px;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.result-pages{display:grid}.result-page{min-height:72px;padding:11px 12px;align-content:center;gap:5px;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(255,255,255,.035);box-shadow:0 8px 22px rgba(0,0,0,.16);animation:ghstResultIn .18s cubic-bezier(.2,0,0,1)}.result-page[hidden]{display:none!important}.result-page strong,.result-page span{display:block}.result-page strong{font-size:13px;text-wrap:balance}.result-page span{margin-top:5px;color:var(--muted);font-size:11px;line-height:1.35;text-wrap:pretty}.risk-actions{grid-template-columns:1fr!important}.action{min-height:40px;display:inline-flex!important;align-items:center;justify-content:center;gap:7px;transition:transform .16s cubic-bezier(.2,0,0,1),opacity .16s ease}.action:active{transform:scale(.96)}.action.is-hidden{display:none!important}.action.submitted{background:rgba(89,240,137,.12);border-color:rgba(89,240,137,.28);color:var(--green)}.action.block{cursor:not-allowed}.action.block:not(:disabled){opacity:.72}.panel-check.risky{gap:10px}.panel-check.risky .risk-state{gap:10px;padding:10px 12px}.panel-check.risky .risk-copy p{font-size:10px;line-height:1.28;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}.panel-check.risky .result-page{min-height:60px;padding:9px 11px}.panel-check.risky .result-page span{font-size:10px;line-height:1.25;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.panel-check.risky .flow{margin-top:2px}.panel-check.risky .flow-ring{width:38px;height:38px}.panel-check.risky .flow-step{gap:4px}.panel-check.risky .flow-step span:last-child{font-size:10px}.panel-check.risky .inline-message{display:none}.panel-check.risky .drawer-foot{min-height:42px;font-size:11px}.panel-history{display:grid;grid-template-rows:auto minmax(0,1fr);gap:8px}.history-filters{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}.history-filters::-webkit-scrollbar{display:none}.history-filter{min-height:28px;padding:0 10px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(255,255,255,.03);color:var(--muted);font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap}.history-filter.active{border-color:rgba(24,239,224,.28);background:rgba(24,239,224,.12);color:var(--teal)}.history-prompt{padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);color:#dbe8fb;font-size:11px;line-height:1.45;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}@keyframes ghstResultIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}.drawer-auth{min-height:0;padding:16px;display:grid;align-content:start;gap:11px}.drawer-auth[hidden]{display:none!important}.drawer-auth-heading{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center}.drawer-auth-icon{width:38px;height:38px;display:grid;place-items:center;border:1px solid rgba(24,239,224,.3);border-radius:10px;color:var(--teal);background:rgba(24,239,224,.1)}.drawer-auth-heading h2,.drawer-auth-heading p{margin:0}.drawer-auth-heading h2{font-size:18px}.drawer-auth-heading p{margin-top:3px;color:var(--muted);font-size:11px;line-height:1.3}.drawer-auth-identities{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.drawer-auth-identities button{min-height:54px;padding:7px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.03);color:var(--text);cursor:pointer;text-align:left}.drawer-auth-identities button.selected{border-color:var(--teal);background:rgba(24,239,224,.1)}.drawer-auth-identities strong,.drawer-auth-identities span{display:block}.drawer-auth-identities strong{font-size:11px}.drawer-auth-identities span{margin-top:3px;color:var(--muted);font-size:9px}.drawer-auth-claims{display:flex;flex-wrap:wrap;gap:5px}.drawer-auth-claims span{padding:4px 7px;border:1px solid rgba(24,239,224,.24);border-radius:999px;color:var(--teal);font-size:9px;font-weight:700}.drawer-auth-form{display:grid;gap:5px}.drawer-auth-form label{color:var(--muted);font-size:10px;font-weight:600}.drawer-auth-form input{width:100%;height:32px;padding:0 9px;border:1px solid var(--line);border-radius:7px;background:rgba(255,255,255,.05);color:var(--text);font:inherit;font-size:11px}.drawer-auth-password{position:relative}.drawer-auth-password input{padding-right:32px}.drawer-auth-password button{position:absolute;top:2px;right:2px;width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer}.drawer-auth-error{padding:7px 8px;border:1px solid rgba(255,107,114,.3);border-radius:7px;background:var(--danger-soft);color:#ffb8be;font-size:10px;line-height:1.3}.drawer-auth-submit{height:34px;display:inline-flex;align-items:center;justify-content:center;gap:7px;margin-top:3px;border:1px solid rgba(24,239,224,.32);border-radius:8px;background:rgba(24,239,224,.14);color:var(--teal);cursor:pointer;font-size:11px;font-weight:700}.drawer-auth-submit:disabled{opacity:.55;cursor:wait}`;
  root.appendChild(authStyle);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GHST_OPEN_MENU") {
      setDrawerVisible(true);
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "GHST_POPUP_REDACT") {
      if (!latest) {
        setDrawerVisible(true);
        actionError("No risky prompt is waiting for redaction.");
        sendResponse({ ok: true });
        return;
      }
      redact().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === "GHST_POPUP_REVIEW") {
      setDrawerVisible(true);
      if (latest) render(latest);
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "GHST_POPUP_BLOCK") {
      setDrawerVisible(true);
      setStatus("Blocked");
      actionError("This prompt remains blocked and cannot be released.");
      void updatePopupState({
        risky: true,
        title: "Blocked",
        message: "This prompt remains blocked and cannot be released.",
        action: "BLOCK",
      });
      sendResponse({ ok: true });
      return;
    }
  });

  drawerToggle.addEventListener("click", () => setDrawerVisible(!drawer.classList.contains("open")));
  drawerClose.addEventListener("click", () => setDrawerVisible(false));
  drawerSignOut.addEventListener("click", () => {
    void signOut();
  });
  tabCheck.addEventListener("click", () => setActiveTab("check"));
  tabHistory.addEventListener("click", () => setActiveTab("history"));
  actionRedact.addEventListener("click", () => latest && redact());
  actionReview.addEventListener("click", () => {
    setDrawerVisible(true);
    if (!latest?.review_id) {
      setInlineMessage("Human review is required. GHST is preparing the review record.");
      return;
    }
    reviewSubmitted = true;
    updateReviewButton();
    setInlineMessage("Submitted to reviewer queue.");
    showSubmitNotification("Submitted to reviewer", `Review ${latest.review_id.slice(0, 8)} is waiting for an authorised reviewer.`);
    void updatePopupState({
      risky: true,
      title: "Review submitted",
      message: "Queued for authorised review.",
      action: "REVIEW",
    });
  });
  actionRedirect.addEventListener("click", () => {
    if (latest?.redirect_origin) location.href = latest.redirect_origin;
  });
  actionBlock.addEventListener("click", () => {
    setStatus("Blocked");
    setInlineMessage("This prompt is blocked and cannot be released.");
  });
  drawerIdentityButtons.forEach((button) => {
    button.addEventListener("click", () => selectIdentity(button.dataset.drawerIdentity));
  });
  drawerAuthPasswordToggle.addEventListener("click", () => {
    const visible = drawerAuthPassword.type === "text";
    drawerAuthPassword.type = visible ? "password" : "text";
    drawerAuthPasswordToggle.setAttribute("aria-label", visible ? "Show password" : "Hide password");
    drawerAuthPasswordToggle.title = visible ? "Show password" : "Hide password";
    drawerAuthPasswordToggle.innerHTML = icon(visible ? "eye" : "eye-off", 16);
  });
  drawerAuthForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void signIn();
  });
  selectIdentity(selectedIdentity);
  void refreshAuthentication();
  document.addEventListener("input", (event) => {
    if (siteAdapter.ownsEvent(event)) {
      syncNativePrompt();
    }
  }, true);
  positionStatusPill();

  async function refreshAuthentication() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "GHST_STATUS" });
      setAuthenticated(Boolean(response?.authenticated));
    } catch (_error) {
      setAuthenticated(false);
    }
  }

  function selectIdentity(identityId) {
    if (!managedIdentities[identityId]) return;
    selectedIdentity = identityId;
    const identity = managedIdentities[identityId];
    drawerAuthUsername.value = identity.username;
    drawerAuthPassword.value = identity.password;
    drawerAuthClaims.innerHTML = identity.claims.map((claim) => `<span>${escapeHtml(claim)}</span>`).join("");
    drawerIdentityButtons.forEach((button) => {
      const selected = button.dataset.drawerIdentity === identityId;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
  }

  async function signIn() {
    const username = drawerAuthUsername.value.trim();
    const password = drawerAuthPassword.value;
    if (!username || !password) {
      showAuthError("Email and password are required.");
      return;
    }
    drawerAuthSubmit.disabled = true;
    drawerAuthSubmit.querySelector("span:last-child").textContent = "Signing in...";
    clearAuthError();
    try {
      const response = await chrome.runtime.sendMessage({ type: "GHST_LOGIN", username, password });
      if (!response?.ok) throw new Error(response?.error || "Authentication failed.");
      setAuthenticated(true);
      setStatus("Protected By GHST");
      setInlineMessage("Signed in. Submit the prompt again.");
    } catch (error) {
      showAuthError(error.message || "Authentication failed.");
    } finally {
      drawerAuthSubmit.disabled = false;
      drawerAuthSubmit.querySelector("span:last-child").textContent = "Sign in";
    }
  }

  async function signOut() {
    clearAuthError();
    try {
      await chrome.runtime.sendMessage({ type: "GHST_LOGOUT" });
    } finally {
      setAuthenticated(false);
      setInlineMessage("Signed out. Sign in to submit prompts.");
      setDrawerVisible(true);
    }
  }

  function setAuthenticated(value) {
    authenticated = value;
    const open = drawer.classList.contains("open");
    drawerAuth.hidden = !open || value;
    drawerBody.hidden = !open || !value;
    drawerSignOut.hidden = !value;
    if (!value) setStatus("Sign in required");
  }

  function showAuthRequired() {
    setAuthenticated(false);
    setStatus("Sign in required");
    showAuthError("Sign in to GHST before submitting this prompt.");
  }

  function showAuthError(text) {
    drawerAuthError.hidden = false;
    drawerAuthError.textContent = text;
  }

  function clearAuthError() {
    drawerAuthError.hidden = true;
    drawerAuthError.textContent = "";
  }

  function isAuthenticationError(text) {
    return /sign in|authentication is required|signed identity/i.test(String(text || ""));
  }

  function findAttachedPdfFile() {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    for (const input of inputs) {
      const files = [...(input.files || [])];
      const pdf = files.find((file) => file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")));
      if (pdf) return pdf;
    }
    return null;
  }

  function attachmentSignature(file) {
    if (!file) return "";
    return `${file.name || "document.pdf"}:${file.size || 0}:${file.lastModified || 0}`;
  }

  async function encodeFileBase64(file) {
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  async function currentAttachmentPayload() {
    const file = findAttachedPdfFile();
    if (!file) return null;
    return {
      file,
      signature: attachmentSignature(file),
      fileName: file.name || "document.pdf",
      fileBase64: await encodeFileBase64(file),
    };
  }

  async function evaluateCurrentPrompt({ submitAfterAllow, openOnAllow, silent = false, recordHistory = true }) {
    const currentPrompt = syncNativePrompt();
    const attachment = await currentAttachmentPayload();
    if (!currentPrompt && !attachment) {
      if (!silent) {
        setDrawerVisible(true);
        setStatus("Waiting for content");
        setInlineMessage("Type a prompt or attach a PDF first.");
      }
      return null;
    }
    latest = null;
    promptValue = currentPrompt;
    lastAttachmentSignature = attachment?.signature || "";
    reviewSubmitted = false;
    updateReviewButton();
    const requestId = ++validationRequestId;
    if (!silent) {
      setStatus(currentPrompt ? "Evaluating prompt" : "Evaluating PDF");
      setQuickBusy(true);
      setInlineMessage(currentPrompt ? "Evaluating active policy..." : "Reading attached PDF...");
    } else {
      setStatus(currentPrompt ? "Validating prompt" : "Validating PDF");
    }
    try {
      const payload = {
        prompt: currentPrompt,
        purpose: inferPurpose(currentPrompt),
        destination_origin: siteAdapter.destinationOrigin(location),
        session_id: sessionId,
        device_id: "managed-extension-device",
        fileBase64: attachment?.fileBase64 || null,
        fileName: attachment?.fileName || null,
      };
      const response = await chrome.runtime.sendMessage({ type: "GHST_EVALUATE", payload });
      if (!response.ok) throw new Error(response.error);
      if (requestId !== validationRequestId) return null;
      latest = response.data;
      lastValidatedPrompt = currentPrompt;
      if (recordHistory) {
        void recordHistoryEntry(latest.action, latest.message, latest.risk?.level || (attachment ? "Attached PDF" : "ChatGPT prompt"), currentPrompt || attachment?.fileName || "PDF only");
      }
      if (latest.action === "ALLOW" && submitAfterAllow && currentPrompt) {
        await releaseAndSubmit();
        return latest;
      }
      if (latest.action === "ALLOW" && submitAfterAllow && attachment && !currentPrompt) {
        setDrawerVisible(true);
        setStatus("PDF evaluated");
        setInlineMessage("PDF content was evaluated. Attachment-only release is not available in this extension flow.");
        return latest;
      }
      if (!silent) {
        setDrawerVisible(Boolean(openOnAllow) || latest.action !== "ALLOW");
      }
      render(latest);
      return latest;
    } catch (error) {
      if (isAuthenticationError(error.message)) {
        if (silent) {
          setStatus("Sign in required");
          return null;
        }
        setDrawerVisible(true);
        showAuthRequired();
        showSubmitNotification("Sign in required", "Sign in to GHST before submitting this prompt.");
        return null;
      }
      if (!silent) {
        setDrawerVisible(true);
        setStatus("Protected By GHST");
        actionError(error.message);
      } else {
        setStatus("Protected By GHST");
        setInlineMessage("");
      }
      return null;
    } finally {
      if (!silent) setQuickBusy(false);
    }
  }

  function render(result) {
    const risky = result.action !== "ALLOW";
    safeState.hidden = risky;
    riskState.hidden = !risky;
    panelCheck.classList.toggle("risky", risky);
    flow.classList.toggle("compact", risky);
    drawerFoot.classList.toggle("compact", risky);
    if (risky) {
      renderRiskPage(result);
    }
    if (result.action === "ALLOW") {
      setStatus("Protected By GHST");
      setInlineMessage("Safe prompts submit silently through GHST.");
      void updatePopupState({
        risky: false,
        title: "Protection is active",
        message: "Safe prompts submit silently through GHST.",
        action: "ALLOW",
      });
    } else if (result.action === "REVIEW") {
      setStatus("Review required");
      setInlineMessage("");
      void updatePopupState({
        risky: true,
        title: "Review required",
        message: result.message,
        action: "REVIEW",
      });
    } else if (result.action === "BLOCK") {
      setStatus("Blocked");
      setInlineMessage("");
      void updatePopupState({
        risky: true,
        title: "Blocked",
        message: result.message,
        action: "BLOCK",
      });
    } else if (result.action === "REDIRECT") {
      setStatus("Redirect required");
      setInlineMessage("");
      void updatePopupState({
        risky: true,
        title: "Redirect required",
        message: result.message,
        action: "REDIRECT",
      });
    } else if (result.action === "REDACT") {
      setStatus("Redaction required");
      setInlineMessage("");
      void updatePopupState({
        risky: true,
        title: "Redaction required",
        message: result.message,
        action: "REDACT",
      });
    }
  }

  function renderRiskPage(result) {
    const action = normalizeAction(result.action);
    const content = {
      REDACT: {
        status: "Redaction required",
        eyebrow: "Redact",
        title: "Redaction required",
        iconName: "eraser",
        message: "Sensitive values must be replaced before GHST can release this prompt.",
        activeButton: actionRedact,
      },
      REVIEW: {
        status: "Review required",
        eyebrow: "Review",
        title: "Review required",
        iconName: "user-check",
        message: "Held for an authorised reviewer.",
        activeButton: actionReview,
      },
      REDIRECT: {
        status: "Redirect required",
        eyebrow: "Redirect",
        title: "Redirect required",
        iconName: "external-link",
        message: "Use the approved GHST destination for this request.",
        activeButton: actionRedirect,
      },
      BLOCK: {
        status: "Blocked",
        eyebrow: "Blocked",
        title: "Blocked",
        iconName: "ban",
        message: "This prompt cannot be released from the extension.",
        activeButton: actionBlock,
      },
    }[action] || {
      status: "Review required",
      eyebrow: "Review",
      title: "Review required",
      iconName: "triangle-alert",
      message: "Held for additional review.",
      activeButton: actionReview,
    };
    riskState.classList.remove("redact", "review", "redirect", "block");
    riskState.classList.add(action.toLowerCase());
    riskEyebrow.textContent = content.eyebrow;
    riskIcon.innerHTML = icon(content.iconName, 34);
    riskTitle.textContent = content.title;
    riskMessage.textContent = content.message;
    resultPages.forEach((page) => {
      page.hidden = page.dataset.resultPage !== action;
    });
    riskActions.forEach((button) => {
      button.classList.toggle("is-hidden", button !== content.activeButton);
      button.disabled = false;
    });
    actionRedirect.disabled = action === "REDIRECT" && !result.redirect_origin;
    actionBlock.disabled = action === "BLOCK";
    updateReviewButton();
    setStatus(content.status);
  }

  function updateReviewButton() {
    const reviewLabel = actionReview.querySelector("span:last-child");
    const submitted = reviewSubmitted && normalizeAction(latest?.action) === "REVIEW";
    actionReview.disabled = submitted;
    actionReview.classList.toggle("submitted", submitted);
    if (reviewLabel) reviewLabel.textContent = submitted ? "Submitted" : "Submit to reviewer";
  }

  async function releaseAndSubmit() {
    const currentPrompt = syncNativePrompt();
    setStatus("Submitting prompt");
    actionStatus("Verifying exact prompt digest and one-time clearance...");
    const response = await chrome.runtime.sendMessage({
      type: "GHST_RELEASE",
      evaluationId: latest?.evaluation_id,
      prompt: currentPrompt,
      purpose: inferPurpose(currentPrompt),
      destinationOrigin: latest?.destination_origin || siteAdapter.destinationOrigin(location),
      sessionId,
    });
    if (!response.ok) {
      setDrawerVisible(true);
      setStatus("Protected By GHST");
      return actionError(response.error);
    }
    if (!response.data.released) {
      latest = response.data.finalEvaluation;
      setDrawerVisible(true);
      render(latest);
      return;
    }
    latest = response.data.finalEvaluation;
    promptValue = currentPrompt;
    if (!siteAdapter.injectReleased(currentPrompt)) {
      setDrawerVisible(true);
      setStatus("Protected By GHST");
      return actionError("The site adapter is unhealthy; protected release remains disabled.");
    }
    approvedSubmitInProgress = true;
    const sent = await siteAdapter.clickSendControl?.();
    if (!sent) {
      approvedSubmitInProgress = false;
      setDrawerVisible(true);
      setStatus("Protected By GHST");
      return actionError("GHST cleared the prompt, but ChatGPT's send button was not available.");
    }
    setTimeout(() => { approvedSubmitInProgress = false; }, 1500);
    setDrawerVisible(false);
    setStatus("Protected By GHST");
    void updatePopupState({
      risky: false,
      title: "Protection is active",
      message: "Safe prompts submit silently through GHST.",
      action: "ALLOW",
    });
  }

  async function redact() {
    const currentPrompt = syncNativePrompt();
    setInlineMessage("Applying typed placeholders and running the full pipeline...");
    const response = await chrome.runtime.sendMessage({
      type: "GHST_REDACT",
      evaluationId: latest.evaluation_id,
      payload: { prompt: currentPrompt, purpose: inferPurpose(currentPrompt), destination_origin: latest.destination_origin, session_id: sessionId, device_id: "managed-extension-device" },
    });
    if (!response.ok) return setInlineMessage(response.error);
    if (response.data.redacted_text) {
      promptValue = response.data.redacted_text;
      siteAdapter.injectReleased(response.data.redacted_text);
    }
    latest = response.data;
    if (latest.action === "ALLOW") {
      render(latest);
      await releaseAndSubmit();
      return;
    }
    render(latest);
  }

  async function refresh() {
    const response = await chrome.runtime.sendMessage({ type: "GHST_REFRESH", evaluationId: latest.evaluation_id });
    if (!response.ok) return actionError(response.error);
    latest = response.data;
    void recordHistoryEntry(latest.action, latest.message, latest.risk?.level || "ChatGPT prompt", currentPromptValue() || "Prompt refreshed");
    render(latest);
  }

  function currentPromptValue() {
    return siteAdapter.readNativeText?.().trim() || "";
  }

  function syncNativePrompt() {
    const nativeText = siteAdapter.readNativeText?.().trim() || "";
    const attachment = findAttachedPdfFile();
    const nextAttachmentSignature = attachmentSignature(attachment);
    if (nativeText !== lastNativePrompt) {
      lastNativePrompt = nativeText;
      positionStatusPill();
    }
    if ((nativeText && latest && nativeText !== promptValue) || (latest && nextAttachmentSignature !== lastAttachmentSignature)) {
      latest = null;
      lastAttachmentSignature = nextAttachmentSignature;
      lastValidatedPrompt = "";
      reviewSubmitted = false;
      updateReviewButton();
      safeState.hidden = false;
      riskState.hidden = true;
      setInlineMessage(nextAttachmentSignature && !nativeText ? "Attachment updated. GHST will evaluate on submit." : "Prompt updated. GHST will evaluate on submit.");
      setStatus("Protected By GHST");
    } else if (!nativeText && !latest) {
      lastValidatedPrompt = "";
      lastAttachmentSignature = nextAttachmentSignature;
      reviewSubmitted = false;
      updateReviewButton();
      setStatus("Protected By GHST");
    }
    return currentPromptValue();
  }

  function intercept(event, message) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showSubmitNotification("Submission stopped", message);
    syncNativePrompt();
    evaluateCurrentPrompt({ submitAfterAllow: true, openOnAllow: false });
  }

  document.addEventListener("submit", (event) => {
    if (!approvedSubmitInProgress) intercept(event, "Native submission was intercepted. GHST is evaluating first.");
  }, true);
  document.addEventListener("click", (event) => {
    if (siteAdapter.isSendControl(event.target) && !approvedSubmitInProgress) intercept(event, "The native send control is disabled until GHST authorises the exact content.");
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && siteAdapter.ownsEvent(event) && !approvedSubmitInProgress) {
      intercept(event, "Keyboard submission was intercepted pending governance.");
    }
  }, true);

  function renderAdapterHealth() {
    const health = siteAdapter.health();
    if (health.healthy) {
      if (adapterHealthMessageActive && !latest) setInlineMessage("");
      adapterHealthMessageActive = false;
      syncNativePrompt();
      return true;
    }
    adapterHealthMessageActive = true;
    setDrawerVisible(true);
    setStatus("Protected By GHST");
    void updatePopupState({
      risky: false,
      title: "Protection is active",
      message: "Monitoring this ChatGPT tab.",
      action: "ALLOW",
    });
    setInlineMessage(`Site adapter degraded: ${health.reason}. Protected release is disabled until the supported composer appears.`);
    return false;
  }

  async function updatePopupState(current) {
    const stored = await chrome.storage.local.get([popupStateKey]);
    const previous = stored[popupStateKey] || { history: [] };
    const nextState = {
      current: {
        risky: Boolean(current.risky),
        title: current.title || "Protection is active",
        message: current.message || "Monitoring this ChatGPT tab.",
        action: current.action || "ALLOW",
      },
      history: Array.isArray(previous.history) ? previous.history.slice(0, historyLimit) : [],
    };
    await chrome.storage.local.set({ [popupStateKey]: nextState });
    renderDrawerState(nextState);
  }

  async function recordHistoryEntry(action, message, title, prompt) {
    const stored = await chrome.storage.local.get([popupStateKey]);
    const previous = stored[popupStateKey] || { history: [] };
    const history = Array.isArray(previous.history) ? previous.history : [];
    const nextEntry = {
      action,
      message,
      title,
      prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    const nextState = {
      current: previous.current || {
        risky: false,
        title: "Protection is active",
        message: "Monitoring this ChatGPT tab.",
        action: "ALLOW",
      },
      history: [nextEntry, ...history].slice(0, historyLimit),
    };
    await chrome.storage.local.set({ [popupStateKey]: nextState });
    renderDrawerState(nextState);
  }

  if (!renderAdapterHealth()) {
    let attempts = 0;
    const healthRetry = setInterval(() => {
      attempts += 1;
      if (renderAdapterHealth() || attempts >= 20) clearInterval(healthRetry);
    }, 500);
  }

  function positionStatusPill() {
    const composer = siteAdapter.findNativeComposer?.();
    if (!composer || !statusPill) return;
    const frame = siteAdapter.findComposerFrame?.() || composer;
    const frameRect = frame.getBoundingClientRect();
    const pillWidth = statusPill.offsetWidth || 148;
    const pillHeight = statusPill.offsetHeight || 32;
    const top = Math.max(12, frameRect.top - pillHeight - 10);
    const maxRight = Math.max(12, window.innerWidth - pillWidth - 12);
    const right = Math.min(maxRight, Math.max(8, window.innerWidth - frameRect.right - 40));
    statusPill.style.top = `${top}px`;
    statusPill.style.right = `${right}px`;
  }

  function setDrawerVisible(visible) {
    drawer.classList.toggle("open", visible);
    drawerBody.hidden = !visible || !authenticated;
    drawerAuth.hidden = !visible || authenticated;
    drawerToggle.classList.toggle("hidden", visible);
    drawerToggle.setAttribute("aria-hidden", String(visible));
    drawerToggle.setAttribute("tabindex", visible ? "-1" : "0");
    drawerToggle.setAttribute("aria-label", "Open GHST menu");
    drawerToggle.title = "Open GHST menu";
    drawerToggle.innerHTML = `<img src="${logoUrl}" alt="">`;
    if (visible) {
      positionStatusPill();
      void refreshAuthentication();
    }
  }

  function setQuickBusy(disabled) {
    drawerToggle.disabled = disabled;
    drawerToggle.innerHTML = disabled ? icon("refresh-cw", 15) : `<img src="${logoUrl}" alt="">`;
  }

  function setStatus(text) {
    if (statusLabel) statusLabel.textContent = text;
  }

  function setInlineMessage(text) {
    inlineMessage.textContent = text || "";
  }

  function actionError(text) {
    showSubmitNotification("Submission failed", text);
    setInlineMessage(`${text} No content was released.`);
  }

  function actionStatus(text) {
    setInlineMessage(text);
  }

  function showSubmitNotification(title, text) {
    if (!submitNotice || !submitNoticeTitle || !submitNoticeText) return;
    submitNoticeTitle.textContent = title || "Submission stopped";
    submitNoticeText.textContent = text || "GHST needs attention before this prompt can be released.";
    submitNotice.classList.add("show");
    if (notificationTimer) clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
      submitNotice.classList.remove("show");
    }, 3200);
  }

  function setActiveTab(tab) {
    const checkActive = tab === "check";
    tabCheck.classList.toggle("active", checkActive);
    tabHistory.classList.toggle("active", !checkActive);
    tabCheck.setAttribute("aria-selected", String(checkActive));
    tabHistory.setAttribute("aria-selected", String(!checkActive));
    panelCheck.hidden = !checkActive;
    panelHistory.hidden = checkActive;
  }

  function renderDrawerState(state) {
    latestDrawerState = state || { current: null, history: [] };
    const history = Array.isArray(latestDrawerState.history) ? latestDrawerState.history : [];
    historyCount.textContent = String(history.length);
    renderHistoryFilters(history);
    renderHistory(history);
  }

  function renderHistoryFilters(history) {
    if (!historyFilters) return;
    const counts = Object.fromEntries(historyFiltersList.map((filter) => [filter, 0]));
    counts.ALL = history.length;
    for (const item of history) {
      const action = normalizeAction(item.action);
      counts[action] = (counts[action] || 0) + 1;
    }
    historyFilters.innerHTML = historyFiltersList.map((filter) => (
      `<button type="button" class="history-filter${selectedHistoryFilter === filter ? " active" : ""}" data-history-filter="${filter}">${escapeHtml(filter === "ALL" ? `All ${counts.ALL}` : `${filter} ${counts[filter] || 0}`)}</button>`
    )).join("");
    [...historyFilters.querySelectorAll("[data-history-filter]")].forEach((button) => {
      button.addEventListener("click", () => {
        selectedHistoryFilter = button.dataset.historyFilter || "ALL";
        renderDrawerState(latestDrawerState);
      });
    });
  }

  function renderHistory(history) {
    const filteredHistory = selectedHistoryFilter === "ALL"
      ? history
      : history.filter((item) => normalizeAction(item.action) === selectedHistoryFilter);
    if (!history.length) {
      historyList.innerHTML = `<div class="history-empty">${icon("history",24)}<span>No recent GHST checks.</span></div>`;
      return;
    }
    if (!filteredHistory.length) {
      historyList.innerHTML = `<div class="history-empty">${icon("history",24)}<span>No ${escapeHtml(selectedHistoryFilter.toLowerCase())} history yet.</span></div>`;
      return;
    }
    historyList.innerHTML = filteredHistory.map((item) => {
      const action = normalizeAction(item.action);
      return `<article class="history-item"><div class="history-top"><span class="history-title">${escapeHtml(item.title || "ChatGPT prompt")}</span><span class="history-badge ${action.toLowerCase()}">${action}</span></div><div class="history-meta">${escapeHtml(item.timestamp || "Just now")}</div><div class="history-message">${escapeHtml(item.message || "")}</div><div class="history-prompt">${escapeHtml(item.prompt || "No prompt captured.")}</div></article>`;
    }).join("");
  }

  function normalizeAction(action) {
    if (["ALLOW", "REDACT", "REVIEW", "REDIRECT", "BLOCK"].includes(action)) return action;
    return "ALLOW";
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value || "");
    return div.innerHTML;
  }

  window.addEventListener("resize", positionStatusPill);
  window.addEventListener("scroll", positionStatusPill, true);
  positionTimer = setInterval(positionStatusPill, 1000);
})();
  function inferPurpose(prompt) {
    const text = String(prompt || "").toLowerCase();
    if (/(contract|clause|legal|law|nda|terms|compliance|regulation)/.test(text)) return "Legal research";
    if (/(revenue|budget|invoice|expense|forecast|financial|profit|loss|balance sheet)/.test(text)) return "Financial analysis";
    if (/(hire|hiring|candidate|resume|cv|interview|recruit)/.test(text)) return "Hiring decision";
    if (/(terminate|firing|dismiss|layoff|disciplinary)/.test(text)) return "Terminate employee";
    if (/(medical|diagnosis|patient|treatment|prescription|symptom|health)/.test(text)) return "Medical advice";
    if (/(credit|loan|underwriting|approve credit|reject credit|credit score)/.test(text)) return "Credit decision";
    return "General productivity";
  }
