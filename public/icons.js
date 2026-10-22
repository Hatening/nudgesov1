/* NudgeSo shared linear icon set.
 * window.NS_ICON(name, size) -> inline SVG string.
 * All icons: viewBox 0 0 24 24, stroke=currentColor, stroke-width 2,
 * linecap/linejoin round. Use stroke (not fill) for a soft, friendly look.
 * Reserved brand logo helper: window.NS_LOGO(size, className).
 */
(function () {
  // Each path/shape drawn on a 24x24 grid.
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-6h5v6"/>',
    messages: '<path d="M4 5h16v11H9l-5 4V5z"/>',
    inbox: '<path d="M4 13l3-8h10l3 8v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6z"/><path d="M4 13h5l1.5 2h3L15 13h5"/>',
    shop: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0"/><path d="M5 11v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/><path d="M9 20v-5h6v5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2a2.8 2.8 0 0 1 5.5.9c0 1.8-2.7 2.3-2.7 3.9"/><path d="M12 17.2h.01"/>',
    assistant: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M18.5 15.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3z"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/>',
    glossary: '<path d="M6 4h11a2 2 0 0 1 2 2v14l-3-2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M9 9h6M9 13h4"/>',
    channels: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8M12 18v3"/><path d="M7 10l4 2.5L7 15M12.5 15H16"/>',
    languages: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/>',
    analytics: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3M20 16v-7"/>',
    tests: '<path d="M9 3h6"/><path d="M10 3v5.2L5.6 16a2 2 0 0 0 1.8 3h9.2a2 2 0 0 0 1.8-3L14 8.2V3"/><path d="M8 14h8"/>',
    growth: '<path d="M4 17l5-5 3.5 3.5L18 10"/><path d="M14 10h4v4"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M4.2 7l2.1 1.2M17.7 15.8l2.1 1.2M4.2 17l2.1-1.2M17.7 8.2l2.1-1.2"/>',
    send: '<path d="M4 12l16-8-6.5 16-2.5-7.5L4 12z"/>',
    upload: '<path d="M12 16V5"/><path d="M7.5 9L12 4.5 16.5 9"/><path d="M5 19h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V13"/><path d="M12 16.5h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    paperclip: '<path d="M20 11.5l-7.5 7.5a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14s1.2 2 3.5 2 3.5-2 3.5-2"/><path d="M9 9.5h.01M15 9.5h.01"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    'chevron-down': '<path d="M6 9l6 6 6-6"/>',
    'chevron-right': '<path d="M9 6l6 6-6 6"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14-4.5L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4.5L20 15"/><path d="M20 20v-5h-5"/>',
    edit: '<path d="M14 5l5 5L8.5 20.5 4 21l.5-4.5L14 5z"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 11.5l2 2 4-4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/>',
    dots: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
    download: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
    'file-icon': '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>',
    chat: '<path d="M4 5h16v11H9l-5 4V5z"/><path d="M8.5 10h7M8.5 13h4"/>'
  };

  function NS_ICON(name, size) {
    const body = P[name] || P.help;
    const s = size || 22;
    return `<svg class="ns-icon" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  // Brand mark: the smile-hug logo, stroke + eyes driven by currentColor.
  function NS_LOGO(size, cls) {
    const s = size || 34;
    return `<svg class="ns-logo ${cls || ''}" width="${s}" height="${s}" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="32" cy="18" r="7.5" fill="currentColor" stroke="none"/><circle cx="68" cy="18" r="7.5" fill="currentColor" stroke="none"/><path d="M34 44 A17 17 0 0 0 66 44" stroke-width="9"/><path d="M11 32 C 2 50, 8 74, 34 84" stroke-width="11"/><path d="M89 32 C 98 50, 92 74, 66 84" stroke-width="11"/></svg>`;
  }

  window.NS_ICON = NS_ICON;
  window.NS_LOGO = NS_LOGO;
  window.NS_ICON_NAMES = Object.keys(P);
})();
