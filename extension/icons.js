/* Lucide-compatible inline icons for the unbundled Manifest V3 surfaces. */
(() => {
  const paths = {
    "shield-check": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.68-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    "log-in": '<path d="m10 17 5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>',
    "log-out": '<path d="m9 17-5-5 5-5"/><path d="M4 12h12"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/>',
    "minimize-2": '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
    "scan-search": '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="11" cy="11" r="4"/><path d="m16 16-2-2"/>',
    "send": '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    "refresh-cw": '<path d="M21 12a9 9 0 0 0-15-6.7L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/><path d="M21 21v-5h-5"/>',
    "lock-keyhole": '<circle cx="12" cy="16" r="1"/><rect width="18" height="12" x="3" y="10" rx="1"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/>',
    "alert-triangle": '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    "user-round": '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    "file-text": '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8"/><path d="M8 17h8"/>',
    "check-circle": '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m9 11 3 3L22 4"/>',
    "bot": '<rect width="18" height="10" x="3" y="11" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" x2="8" y1="16" y2="16"/><line x1="16" x2="16" y1="16" y2="16"/>',
    "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    "eye": '<path d="M2.06 12.35a1 1 0 0 1 0-.7C3.46 8.1 7.27 5 12 5s8.54 3.1 9.94 6.65a1 1 0 0 1 0 .7C20.54 15.9 16.73 19 12 19s-8.54-3.1-9.94-6.65Z"/><circle cx="12" cy="12" r="3"/>',
    "eye-off": '<path d="m3 3 18 18"/><path d="M10.58 10.58a2 2 0 0 0 2.83 2.83"/><path d="M9.88 5.09A10.94 10.94 0 0 1 12 5c4.73 0 8.54 3.1 9.94 6.65a1 1 0 0 1 0 .7 10.97 10.97 0 0 1-4.17 4.63"/><path d="M6.61 6.61A10.97 10.97 0 0 0 2.06 11.3a1 1 0 0 0 0 .7C3.46 15.9 7.27 19 12 19a10.97 10.97 0 0 0 3.39-.54"/>'
  };
  function icon(name, size = 16, label = "") {
    const body = paths[name] || paths["shield-check"];
    const accessibility = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
    return `<svg class="lucide lucide-${name}" ${accessibility} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }
  function hydrate(container = document) {
    container.querySelectorAll("[data-lucide]").forEach((node) => {
      node.innerHTML = icon(node.dataset.lucide, Number(node.dataset.size || 16));
    });
  }
  globalThis.GHSTIcons = Object.freeze({ icon, hydrate });
})();
