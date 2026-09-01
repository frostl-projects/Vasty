(() => {
  'use strict';

  const APP_VERSION = window.Vasty.version;
  const { escapeHtml, stripQueryAndHash, sanitizeRuntimeText } = window.Vasty.utils;
  const SAMPLE = `<VAST version="3.0">
  <Ad id="vasty-sample">
    <InLine>
      <AdSystem version="1.0">Vasty</AdSystem>
      <AdTitle>Пример Vasty</AdTitle>
      <Impression><![CDATA[https://example.com/impression]]></Impression>
      <Creatives>
        <Creative>
          <Linear>
            <Duration>00:00:05</Duration>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" width="640" height="360"><![CDATA[https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4]]></MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

  const $ = (id) => document.getElementById(id);
  const elements = {
    vastInput: $('vastInput'), vastUrl: $('vastUrl'), playButton: $('playButton'), stopButton: $('stopButton'),
    analyzeButton: $('analyzeButton'), clearVastButton: $('clearVastButton'), clearButton: $('clearButton'),
    copyLogButton: $('copyLogButton'), sampleButton: $('sampleButton'),
    enableVpaid: $('enableVpaid'), muted: $('muted'), controls: $('controls'), playerStatus: $('playerStatus'),
    analysisStatus: $('analysisStatus'), analysis: $('analysis'), eventLog: $('eventLog'), environment: $('environment'),
    runtimeFacts: $('runtimeFacts')
  };

  let mode = 'xml';
  let player = null;
  let runStartedAt = 0;
  let mediaListeners = [];
  let playerResizeObserver = null;
  let playerDomObserver = null;
  let restoreVpaidFrameInsertion = null;
  let lastAnalysis = null;
  let lastPlayerState = null;
  const logLines = [];
  const loadedModules = new Set();

  const ALL_EVENTS = [
    'adloaded','addurationchange','adclick','adclosed','adimpression','adcreativeview','adinteraction',
    'aduseracceptinvitation','adcollapse','adstarted','adtagloaded','adprogress','adviewable','adviewundetermined',
    'adinitialplayrequestfailed','adinitialplayrequestsucceeded','adpaused','adresumed','adtagstartloading',
    'adsizechange','adlinearchange','adexpandedchange','adremainingtimechange','advolumemuted','advolumeunmuted',
    'advolumechanged','adcomplete','adskipped','adskippablestatechanged','adfirstquartile','admidpoint',
    'adthirdquartile','adplayerexpand','adplayercollapse','adfullscreen','adexitfullscreen','adiconclick','aderror',
    'addestroyed','adpodcompleted','adtrackingcomplete','adtrackingeventsloaded'
  ];

  function setStatus(element, text, kind = 'idle') {
    element.textContent = text;
    element.className = `status ${kind}`;
  }

  function elapsed() {
    return runStartedAt ? `${Math.round(performance.now() - runStartedAt)} ms` : '—';
  }

  function hasVastError(instance = player) {
    return !!instance && Number.isFinite(instance.adVastErrorCode) && instance.adVastErrorCode >= 0;
  }

  function displayUrl(value) {
    return stripQueryAndHash(value) || '—';
  }

  function log(event, detail = '', kind = '') {
    const time = elapsed();
    // One path for app, compatibility and export logs, including exception text.
    const safeEvent = sanitizeRuntimeText(event).replace(/[\t\r\n]+/g, ' ');
    const safeDetail = sanitizeRuntimeText(detail).replace(/[\t\r\n]+/g, ' ');
    logLines.push(`${time}\t${safeEvent}\t${safeDetail}`);
    const empty = elements.eventLog.querySelector('.empty');
    if (empty) empty.remove();
    elements.eventLog.insertAdjacentHTML('afterbegin',
      `<div class="log-row ${escapeHtml(kind)}"><span class="log-time">${escapeHtml(time)}</span><span class="log-event">${escapeHtml(safeEvent)}</span><span class="log-detail">${escapeHtml(safeDetail)}</span></div>`);
  }

  function mediaCapabilities() {
    const video = document.createElement('video');
    return {
      h264: video.canPlayType('video/mp4; codecs="avc1.42E01E"') || 'no',
      webm: video.canPlayType('video/webm; codecs="vp9"') || 'no'
    };
  }

  function renderEnvironment() {
    const caps = mediaCapabilities();
    elements.environment.textContent =
      `${navigator.userAgent}\nH.264: ${caps.h264} · WebM/VP9: ${caps.webm} · Vasty: ${APP_VERSION}`;
  }

  function registerModule(name) {
    loadedModules.add(name);
  }

  function directChildren(node) {
    return Array.from(node?.children || []);
  }

  function orderWarnings(parent, expected, label) {
    if (!parent) return [];
    const rank = new Map(expected.map((name, index) => [name, index]));
    let lastRank = -1;
    const warnings = [];
    for (const child of directChildren(parent)) {
      if (!rank.has(child.localName)) continue;
      const currentRank = rank.get(child.localName);
      if (currentRank < lastRank) warnings.push(`${label}: <${child.localName}> стоит не в порядке, заданном VAST 3.0.`);
      else lastRank = currentRank;
    }
    return warnings;
  }

  function extractAdParameterVideos(doc) {
    const result = [];
    for (const node of Array.from(doc.getElementsByTagName('AdParameters'))) {
      const raw = node.textContent.trim();
      if (!raw || (!raw.startsWith('{') && !raw.startsWith('['))) continue;
      try {
        const parsed = JSON.parse(raw);
        const candidates = Array.isArray(parsed?.videos) ? parsed.videos : [];
        for (const item of candidates) {
          if (item && typeof item.url === 'string') {
            result.push({ url: item.url, type: item.type || '', source: 'AdParameters JSON', apiFramework: '', delivery: '', width: '', height: '' });
          }
        }
      } catch (_) {
        // AdParameters is opaque application data; JSON parsing is only a diagnostic heuristic.
      }
    }
    return result;
  }

  function analyzeXml(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) return { fatal: `Ошибка разбора XML: ${parserError.textContent.trim().slice(0, 240)}`, issues: [], media: [] };

    const vast = doc.documentElement?.localName === 'VAST' ? doc.documentElement : doc.querySelector('VAST');
    if (!vast) return { fatal: 'Корневой элемент <VAST> не найден.', issues: [], media: [] };

    const version = vast.getAttribute('version') || 'не указана';
    const issues = [];
    const ads = Array.from(doc.getElementsByTagName('Ad'));
    const inlines = Array.from(doc.getElementsByTagName('InLine'));
    const wrappers = Array.from(doc.getElementsByTagName('Wrapper'));
    const media = Array.from(doc.getElementsByTagName('MediaFile')).map((node) => ({
      url: node.textContent.trim(),
      type: node.getAttribute('type') || '',
      apiFramework: node.getAttribute('apiFramework') || '',
      delivery: node.getAttribute('delivery') || '',
      width: node.getAttribute('width') || '',
      height: node.getAttribute('height') || '',
      source: 'MediaFile'
    }));
    media.push(...extractAdParameterVideos(doc));

    if (version.startsWith('3')) {
      for (const inline of inlines) {
        issues.push(...orderWarnings(inline,
          ['AdSystem','AdTitle','Description','Advertiser','Pricing','Survey','Error','Impression','Creatives','Extensions'], 'InLine'));
        const errors = directChildren(inline).filter((node) => node.localName === 'Error');
        const impressions = directChildren(inline).filter((node) => node.localName === 'Impression');
        if (errors.length > 1) issues.push(`InLine содержит ${errors.length} элементов <Error>; VAST 3.0 допускает не более одного.`);
        if (impressions.length === 0) issues.push('InLine не содержит обязательный <Impression> для VAST 3.0.');
      }
      for (const linear of Array.from(doc.getElementsByTagName('Linear'))) {
        issues.push(...orderWarnings(linear,
          ['Icons','CreativeExtensions','Duration','TrackingEvents','AdParameters','VideoClicks','MediaFiles'], 'Linear'));
      }
    }

    const validTrackingV3 = new Set([
      'creativeView','start','firstQuartile','midpoint','thirdQuartile','complete','mute','unmute','pause','rewind',
      'resume','fullscreen','expand','collapse','acceptInvitation','close','skip','progress'
    ]);
    if (version.startsWith('3')) {
      const unknown = Array.from(doc.getElementsByTagName('Tracking'))
        .map((node) => node.getAttribute('event')).filter((name) => name && !validTrackingV3.has(name));
      for (const name of [...new Set(unknown)]) issues.push(`Tracking event="${name}" отсутствует в перечне событий VAST 3.0.`);
    }

    for (const item of media.filter((m) => m.source === 'MediaFile')) {
      if (!item.delivery) issues.push(`У MediaFile ${item.type || '(тип не указан)'} отсутствует обязательный delivery.`);
      else if (version.startsWith('3') && !['progressive','streaming'].includes(item.delivery)) issues.push(`MediaFile delivery="${item.delivery}" недопустим для VAST 3.0.`);
      if (!item.type) issues.push('У MediaFile отсутствует обязательный type.');
      if (item.apiFramework.toUpperCase() === 'VPAID' && (!item.width || item.width === '0' || !item.height || item.height === '0')) {
        issues.push('VPAID MediaFile использует нулевую/отсутствующую ширину или высоту; некоторые плееры могут отвергнуть такой creative.');
      }
      const width = Number(item.width);
      const height = Number(item.height);
      if (item.apiFramework.toUpperCase() === 'VPAID' && Number.isFinite(width) && Number.isFinite(height) &&
        width > 0 && height > 0 && width <= 32 && height <= 32) {
        issues.push(`VPAID MediaFile имеет размер ${item.width}×${item.height}; это похоже на соотношение сторон. width/height должны задавать размер в пикселях.`);
      }
    }

    if (!media.length) issues.push('MediaFile не найден. Возможно, тег опирается на Wrapper или неподдерживаемый тип creative.');
    if (media.some((m) => m.apiFramework.toUpperCase() === 'VPAID') && !media.some((m) => /^video\//i.test(m.type))) {
      issues.push('В <MediaFiles> доступен только VPAID: обычного video fallback нет.');
    }

    return { fatal: null, version, ads: ads.length, inlines: inlines.length, wrappers: wrappers.length, issues, media };
  }

  function mediaCapability(type) {
    if (!type) return '—';
    try { return document.createElement('video').canPlayType(type) || 'no'; }
    catch (_) { return '—'; }
  }

  function renderAnalysis(result) {
    lastAnalysis = result;
    elements.analysis.classList.remove('empty');
    if (result.fatal) {
      setStatus(elements.analysisStatus, 'Некорректный XML', 'error');
      elements.analysis.innerHTML = `<div class="issue error">${escapeHtml(result.fatal)}</div>`;
      return false;
    }
    setStatus(elements.analysisStatus, result.issues.length ? `Предупреждений: ${result.issues.length}` : 'Явных проблем нет', result.issues.length ? 'warn' : 'ok');
    const summary = `<div class="summary"><span class="pill">VAST ${escapeHtml(result.version)}</span><span class="pill">Ad: ${result.ads}</span><span class="pill">Inline: ${result.inlines}</span><span class="pill">Wrapper: ${result.wrappers}</span><span class="pill">Media: ${result.media.length}</span></div>`;
    const issues = result.issues.length
      ? result.issues.map((issue) => `<div class="issue warn">${escapeHtml(issue)}</div>`).join('')
      : '';
    const media = result.media.length ? `<table class="media-table"><thead><tr><th>Источник</th><th>Тип</th><th>API</th><th>Delivery</th><th>Размер</th><th>canPlayType</th><th>URL</th></tr></thead><tbody>${result.media.map((item) => `<tr><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.type || '—')}</td><td>${escapeHtml(item.apiFramework || '—')}</td><td>${escapeHtml(item.delivery || '—')}</td><td>${escapeHtml(item.width || '—')}×${escapeHtml(item.height || '—')}</td><td>${escapeHtml(mediaCapability(item.type))}</td><td>${escapeHtml(item.url || '—')}</td></tr>`).join('')}</tbody></table>` : '';
    elements.analysis.innerHTML = summary + issues + media;
    return true;
  }

  function currentInput() {
    return mode === 'xml' ? elements.vastInput.value.trim() : elements.vastUrl.value.trim();
  }

  function analyzeCurrent() {
    if (mode !== 'xml') {
      resetAnalysis();
      return true;
    }
    const value = currentInput();
    if (!value) {
      lastAnalysis = null;
      setStatus(elements.analysisStatus, 'Нет данных', 'warn');
      elements.analysis.innerHTML = '<div class="issue warn">Сначала вставь VAST XML.</div>';
      return false;
    }
    return renderAnalysis(analyzeXml(value));
  }

  function clearMediaListeners() {
    for (const [node, event, listener] of mediaListeners) node.removeEventListener(event, listener);
    mediaListeners = [];
  }

  function attachMediaDiagnostics() {
    clearMediaListeners();
    const video = player?.adPlayer;
    if (!video) return;
    const events = ['loadstart','loadedmetadata','loadeddata','canplay','playing','waiting','stalled','suspend','emptied','ended','error'];
    for (const event of events) {
      const listener = () => {
        const source = video.currentSrc || video.src || '';
        let detail = `src=${displayUrl(source)}`;
        if (event === 'error' && video.error) detail += ` mediaError=${video.error.code}:${video.error.message || ''}`;
        log(`media:${event}`, detail, event === 'error' ? 'error' : '');
      };
      video.addEventListener(event, listener);
      mediaListeners.push([video, event, listener]);
    }
  }

  function readPlayerState() {
    return {
      media: displayUrl(player.adMediaUrl),
      contentType: sanitizeRuntimeText(player.adContentType || '—'),
      adSystem: sanitizeRuntimeText(typeof player.adSystem === 'object' ? JSON.stringify(player.adSystem) : (player.adSystem || '—')),
      adTitle: sanitizeRuntimeText(player.adTitle || '—'),
      vastError: sanitizeRuntimeText(hasVastError() ? `${player.adVastErrorCode} ${player.adErrorMessage || ''}` : '—')
    };
  }

  function updateRuntimeFacts() {
    if (!lastPlayerState) { elements.runtimeFacts.innerHTML = ''; return; }
    const facts = [
      ['Выбранное медиа', lastPlayerState.media],
      ['Content-Type', lastPlayerState.contentType],
      ['AdSystem', lastPlayerState.adSystem],
      ['AdTitle', lastPlayerState.adTitle],
      ['Ошибка VAST', lastPlayerState.vastError]
    ];
    elements.runtimeFacts.innerHTML = facts.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
  }

  function getPlayerSize() {
    const container = $('vast-player');
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || container.clientWidth || 640));
    const measuredHeight = rect.height || container.clientHeight;
    const height = Math.max(1, Math.round(measuredHeight || width * 9 / 16));
    return { width, height };
  }

  function disconnectPlayerResizeObserver() {
    if (!playerResizeObserver) return;
    playerResizeObserver.disconnect();
    playerResizeObserver = null;
  }

  function disconnectPlayerDomObserver() {
    if (!playerDomObserver) return;
    playerDomObserver.disconnect();
    playerDomObserver = null;
  }

  function isKnownVpaidInput() {
    return mode === 'xml' && !!lastAnalysis?.media?.some((item) => item.apiFramework?.toUpperCase() === 'VPAID');
  }

  function describePointerTarget(target) {
    if (!(target instanceof Element)) return 'unknown';
    const tag = target.tagName.toLowerCase();
    const role = target.getAttribute('role');
    const type = target.getAttribute('type');
    return [tag, role ? `role=${role}` : '', type ? `type=${type}` : ''].filter(Boolean).join(' ');
  }

  function installVpaidFrameCompatibility(adContainer) {
    if (!adContainer) {
      log('vasty:vpaid-sandbox-unavailable', 'Runtime ad container is missing; default iframe restrictions remain in effect.', 'warn');
      return;
    }
    const appendChild = adContainer.appendChild;
    // rmp-vast 17.2.0 appends #vpaid-frame here after setting its sandbox and src.
    // Set click-through permissions BEFORE insertion: changing a loaded iframe's
    // sandbox does not update its active document. Only this player's execution
    // frame is affected; no browser prototype or unrelated iframe is patched.
    adContainer.appendChild = function (node) {
      if (this === adContainer && node instanceof HTMLIFrameElement && node.id === 'vpaid-frame' &&
          node.getAttribute('src') === 'about:blank' &&
          node.sandbox.contains('allow-scripts') && node.sandbox.contains('allow-same-origin')) {
        node.sandbox.add('allow-popups', 'allow-popups-to-escape-sandbox', 'allow-top-navigation-by-user-activation', 'allow-forms');
        log('vasty:vpaid-sandbox', 'Click-through permissions configured on the execution iframe before insertion.');
      }
      return appendChild.call(this, node);
    };
    restoreVpaidFrameInsertion = () => { delete adContainer.appendChild; };
  }

  function configureVpaidDom() {
    const container = $('vast-player');
    const slot = container.querySelector('.rmp-vpaid-container');
    container.classList.toggle('vasty-vpaid-active', !!slot);
    if (!slot) return;

    slot.style.zIndex = '20';
    slot.style.pointerEvents = 'auto';

    const video = container.querySelector('.rmp-ad-vast-video-player');
    if (video && video.controls) {
      video.controls = false;
      log('vasty:vpaid-controls-disabled', 'Native video controls disabled so the VPAID interaction layer receives pointer input.');
    }

    if (!slot.dataset.vastyPointerDiagnostics) {
      slot.dataset.vastyPointerDiagnostics = '1';
      slot.addEventListener('pointerdown', (event) => {
        log('vasty:vpaid-pointer', describePointerTarget(event.target));
      }, true);
      slot.addEventListener('click', (event) => {
        log('vasty:vpaid-click', describePointerTarget(event.target));
      }, true);
    }
  }

  function attachPlayerDomObserver() {
    disconnectPlayerDomObserver();
    const container = $('vast-player');
    playerDomObserver = new MutationObserver(() => configureVpaidDom());
    playerDomObserver.observe(container, { childList: true, subtree: true });
    configureVpaidDom();
  }

  function attachPlayerResizeObserver() {
    disconnectPlayerResizeObserver();
    if (typeof ResizeObserver !== 'function') return;
    const container = $('vast-player');
    let lastWidth = 0;
    let lastHeight = 0;
    playerResizeObserver = new ResizeObserver(() => {
      const { width, height } = getPlayerSize();
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      if (!player || typeof player.resizeAd !== 'function') return;
      try {
        player.resizeAd(width, height, 'normal');
        log('vasty:resize-ad', `${width}x${height}`);
      } catch (error) {
        log('vasty:resize-error', error?.message || String(error), 'error');
      }
    });
    playerResizeObserver.observe(container);
  }

  function teardownPlayer() {
    clearMediaListeners();
    disconnectPlayerResizeObserver();
    disconnectPlayerDomObserver();
    if (player) {
      try { player.destroy(); } catch (error) { log('vasty:destroy-error', error?.message || String(error), 'error'); }
      player = null;
    }
    restoreVpaidFrameInsertion?.();
    restoreVpaidFrameInsertion = null;
    lastPlayerState = null;
    const container = $('vast-player');
    container.classList.remove('vasty-vpaid-active');
    container.innerHTML = '<div class="rmp-content"><video class="rmp-video" src="data:video/mp4;base64," playsinline muted disableRemotePlayback></video></div>';
    elements.runtimeFacts.innerHTML = '';
  }

  function createPlayer() {
    teardownPlayer();
    if (typeof window.RmpVast !== 'function') throw new Error('Не загрузился rmp-vast. Проверь доступ к jsDelivr/CDN.');
    const vpaidSize = getPlayerSize();
    const params = {
      ajaxTimeout: 10000,
      creativeLoadTimeout: 12000,
      maxNumRedirects: 10,
      vastXmlInput: mode === 'xml',
      enableVpaid: elements.enableVpaid.checked,
      labels: { skipMessage: 'Пропустить', closeAd: 'Закрыть', textForInteractionUIOnMobile: 'Подробнее' },
      showControlsForAdPlayer: elements.controls.checked && !isKnownVpaidInput(),
      useHlsJS: typeof window.Hls !== 'undefined',
      vpaidSettings: { width: vpaidSize.width, height: vpaidSize.height, viewMode: 'normal', desiredBitrate: 1500 }
    };
    player = new window.RmpVast('vast-player', params);
    player.muted = elements.muted.checked;
    attachPlayerResizeObserver();
    attachPlayerDomObserver();
    if (elements.enableVpaid.checked) log('vasty:vpaid-init-size', `${vpaidSize.width}x${vpaidSize.height}`);

    const onEvent = (event) => {
      const name = event?.type || 'unknown';
      let detail = '';
      let kind = '';
      if (name === 'adtagstartloading') {
        attachMediaDiagnostics();
      }
      if (name === 'aderror') {
        detail = hasVastError()
          ? `VAST ${player.adVastErrorCode}: ${player.adErrorMessage || 'Неизвестная ошибка'}`
          : `Внутренняя ошибка rmp-vast: ${player.adErrorMessage || 'неизвестный код'}`;
        kind = 'error';
        setStatus(elements.playerStatus, hasVastError() ? `Ошибка ${player.adVastErrorCode}` : 'Ошибка плеера', 'error');
      } else if (name === 'adstarted') {
        detail = `media=${displayUrl(player.adMediaUrl)} type=${player.adContentType || '—'}`;
        kind = 'success';
        setStatus(elements.playerStatus, 'Воспроизведение', 'live');
      } else if (name === 'adloaded') {
        configureVpaidDom();
        detail = `media=${displayUrl(player.adMediaUrl)} type=${player.adContentType || '—'}`;
      } else if (name === 'adinitialplayrequestfailed') {
        detail = 'Браузер отклонил начальный play(): вероятна autoplay/policy/blocking проблема.';
        kind = 'warn';
      } else if (name === 'adinitialplayrequestsucceeded') {
        kind = 'success';
      } else if (name === 'adcomplete') {
        setStatus(elements.playerStatus, 'Завершено', 'ok');
      } else if (name === 'adclosed') {
        setStatus(elements.playerStatus, 'Закрыто', 'ok');
      } else if (name === 'adskipped') {
        setStatus(elements.playerStatus, 'Пропущено', 'ok');
      }
      log(name, detail, kind);
      // rmp-vast resets its fields before addestroyed, including real VAST errors.
      // Preserve the last event snapshot until the next run for UI and export.
      if (name !== 'addestroyed') lastPlayerState = readPlayerState();
      updateRuntimeFacts();
    };

    player.on(ALL_EVENTS.join(' '), onEvent);
    player.initialize();
    if (elements.enableVpaid.checked) installVpaidFrameCompatibility(player.adContainer);
    return player;
  }

  async function play() {
    const input = currentInput();
    if (!input) {
      setStatus(elements.playerStatus, 'Нет данных', 'warn');
      return;
    }
    if (!analyzeCurrent()) return;

    runStartedAt = performance.now();
    elements.stopButton.disabled = false;
    setStatus(elements.playerStatus, 'Загрузка…', 'live');
    log('vasty:play', `${mode.toUpperCase()} · VPAID=${elements.enableVpaid.checked} · muted=${elements.muted.checked} · controls=${elements.controls.checked}`);
    try {
      createPlayer().loadAds(input);
    } catch (error) {
      setStatus(elements.playerStatus, 'Ошибка плеера', 'error');
      log('vasty:error', error?.stack || error?.message || String(error), 'error');
    }
  }

  function switchMode(nextMode) {
    const changed = mode !== nextMode;
    mode = nextMode;
    if (changed) resetAnalysis();
    document.querySelectorAll('.segment').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
    elements.vastInput.classList.toggle('hidden', mode !== 'xml');
    elements.vastUrl.classList.toggle('hidden', mode !== 'url');
    elements.sampleButton.classList.toggle('hidden', mode !== 'xml');
  }

  function clearVast() {
    elements.vastInput.value = '';
    elements.vastUrl.value = '';
    resetAnalysis();
  }

  function resetAnalysis() {
    lastAnalysis = null;
    const urlMode = mode === 'url';
    setStatus(elements.analysisStatus, urlMode ? 'Режим URL' : 'Не анализировался', 'idle');
    elements.analysis.textContent = urlMode
      ? 'Введи VAST URL и нажми «Запустить».'
      : 'Вставь тег и нажми «Только анализ» или «Запустить».';
    elements.analysis.classList.add('empty');
  }

  function buildDiagnosticReport() {
    const caps = mediaCapabilities();
    const lines = [
      'Vasty diagnostic report',
      `Vasty: ${APP_VERSION}`,
      `Modules: ${Array.from(loadedModules).join(', ') || '—'}`,
      `Generated UTC: ${new Date().toISOString()}`,
      `User-Agent: ${navigator.userAgent}`,
      `H.264 canPlayType: ${caps.h264}`,
      `WebM/VP9 canPlayType: ${caps.webm}`,
      `Mode: ${mode}`,
      `VPAID enabled: ${elements.enableVpaid.checked}`,
      `Muted: ${elements.muted.checked}`,
      `Video controls: ${elements.controls.checked}`,
      '',
      'PRIVACY',
      'Vasty diagnostic code does not read or export cookies, localStorage, sessionStorage, referrer, IP address, clipboard contents, account/profile data, local files or browsing history.',
      'Third-party VPAID JavaScript runs in this origin and can access its data. Use a dedicated origin without sensitive data.',
      'Runtime URLs in the event log are stripped of query parameters and fragments where possible. Raw VAST XML is included unchanged.',
      ''
    ];

    if (mode === 'xml') {
      lines.push('RAW VAST XML', '------------', elements.vastInput.value || '(empty)', '');
    } else {
      lines.push('VAST URL (query/fragment removed)', '----------------------------------', stripQueryAndHash(currentInput()) || '(empty)', '');
    }

    if (lastAnalysis) {
      lines.push('VAST ANALYSIS', '-------------');
      if (lastAnalysis.fatal) {
        lines.push(lastAnalysis.fatal);
      } else {
        lines.push(`VAST ${lastAnalysis.version}; Ads=${lastAnalysis.ads}; Inline=${lastAnalysis.inlines}; Wrappers=${lastAnalysis.wrappers}; Media=${lastAnalysis.media.length}`);
        if (lastAnalysis.issues.length) {
          lines.push('', 'Warnings:');
          lastAnalysis.issues.forEach((issue) => lines.push(`- ${issue}`));
        } else {
          lines.push('Warnings: none');
        }
        if (lastAnalysis.media.length) {
          lines.push('', 'Media:');
          lastAnalysis.media.forEach((item) => lines.push(`- ${item.source} | ${item.type || '—'} | API=${item.apiFramework || '—'} | delivery=${item.delivery || '—'} | ${item.width || '—'}x${item.height || '—'} | canPlayType=${mediaCapability(item.type)} | ${displayUrl(item.url)}`));
        }
      }
      lines.push('');
    }

    if (lastPlayerState) {
      lines.push('PLAYER STATE', '------------');
      lines.push(`Selected media: ${lastPlayerState.media}`);
      lines.push(`Content type: ${lastPlayerState.contentType}`);
      lines.push(`AdSystem: ${lastPlayerState.adSystem}`);
      lines.push(`AdTitle: ${lastPlayerState.adTitle}`);
      lines.push(`VAST error: ${lastPlayerState.vastError}`);
      lines.push('');
    }

    lines.push('EVENT LOG', '---------');
    lines.push(...(logLines.length ? logLines : ['(no events)']));
    return lines.join('\n');
  }

  function buildDiagnosticFiles() {
    return [
      { name: 'report.txt', data: buildDiagnosticReport() },
      { name: 'events.tsv', data: `time\tevent\tdetail\n${logLines.length ? `${logLines.join('\n')}\n` : ''}` },
      mode === 'xml'
        ? { name: 'vast.xml', data: elements.vastInput.value }
        : { name: 'vast-url.txt', data: stripQueryAndHash(elements.vastUrl.value) }
    ];
  }

  document.querySelectorAll('.segment').forEach((button) => button.addEventListener('click', () => switchMode(button.dataset.mode)));
  elements.playButton.addEventListener('click', play);
  elements.analyzeButton.addEventListener('click', analyzeCurrent);
  elements.sampleButton.addEventListener('click', () => { elements.vastInput.value = SAMPLE; analyzeCurrent(); });
  elements.clearVastButton.addEventListener('click', clearVast);
  elements.vastInput.addEventListener('input', resetAnalysis);
  elements.vastUrl.addEventListener('input', resetAnalysis);
  elements.stopButton.addEventListener('click', () => {
    if (player) {
      try { player.stopAds(); } catch (error) { log('vasty:stop-error', error.message, 'error'); }
    }
    setStatus(elements.playerStatus, 'Остановлено', 'idle');
    elements.stopButton.disabled = true;
    log('vasty:stop');
  });
  elements.clearButton.addEventListener('click', () => {
    logLines.length = 0;
    elements.eventLog.innerHTML = '<div class="empty">Событий пока нет.</div>';
  });
  elements.copyLogButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildDiagnosticReport());
      const old = elements.copyLogButton.textContent;
      elements.copyLogButton.textContent = 'Скопировано';
      setTimeout(() => { elements.copyLogButton.textContent = old; }, 900);
    } catch (error) {
      log('clipboard:error', error.message, 'error');
    }
  });
  window.addEventListener('error', (event) => {
    const filename = event?.filename ? stripQueryAndHash(event.filename) : '';
    const detail = filename ? `${event.message} @ ${filename}:${event.lineno || ''}` : event.message;
    log('window:error', detail || 'Неизвестная ошибка window', 'error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    log('promise:rejection', reason?.stack || reason?.message || String(reason), 'error');
  });

  // Compatibility and ZIP modules load after app.js and use this explicit API.
  // They share the same clock, privacy filter, log store and report builder.
  Object.assign(window.Vasty, { log, registerModule, buildDiagnosticReport, buildDiagnosticFiles });
  renderEnvironment();
  switchMode('xml');
})();
