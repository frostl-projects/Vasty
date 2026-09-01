(() => {
  'use strict';

  const { log, registerModule } = window.Vasty;
  const { rectOf, nodeLabel, directChildContaining } = window.Vasty.utils;
  const writtenStyles = new WeakMap();

  registerModule('VPAID layout compat');
  log('vasty:vpaid-layout-module-ready', 'composite layout module ready', 'success');

  function setStyle(node, styles) {
    if (!node) return;
    let changed = false;
    for (const [name, value] of Object.entries(styles)) {
      if (node.style[name] !== value) {
        node.style[name] = value;
        changed = true;
      }
    }
    if (changed) writtenStyles.set(node, node.getAttribute('style'));
  }

  function siblingBackgroundImage(content, videoBranch) {
    for (const image of content.querySelectorAll('img')) {
      if (!videoBranch.contains(image)) return image;
    }
    return null;
  }

  function likelyVideoLayer(node) {
    if (!node) return false;
    let style = null;
    try { style = getComputedStyle(node); } catch (_) {}

    if (style?.position === 'absolute') return true;

    const inline = node.style || {};
    if (inline.position === 'absolute') return true;

    const width = (inline.width || '').trim();
    const height = (inline.height || '').trim();
    const left = (inline.left || '').trim();
    const top = (inline.top || '').trim();

    return width === '100%' && height === '100%' &&
      (left === '' || left === '0px' || left === '0%') &&
      (top === '' || top === '0px' || top === '0%');
  }

  function findCompositeVideoLayout(slot) {
    for (const video of slot.querySelectorAll('video')) {
      const plyr = video.closest('.plyr');
      if (!plyr) continue;
      let content = video.parentElement;

      while (content && content !== slot) {
        const videoBranch = directChildContaining(content, video);
        if (videoBranch) {
          const image = siblingBackgroundImage(content, videoBranch);
          if (image && videoBranch.contains(plyr) && likelyVideoLayer(videoBranch)) {
            const wrapper = content.parentElement && content.parentElement !== slot
              ? content.parentElement
              : content;

            return {
              wrapper,
              content,
              image,
              videoContainer: videoBranch,
              player: video.parentElement,
              plyr,
              plyrWrapper: video.closest?.('.plyr__video-wrapper') || null,
              video
            };
          }
        }
        content = content.parentElement;
      }
    }
    return null;
  }

  function fillHostChain(slot, wrapper) {
    const hosts = [];
    let node = wrapper.parentElement;

    while (node && node !== slot) {
      hosts.push(node);
      node = node.parentElement;
    }
    if (wrapper !== slot && node !== slot) return false;

    const slotPosition = getComputedStyle(slot).position;
    setStyle(slot, {
      position: slotPosition === 'static' ? 'relative' : slotPosition,
      overflow: 'visible'
    });

    for (const host of hosts) {
      setStyle(host, {
        position: 'absolute',
        left: '0px',
        top: '0px',
        right: '0px',
        bottom: '0px',
        width: '100%',
        height: '100%',
        maxWidth: '100%',
        maxHeight: '100%',
        margin: '0px',
        padding: '0px',
        overflow: 'visible',
        transform: 'none',
        translate: 'none',
        boxSizing: 'border-box'
      });
    }
    return true;
  }

  function applyRootSizing(nodes) {
    setStyle(nodes.wrapper, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: '100%',
      height: '100%',
      maxWidth: '100%',
      maxHeight: '100%',
      margin: '0px',
      padding: '0px',
      overflow: 'visible',
      transform: 'none',
      transformOrigin: '0 0',
      boxSizing: 'border-box',
      display: 'block'
    });

    setStyle(nodes.content, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: '100%',
      height: '100%',
      maxWidth: '100%',
      maxHeight: '100%',
      margin: '0px',
      padding: '0px',
      overflow: 'hidden',
      transform: 'none',
      transformOrigin: '0 0',
      boxSizing: 'border-box'
    });

    setStyle(nodes.image, {
      display: 'block',
      width: '100%',
      height: '100%',
      maxWidth: '100%',
      maxHeight: '100%',
      margin: '0px',
      objectFit: 'cover'
    });
  }

  function aspectRatioFor(nodes) {
    if (nodes.video.videoWidth > 0 && nodes.video.videoHeight > 0) {
      return `${nodes.video.videoWidth} / ${nodes.video.videoHeight}`;
    }
    const rect = rectOf(nodes.content);
    if (rect?.width > 0 && rect?.height > 0) return `${rect.width} / ${rect.height}`;
    return '16 / 9';
  }

  function detectCreativeLayoutChange(videoContainer) {
    if (videoContainer.dataset.vastyLayoutChanged === '1') return true;

    const left = (videoContainer.style.left || '').trim();
    const top = (videoContainer.style.top || '').trim();
    const width = (videoContainer.style.width || '').trim();
    const height = (videoContainer.style.height || '').trim();
    const nonZero = (value) => value && value !== '0px' && value !== '0%' && value !== 'auto';

    if (nonZero(left) || nonZero(top) || (width && width !== '100%') || (height && height !== '100%')) {
      videoContainer.dataset.vastyLayoutChanged = '1';
      log('vasty:vpaid-layout-change',
        `width=${width || '—'} height=${height || '—'} left=${left || '—'} top=${top || '—'}`);
      return true;
    }
    return false;
  }

  function refreshDynamicNodes(nodes) {
    nodes.plyr = nodes.video.closest?.('.plyr') || null;
    nodes.plyrWrapper = nodes.video.closest?.('.plyr__video-wrapper') || null;

    if (nodes.plyr) {
      const branch = directChildContaining(nodes.videoContainer, nodes.video);
      if (branch) nodes.player = branch;
    }
    return nodes;
  }

  function applyInnerSizing(nodes) {
    refreshDynamicNodes(nodes);
    const { videoContainer, player, plyr, plyrWrapper, video } = nodes;
    const layoutChanged = videoContainer.dataset.vastyLayoutChanged === '1';
    const aspectRatio = aspectRatioFor(nodes);

    setStyle(videoContainer, {
      position: 'absolute',
      minWidth: '0px',
      minHeight: '0px',
      maxWidth: '100%',
      maxHeight: '100%',
      margin: '0px',
      padding: '0px',
      overflow: 'visible',
      boxSizing: 'border-box',
      transform: 'none',
      transformOrigin: '0 0'
    });

    if (!layoutChanged) {
      setStyle(videoContainer, { left: '0px', top: '0px' });
      if (!videoContainer.dataset.vastyInitialAnchor) {
        videoContainer.dataset.vastyInitialAnchor = '1';
        log('vasty:vpaid-layout-anchor',
          'absolute video layer anchored to 0,0 before creative layout change', 'success');
      }
    }

    setStyle(player, {
      position: 'relative',
      width: '100%',
      height: 'auto',
      maxWidth: '100%',
      minWidth: '0px',
      aspectRatio,
      margin: '0px',
      padding: '0px',
      overflow: 'hidden',
      transform: 'none',
      boxSizing: 'border-box'
    });

    for (const node of [plyr, plyrWrapper]) {
      if (!node) continue;
      setStyle(node, {
        position: 'relative',
        left: '0px',
        top: '0px',
        width: '100%',
        height: 'auto',
        maxWidth: '100%',
        minWidth: '0px',
        aspectRatio,
        margin: '0px',
        padding: '0px',
        paddingBottom: '0px',
        overflow: 'hidden',
        transform: 'none',
        boxSizing: 'border-box'
      });
    }

    setStyle(video, {
      position: 'relative',
      left: '0px',
      top: '0px',
      display: 'block',
      width: '100%',
      height: 'auto',
      maxWidth: '100%',
      minWidth: '0px',
      margin: '0px',
      objectFit: 'contain',
      transform: 'none',
      transformOrigin: '0 0'
    });
  }

  function scanMissDetail(slot) {
    const video = slot.querySelector('video');
    if (!video) return 'video=missing';

    const chain = [];
    let node = video.parentElement;
    while (node && node !== slot && chain.length < 8) {
      let position = '—';
      try { position = getComputedStyle(node).position || '—'; } catch (_) {}
      chain.push(`${nodeLabel(node)}[${position}]`);
      node = node.parentElement;
    }
    return `video=${nodeLabel(video)} chain=${chain.join('>')}`;
  }

  function applyCompositeLayoutCompat() {
    const playerRoot = document.getElementById('vast-player');
    const slot = playerRoot?.querySelector('.rmp-vpaid-container');
    if (!slot) return;

    const nodes = findCompositeVideoLayout(slot);
    if (!nodes || !fillHostChain(slot, nodes.wrapper)) {
      if (slot.querySelector('video') && !slot.dataset.vastyLayoutScanMiss) {
        slot.dataset.vastyLayoutScanMiss = '1';
        log('vasty:vpaid-layout-scan-miss', scanMissDetail(slot), 'warn');
      }
      return;
    }

    if (slot.dataset.vastyLayoutScanMiss) delete slot.dataset.vastyLayoutScanMiss;

    applyRootSizing(nodes);
    detectCreativeLayoutChange(nodes.videoContainer);
    applyInnerSizing(nodes);
    window.Vasty.animateCompositeTransition(nodes);

    if (slot.dataset.vastyCompositeLayoutCompat) return;
    slot.dataset.vastyCompositeLayoutCompat = '1';
    log('vasty:vpaid-layout-compat-ready',
      'composite video layout compatibility enabled', 'success');

  }

  const SCHEDULE_FALLBACK_MS = 100;
  let scheduled = false;
  let scheduleToken = 0;

  function runScheduledLayout(token) {
    if (!scheduled || token !== scheduleToken) return;
    scheduled = false;
    applyCompositeLayoutCompat();
  }

  function scheduleLayout() {
    if (scheduled) return;
    scheduled = true;
    const token = ++scheduleToken;

    // A hidden or suspended document may keep rAF queued indefinitely. Race it
    // with a timer; the token makes the losing callback harmless, even if a new
    // layout pass has already been scheduled.
    setTimeout(() => runScheduledLayout(token), SCHEDULE_FALLBACK_MS);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => runScheduledLayout(token));
    }
  }

  const playerRoot = document.getElementById('vast-player');
  if (playerRoot) {
    // Ignore our own final inline styles and coalesce creative mutations per pass.
    // Root sizing uses fixed anchors, never translations fed back from live rects.
    new MutationObserver((records) => {
      if (records.some((record) => record.type !== 'attributes' || record.attributeName !== 'style' ||
          writtenStyles.get(record.target) !== record.target.getAttribute('style'))) scheduleLayout();
    }).observe(playerRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
    if (typeof ResizeObserver === 'function') new ResizeObserver(scheduleLayout).observe(playerRoot);
    playerRoot.addEventListener('loadedmetadata', scheduleLayout, true);
    scheduleLayout();
  }
})();
