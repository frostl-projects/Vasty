(() => {
  'use strict';

  // The cache key in index.html is also the release version for all local modules.
  const version = new URL(document.currentScript.src).searchParams.get('v') || 'dev';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
  }

  function stripQueryAndHash(value) {
    const text = String(value ?? '').trim();
    if (/^(https?:)?\/\//i.test(text)) {
      try {
        const url = new URL(text, 'https://vasty.invalid');
        return text.startsWith('//') ? `//${url.host}${url.pathname}` : `${url.origin}${url.pathname}`;
      } catch (_) {
        // Even malformed URLs must not leak their query in diagnostic errors.
      }
    }
    return text.split(/[?#]/, 1)[0];
  }

  function sanitizeRuntimeText(value) {
    return String(value ?? '').replace(/(?:https?:)?\/\/[^\s<>'"\])]+/gi, stripQueryAndHash);
  }

  function rectOf(node) {
    try { return node.getBoundingClientRect(); } catch (_) { return null; }
  }

  function rectLabel(nodeOrRect) {
    const rect = typeof nodeOrRect?.getBoundingClientRect === 'function' ? rectOf(nodeOrRect) : nodeOrRect;
    if (!rect) return '—';
    return `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}`;
  }

  function nodeLabel(node) {
    if (!node) return '—';
    const tag = String(node.tagName || node.nodeName || 'unknown').toLowerCase();
    const id = node.getAttribute?.('id') || '';
    const cls = (node.getAttribute?.('class') || '').trim().replace(/\s+/g, '.').slice(0, 100);
    return `${tag}${id ? `#${id}` : ''}${cls ? `.${cls}` : ''}`;
  }

  function directChildContaining(root, descendant) {
    let node = descendant;
    while (node?.parentElement && node.parentElement !== root) node = node.parentElement;
    return node?.parentElement === root ? node : null;
  }

  window.Vasty = {
    version,
    utils: Object.freeze({ escapeHtml, stripQueryAndHash, sanitizeRuntimeText, rectOf, rectLabel, nodeLabel, directChildContaining })
  };
})();
