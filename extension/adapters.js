(() => {
  class GHSTSiteAdapterV1 {
    constructor(id, matches, composerSelectors, sendSelectors = []) {
      this.version = "1.2.0";
      this.id = id;
      this.matches = matches;
      this.composerSelectors = composerSelectors;
      this.sendSelectors = sendSelectors;
    }
    canHandle(location) { return this.matches(location); }
    destinationOrigin(location) { return this.id === "ghst-sandbox" ? `${location.origin}/ai-sandbox` : location.origin; }
    isUsableNode(node) {
      if (!node) return false;
      const ariaHidden = node.getAttribute?.("aria-hidden");
      if (ariaHidden === "true") return false;
      if ("disabled" in node && node.disabled) return false;
      const style = globalThis.getComputedStyle?.(node);
      if (style?.display === "none" || style?.visibility === "hidden") return false;
      const rect = node.getBoundingClientRect?.();
      return !rect || rect.width > 0 || rect.height > 0;
    }
    isVisibleNode(node) {
      if (!node || node.getAttribute?.("aria-hidden") === "true") return false;
      const style = globalThis.getComputedStyle?.(node);
      if (style?.display === "none" || style?.visibility === "hidden") return false;
      const rect = node.getBoundingClientRect?.();
      return !rect || rect.width > 0 || rect.height > 0;
    }
    findNativeComposer() {
      for (const selector of this.composerSelectors) {
        const nodes = typeof document.querySelectorAll === "function"
          ? document.querySelectorAll(selector)
          : [document.querySelector(selector)].filter(Boolean);
        for (const node of nodes) {
          if (this.isUsableNode(node)) return node;
        }
      }
      return null;
    }
    findComposerFrame() {
      const composer = this.findNativeComposer();
      if (!composer) return null;
      const directFrame = composer.closest?.("form, [data-testid='composer-input'], [class*='composer']");
      if (directFrame) return directFrame;

      let node = composer.parentElement;
      let best = null;
      for (let depth = 0; node && depth < 6; depth += 1) {
        const rect = node.getBoundingClientRect?.();
        if (rect?.width > 240 && rect?.height > 40) best = node;
        node = node.parentElement;
      }
      return best || composer;
    }
    readNativeText() {
      const node = this.findNativeComposer();
      if (!node) return "";
      if ("value" in node) return node.value;
      return node.innerText || node.textContent || "";
    }
    injectReleased(text) {
      const node = this.findNativeComposer();
      if (!node) return false;
      if ("value" in node) {
        const prototype = Object.getPrototypeOf(node);
        const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "value");
        if (descriptor?.set) descriptor.set.call(node, text);
        else node.value = text;
      } else {
        node.focus?.();
        const selection = globalThis.getSelection?.();
        if (selection && document.createRange) {
          const range = document.createRange();
          range.selectNodeContents(node);
          range.deleteContents();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        if (!document.execCommand || !document.execCommand("insertText", false, text)) {
          node.textContent = text;
        }
      }
      const InputEventClass = globalThis.InputEvent || globalThis.Event;
      node.dispatchEvent(new InputEventClass("input", { bubbles: true, inputType: "insertText", data: text }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    ownsEvent(event) {
      const composer = this.findNativeComposer();
      return Boolean(composer && (event.target === composer || composer.contains?.(event.target)));
    }
    isSendControl(node) {
      return this.sendSelectors.some((selector) => node?.closest?.(selector))
        || Boolean(node?.closest?.("button[data-testid*='send'], button[aria-label*='Send'], button[aria-label*='send']"));
    }
    findNativeSendControl({ includeDisabled = false } = {}) {
      for (const selector of this.sendSelectors) {
        const nodes = typeof document.querySelectorAll === "function"
          ? document.querySelectorAll(selector)
          : [document.querySelector(selector)].filter(Boolean);
        for (const node of nodes) {
          if (includeDisabled ? this.isVisibleNode(node) : this.isUsableNode(node)) return node;
        }
      }
      const frame = this.findComposerFrame();
      const frameSend = frame?.querySelector?.("button[type='submit'], [data-testid*='send'], button[aria-label*='Send'], button[aria-label*='send']");
      if (includeDisabled ? this.isVisibleNode(frameSend) : this.isUsableNode(frameSend)) return frameSend;
      return null;
    }
    async clickSendControl() {
      let node = this.findNativeSendControl({ includeDisabled: true });
      const enabled = (candidate) => candidate && !candidate.disabled && candidate.getAttribute?.("aria-disabled") !== "true";
      if (node && !enabled(node)) {
        const deadline = Date.now() + 1200;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          node = this.findNativeSendControl({ includeDisabled: true });
          if (enabled(node)) break;
        }
      }
      if (enabled(node)) {
        node.click();
        return true;
      }

      const composer = this.findNativeComposer();
      const frame = this.findComposerFrame();
      const form = composer?.closest?.("form") || frame?.closest?.("form") || frame?.querySelector?.("form");
      if (form?.requestSubmit) {
        form.requestSubmit();
        return true;
      }
      if (composer) {
        composer.focus?.();
        composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        composer.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
        return true;
      }
      return false;
    }
    health() {
      const composer = this.findNativeComposer();
      return {
        healthy: Boolean(composer), adapter: this.id, version: this.version,
        reason: composer ? "COMPOSER_RESOLVED" : "SUPPORTED_DOM_CONTRACT_NOT_FOUND",
      };
    }
  }

  const adapters = [
    new GHSTSiteAdapterV1(
      "ghst-sandbox",
      (location) => location.hostname === "localhost" && location.pathname.startsWith("/ai-sandbox"),
      ["#ghst-native-ai-composer"],
      ["#ghst-native-ai-send"],
    ),
    new GHSTSiteAdapterV1(
      "chatgpt-web",
      (location) => location.hostname === "chatgpt.com" || location.hostname === "chat.openai.com",
      [
        "#prompt-textarea",
        "[data-testid='composer-input'] div[contenteditable='true']",
        "[data-testid='composer-input'] [contenteditable='true']",
        "div.ProseMirror[contenteditable='true']",
        "div[contenteditable='true'][translate='no']",
        "div[contenteditable='true'][data-lexical-editor='true']",
        "form [contenteditable='true'][role='textbox']",
        "textarea[data-testid*='prompt']",
      ],
      ["button[data-testid='send-button']", "button[data-testid*='send']", "button[aria-label*='Send']", "button[aria-label*='send']", "button[type='submit']"],
    ),
  ];
  globalThis.GHSTSiteAdapters = {
    version: "1.2.0",
    resolve(location) { return adapters.find((adapter) => adapter.canHandle(location)) || null; },
    inventory() { return adapters.map((adapter) => ({ id: adapter.id, version: adapter.version })); },
  };
})();
