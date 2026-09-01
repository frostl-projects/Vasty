(() => {
  'use strict';

  const { log: compatLog, registerModule } = window.Vasty;
  const { stripQueryAndHash, nodeLabel, rectLabel } = window.Vasty.utils;

  registerModule('VPAID compat');
  compatLog('vasty:compat-ready', 'VPAID compatibility module ready');

  function timeLabel(value) {
    return Number.isFinite(value) ? value.toFixed(2) : '—';
  }

  function vpaidVideoState(video) {
    if (!video) return 'video=missing';

    let style = null;
    let rect = null;
    try { style = getComputedStyle(video); } catch (_) {}
    try { rect = video.getBoundingClientRect(); } catch (_) {}

    let mediaError = '—';
    try {
      if (video.error) mediaError = `${video.error.code}:${video.error.message || ''}`;
    } catch (_) {}

    const source = stripQueryAndHash(video.currentSrc || video.src || video.querySelector?.('source')?.src || '') || '—';
    return [
      `video=${nodeLabel(video)}`,
      `src=${source}`,
      `time=${timeLabel(video.currentTime)}/${timeLabel(video.duration)}`,
      `paused=${!!video.paused}`,
      `ended=${!!video.ended}`,
      `ready=${Number(video.readyState ?? -1)}`,
      `network=${Number(video.networkState ?? -1)}`,
      `intrinsic=${Number(video.videoWidth || 0)}x${Number(video.videoHeight || 0)}`,
      `rect=${rectLabel(rect)}`,
      `display=${style?.display || '—'}`,
      `visibility=${style?.visibility || '—'}`,
      `opacity=${style?.opacity || '—'}`,
      `error=${mediaError}`
    ].join(' ');
  }

  function instrumentVpaidVideo(video) {
    if (!video || video.dataset.vastyVideoDiagnostics) return;
    video.dataset.vastyVideoDiagnostics = '1';
    compatLog('vasty:vpaid-video-found', vpaidVideoState(video));

    for (const eventName of [
      'loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'waiting',
      'stalled', 'pause', 'ended', 'emptied', 'error'
    ]) {
      video.addEventListener(eventName, () => {
        compatLog(
          'vasty:vpaid-video-event',
          `event=${eventName} ${vpaidVideoState(video)}`,
          eventName === 'error' ? 'error' : ''
        );
      });
    }

    for (const delay of [500, 2500, 5000]) {
      window.setTimeout(() => {
        if (video.isConnected) compatLog('vasty:vpaid-video-state', `after=${delay}ms ${vpaidVideoState(video)}`);
      }, delay);
    }
  }

  function instrumentVpaidVideos(player) {
    const slot = player?.querySelector('.rmp-vpaid-container');
    if (!slot) return;
    for (const video of slot.querySelectorAll('video')) instrumentVpaidVideo(video);
  }

  function executionFrame(player) {
    const frame = player?.querySelector('#vpaid-frame');
    if (!frame?.contentWindow?.document?.body) return null;
    return frame;
  }

  function remoteKeyForNode(node) {
    if (typeof node?.getAttribute !== 'function') return null;

    const explicitCode = Number(node.getAttribute('data-key-code') || node.getAttribute('data-keycode') || '');
    if (explicitCode === 13) return [13, 'Enter', 'explicit-enter'];
    if (explicitCode === 37) return [37, 'ArrowLeft', 'explicit-left'];
    if (explicitCode === 39) return [39, 'ArrowRight', 'explicit-right'];

    const attributes = [
      node.getAttribute('id'),
      node.getAttribute('class'),
      node.getAttribute('role'),
      node.getAttribute('aria-label'),
      node.getAttribute('title'),
      node.getAttribute('data-action'),
      node.getAttribute('data-key')
    ].filter(Boolean).join(' ').toLowerCase();

    const hasWord = (words) => words.some((word) => new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, 'i').test(attributes));
    if (hasWord(['left', 'prev', 'previous', 'back'])) return [37, 'ArrowLeft', 'semantic-left'];
    if (hasWord(['right', 'next', 'forward'])) return [39, 'ArrowRight', 'semantic-right'];
    if (/(activation|activate|select|enter|confirm|\bok\b)/i.test(attributes)) return [13, 'Enter', 'semantic-activate'];
    return null;
  }

  function remoteKeyForEvent(event) {
    let path = [];
    try { path = event.composedPath(); } catch (_) { path = [event.target]; }
    for (const node of path) {
      const mapped = remoteKeyForNode(node);
      if (mapped) return mapped;
    }
    return null;
  }

  function hasRemoteLikeControls(slot) {
    const candidates = slot.querySelectorAll('[id],[class],[role],[aria-label],[title],[data-action],[data-key],[data-key-code],[data-keycode]');
    for (const node of candidates) {
      if (remoteKeyForNode(node)) return true;
    }
    return false;
  }

  function prepareExecutionFrame(frame) {
    if (!frame?.contentWindow?.document?.body) return false;

    Object.assign(frame.style, {
      visibility: 'visible',
      opacity: '0',
      position: 'absolute',
      left: '-10000px',
      top: '0',
      width: '1px',
      height: '1px',
      pointerEvents: 'none'
    });
    frame.tabIndex = -1;
    frame.contentWindow.document.body.tabIndex = -1;

    if (!frame.dataset.vastyExecutionFramePrepared) {
      frame.dataset.vastyExecutionFramePrepared = '1';
      compatLog('vasty:vpaid-input-realm-prepared', 'execution iframe made focusable offscreen');
    }
    return true;
  }

  function focusExecutionFrame(frame) {
    if (!prepareExecutionFrame(frame)) return false;
    const win = frame.contentWindow;
    const body = win.document.body;

    try { frame.focus({ preventScroll: true }); } catch (_) { try { frame.focus(); } catch (_) {} }
    try { win.focus(); } catch (_) {}
    try { body.focus({ preventScroll: true }); } catch (_) { try { body.focus(); } catch (_) {} }

    const active = win.document.activeElement === body
      ? 'body'
      : (win.document.activeElement?.tagName?.toLowerCase?.() || 'unknown');
    compatLog('vasty:vpaid-input-focus', `frameActive=${document.activeElement === frame} realmActive=${active}`);
    return true;
  }

  function dispatchRemoteKey(frame, keyCode, key, reason, sourceTrusted) {
    if (!focusExecutionFrame(frame)) return;
    const win = frame.contentWindow;
    const body = win.document.body;

    const make = (type) => {
      const event = new win.KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true });
      try {
        Object.defineProperties(event, {
          keyCode: { get: () => keyCode },
          which: { get: () => keyCode },
          charCode: { get: () => 0 }
        });
      } catch (_) {}
      return event;
    };

    compatLog('vasty:vpaid-key-dispatch', `reason=${reason} keyCode=${keyCode} sourceTrusted=${sourceTrusted === true}`);
    try {
      body.dispatchEvent(make('keydown'));
      body.dispatchEvent(make('keyup'));
    } catch (error) {
      compatLog('vasty:vpaid-key-dispatch-error', error?.message || String(error), 'error');
    }
  }

  function instrumentRemoteInputBridge(player) {
    const slot = player.querySelector('.rmp-vpaid-container');
    const frame = executionFrame(player);
    if (!slot || !frame || !hasRemoteLikeControls(slot)) return;

    prepareExecutionFrame(frame);
    if (slot.dataset.vastyRemoteInputBridge) return;
    slot.dataset.vastyRemoteInputBridge = '1';
    compatLog('vasty:vpaid-remote-input-ready', 'semantic remote controls bridged to VPAID execution iframe', 'success');

    slot.addEventListener('click', (event) => {
      const mapped = remoteKeyForEvent(event);
      const currentFrame = executionFrame(player);
      if (!mapped || !currentFrame) return;
      dispatchRemoteKey(currentFrame, mapped[0], mapped[1], mapped[2], event.isTrusted);
    });
  }

  function instrument() {
    const player = document.getElementById('vast-player');
    if (!player) return;
    instrumentVpaidVideos(player);
    instrumentRemoteInputBridge(player);
  }

  const player = document.getElementById('vast-player');
  if (player) {
    new MutationObserver(instrument).observe(player, { childList: true, subtree: true });
    instrument();
  }

})();
