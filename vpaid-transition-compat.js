(() => {
  'use strict';

  const { log, registerModule } = window.Vasty;
  const handledLayers = new WeakSet();

  registerModule('VPAID transition compat');
  log('vasty:vpaid-transition-bridge-ready', 'transition bridge ready', 'success');

  function px(value, base) {
    const text = String(value || '').trim();
    if (!text || text === 'auto') return null;
    if (text.endsWith('%')) {
      const number = Number.parseFloat(text);
      return Number.isFinite(number) ? base * number / 100 : null;
    }
    if (text.endsWith('px')) {
      const number = Number.parseFloat(text);
      return Number.isFinite(number) ? number : null;
    }
    const number = Number.parseFloat(text);
    return Number.isFinite(number) ? number : null;
  }

  function timeMs(value) {
    const text = String(value || '').trim();
    if (text.endsWith('ms')) return Number.parseFloat(text) || 0;
    if (text.endsWith('s')) return (Number.parseFloat(text) || 0) * 1000;
    return 0;
  }

  function transitionMs(node) {
    try {
      const style = getComputedStyle(node);
      return Math.max(0, ...String(style.transitionDuration || '').split(',').map(timeMs));
    } catch (_) {
      return 0;
    }
  }

  function targetGeometry(nodes) {
    const contentRect = nodes.content.getBoundingClientRect();
    if (!(contentRect.width > 0 && contentRect.height > 0)) return null;

    const layer = nodes.videoContainer;
    const width = px(layer.style.width, contentRect.width);
    const left = px(layer.style.left, contentRect.width) ?? 0;
    const top = px(layer.style.top, contentRect.height) ?? 0;
    if (!(width > 0)) return null;

    let height = px(layer.style.height, contentRect.height);
    if (!(height > 0)) {
      // Match the aspect ratio used by the layout module. A live video rect may
      // still reflect a CSS transition or the pre-metadata default video size.
      const ratio = nodes.video.videoWidth > 0 && nodes.video.videoHeight > 0
        ? nodes.video.videoWidth / nodes.video.videoHeight
        : contentRect.width / contentRect.height;
      height = width / ratio;
    }

    return {
      startWidth: contentRect.width,
      startHeight: contentRect.height,
      left,
      top,
      width,
      height
    };
  }

  function animate(nodes) {
    const layer = nodes.videoContainer;
    if (handledLayers.has(layer) || typeof layer.animate !== 'function') return;
    if (layer.dataset.vastyInitialAnchor !== '1' || layer.dataset.vastyLayoutChanged !== '1') return;

    const target = targetGeometry(nodes);
    if (!target) return;

    let duration = transitionMs(layer);
    if (duration > 3000) {
      // A shorter overlay would jump back into the still-running native CSS
      // transition when it finishes. Leave long creative transitions untouched.
      handledLayers.add(layer);
      log('vasty:vpaid-transition-preserved', `duration=${Math.round(duration)}ms; native CSS transition retained`);
      return;
    }
    if (duration < 50) duration = 500;

    handledLayers.add(layer);
    log(
      'vasty:vpaid-transition-bridge',
      `duration=${Math.round(duration)}ms start=0,0,${Math.round(target.startWidth)}x${Math.round(target.startHeight)} ` +
      `target=${Math.round(target.left)},${Math.round(target.top)},${Math.round(target.width)}x${Math.round(target.height)}`,
      'success'
    );

    try {
      const animation = layer.animate([
        {
          left: '0px',
          top: '0px',
          width: `${target.startWidth}px`,
          height: `${target.startHeight}px`
        },
        {
          left: `${target.left}px`,
          top: `${target.top}px`,
          width: `${target.width}px`,
          height: `${target.height}px`
        }
      ], {
        duration,
        easing: 'linear',
        fill: 'none'
      });
      animation.addEventListener('finish', () => {
        log('vasty:vpaid-transition-bridge-end', 'creative geometry restored after animation');
      }, { once: true });
    } catch (error) {
      log('vasty:vpaid-transition-bridge-error', error?.message || String(error), 'warn');
    }
  }

  // The layout module alone detects the structural signature and geometry change.
  // This module alone owns the animation, so observer order cannot select a
  // competing implementation or duration policy.
  window.Vasty.animateCompositeTransition = animate;
})();
