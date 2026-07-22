const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

global.document = { querySelector: () => null };
global.Event = class Event { constructor(type) { this.type = type; } };
require("./adapters.js");
require("./icons.js");

test("resolves only explicitly supported origins", () => {
  assert.equal(global.GHSTSiteAdapters.resolve({ hostname: "example.com", pathname: "/" }), null);
  assert.equal(global.GHSTSiteAdapters.resolve({ hostname: "chatgpt.com", pathname: "/" }).id, "chatgpt-web");
  assert.equal(global.GHSTSiteAdapters.resolve({ hostname: "localhost", pathname: "/ai-sandbox" }).id, "ghst-sandbox");
});

test("fails closed when the supported DOM contract is absent", () => {
  const adapter = global.GHSTSiteAdapters.resolve({ hostname: "chatgpt.com", pathname: "/" });
  assert.deepEqual(adapter.health(), {
    healthy: false,
    adapter: "chatgpt-web",
    version: "1.2.0",
    reason: "SUPPORTED_DOM_CONTRACT_NOT_FOUND",
  });
  assert.equal(adapter.injectReleased("never released"), false);
});

test("injects released text only through a resolved composer", () => {
  const events = [];
  const composer = { value: "", dispatchEvent: (event) => events.push(event.type), contains: () => false };
  global.document.querySelector = (selector) => selector === "#ghst-native-ai-composer" ? composer : null;
  const adapter = global.GHSTSiteAdapters.resolve({ hostname: "localhost", pathname: "/ai-sandbox" });
  assert.equal(adapter.injectReleased("policy-cleared"), true);
  assert.equal(composer.value, "policy-cleared");
  assert.deepEqual(events, ["input", "change"]);
});

test("recognises richer ChatGPT contenteditable composers", () => {
  const events = [];
  const composer = {
    textContent: "typed in chatbar",
    focus: () => events.push("focus"),
    dispatchEvent: (event) => events.push(event.type),
    contains: () => false,
  };
  global.document.querySelector = (selector) => selector === "div.ProseMirror[contenteditable='true']" ? composer : null;
  const adapter = global.GHSTSiteAdapters.resolve({ hostname: "chatgpt.com", pathname: "/" });
  assert.equal(adapter.health().healthy, true);
  assert.equal(adapter.readNativeText(), "typed in chatbar");
  assert.equal(adapter.injectReleased("policy-cleared"), true);
  assert.equal(composer.textContent, "policy-cleared");
  assert.deepEqual(events, ["focus", "input", "change"]);
});

test("resolves the outer composer frame for badge positioning", () => {
  const frame = {};
  const composer = {
    textContent: "",
    closest: (selector) => selector.includes("form") ? frame : null,
  };
  global.document.querySelector = (selector) => selector === "#prompt-textarea" ? composer : null;
  const adapter = global.GHSTSiteAdapters.resolve({ hostname: "chatgpt.com", pathname: "/" });
  assert.equal(adapter.findComposerFrame(), frame);
});

test("clicks only an enabled supported send control", async () => {
  const events = [];
  const send = {
    disabled: false,
    getAttribute: () => null,
    click: () => events.push("click"),
  };
  global.document.querySelector = (selector) => selector === "button[data-testid='send-button']" ? send : null;
  const adapter = global.GHSTSiteAdapters.resolve({ hostname: "chatgpt.com", pathname: "/" });
  assert.equal(await adapter.clickSendControl(), true);
  assert.deepEqual(events, ["click"]);
});

test("can observe a visible disabled send control while waiting for React to enable it", () => {
  const send = {
    disabled: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 24, height: 24 }),
  };
  global.document.querySelector = (selector) => selector === "button[data-testid='send-button']" ? send : null;
  const adapter = global.GHSTSiteAdapters.resolve({ hostname: "chatgpt.com", pathname: "/" });
  assert.equal(adapter.findNativeSendControl(), null);
  assert.equal(adapter.findNativeSendControl({ includeDisabled: true }), send);
});

test("renders the local Lucide icon contract without remote assets", () => {
  const shield = global.GHSTIcons.icon("shield-check", 18);
  assert.match(shield, /<svg class="lucide lucide-shield-check"/);
  assert.match(shield, /stroke="currentColor"/);
  assert.doesNotMatch(shield, /https?:\/\//);
});

test("loads Lucide icons before the protected composer", () => {
  const manifest = JSON.parse(fs.readFileSync(`${__dirname}/manifest.json`, "utf8"));
  assert.deepEqual(manifest.content_scripts[0].js, ["adapters.js", "icons.js", "content.js"]);
  const popup = fs.readFileSync(`${__dirname}/popup.html`, "utf8");
  assert.ok(popup.indexOf('src="icons.js"') < popup.indexOf('src="popup.js"'));
});
