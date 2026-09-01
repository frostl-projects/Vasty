(() => {
  'use strict';

  const frame = document.getElementById('app');
  const results = document.getElementById('results');
  const status = document.getElementById('status');
  const button = document.getElementById('run');
  const videoUrl = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const equal = (actual, expected, message) => assert(actual === expected, `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  const withoutTimestamp = (text) => text.replace(/^Generated UTC: .*$/m, 'Generated UTC: <time>');
  let win;
  let doc;
  let passed;
  let failed;
  let sample;
  let starvedSchedulerLive;

  async function until(predicate, message, timeout = 10000) {
    const start = performance.now();
    while (!predicate()) {
      if (performance.now() - start > timeout) throw new Error(message);
      await pause(25);
    }
  }

  function input(value) {
    doc.getElementById('vastInput').value = value;
    doc.getElementById('vastInput').dispatchEvent(new win.Event('input', { bubbles: true }));
  }

  function eventRows(name) {
    return Array.from(doc.querySelectorAll('#eventLog .log-row')).filter((row) => row.querySelector('.log-event').textContent === name);
  }

  function sourceVast(media, type = 'video/mp4', api = '') {
    return `<VAST version="3.0"><Ad id="fixture"><InLine><AdSystem>Vasty test</AdSystem><AdTitle>Локальная проверка</AdTitle>` +
      '<Impression></Impression><Creatives><Creative><Linear skipoffset="00:00:01"><Duration>00:00:05</Duration><MediaFiles>' +
      `<MediaFile type="${type}" delivery="progressive" width="640" height="360"${api ? ` apiFramework="${api}"` : ''}>${media}</MediaFile>` +
      '</MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>';
  }

  async function startVpaid() {
    doc.querySelector('[data-mode="xml"]').click();
    input(sourceVast(new URL('./fixture-vpaid.js', location.href).href, 'application/javascript', 'VPAID'));
    doc.getElementById('playButton').click();
    await until(() => doc.querySelector('.fixture-vpaid') && doc.getElementById('playerStatus').textContent === 'Воспроизведение', 'VPAID did not start');
  }

  async function test(name, fn) {
    const item = document.createElement('li');
    item.textContent = name;
    results.appendChild(item);
    try {
      await fn();
      passed += 1;
      item.className = 'pass';
      item.textContent = `✓ ${name}`;
    } catch (error) {
      failed += 1;
      item.className = 'fail';
      item.textContent = `✗ ${name}: ${error.message}`;
    }
    status.textContent = `Пройдено: ${passed}; ошибок: ${failed}`;
  }

  async function archiveEntries(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const decoder = new TextDecoder();
    const entries = new Map();
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
      equal(view.getUint16(offset + 8, true), 0, 'ZIP storage method');
      assert(view.getUint16(offset + 6, true) & 0x0800, 'UTF-8 ZIP flag missing');
      const size = view.getUint32(offset + 18, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
      const start = offset + 30 + nameLength + extraLength;
      entries.set(name, decoder.decode(bytes.subarray(start, start + size)));
      offset = start + size;
    }
    equal(view.getUint32(offset, true), 0x02014b50, 'ZIP central directory');
    equal(view.getUint32(bytes.length - 22, true), 0x06054b50, 'ZIP end record');
    equal(view.getUint16(bytes.length - 12, true), entries.size, 'ZIP entry count');
    equal(view.getUint32(bytes.length - 6, true), offset, 'ZIP central directory offset');
    document.getElementById('archiveEvidence').textContent = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    return entries;
  }

  async function captureCopyAndZip() {
    let copied;
    const blobs = [];
    let downloads = 0;
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(win.navigator, 'clipboard');
    const createObjectURL = win.URL.createObjectURL;
    const anchorClick = win.HTMLAnchorElement.prototype.click;
    // Capture only our generated output; never read the system clipboard or files.
    Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { copied = text; } } });
    win.URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:vasty-test'; };
    win.HTMLAnchorElement.prototype.click = function () { downloads += 1; };
    try {
      doc.getElementById('copyLogButton').click();
      await until(() => typeof copied === 'string', 'Copy handler did not write a report');
      doc.getElementById('downloadLogButton').click();
      equal(downloads, 1, 'Downloads per click');
      equal(blobs.length, 1, 'Blobs per click');
      equal(blobs[0].type, 'application/zip', 'Download MIME type');
      return { copied, entries: await archiveEntries(blobs[0]) };
    } finally {
      if (clipboardDescriptor) Object.defineProperty(win.navigator, 'clipboard', clipboardDescriptor);
      else delete win.navigator.clipboard;
      win.URL.createObjectURL = createObjectURL;
      win.HTMLAnchorElement.prototype.click = anchorClick;
    }
  }

  async function composite(plyr = true, duration = '150ms') {
    const slot = doc.createElement('div');
    slot.className = 'rmp-vpaid-container';
    slot.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    slot.innerHTML = '<div class="fixture-wrapper"><div class="fixture-content">' +
      '<img alt="Фон"><div class="fixture-layer" style="position:absolute;width:100%;height:100%">' +
      `<div class="${plyr ? 'plyr' : 'plain-player'}"><div class="plyr__video-wrapper"><video></video></div></div>` +
      '</div></div></div>';
    const layer = slot.querySelector('.fixture-layer');
    layer.style.transition = `left ${duration} linear, top ${duration} linear, width ${duration} linear, height ${duration} linear`;
    doc.getElementById('vast-player').replaceChildren(slot);
    if (plyr) await until(() => layer.dataset.vastyInitialAnchor === '1', 'Initial video anchor missing');
    else await pause(100);
    return { slot, layer, content: slot.querySelector('.fixture-content'), video: slot.querySelector('video') };
  }

  async function checkTransition(duration, expected) {
    const nodes = await composite(true, duration);
    const slotRect = nodes.slot.getBoundingClientRect();
    const initial = nodes.layer.getBoundingClientRect();
    assert(Math.abs(initial.left - slotRect.left) < 1 && Math.abs(initial.top - slotRect.top) < 1, 'Initial layer is not anchored to slot');
    const animate = nodes.layer.animate;
    const calls = [];
    nodes.layer.animate = function (frames, options) {
      calls.push({ frames, options });
      return animate.call(this, frames, options);
    };
    Object.assign(nodes.layer.style, { width: '60%', height: 'auto', left: '35%', top: '5%' });
    await until(() => calls.length > 0, 'Transition bridge was not invoked');
    equal(calls.length, 1, 'Animation owners');
    equal(calls[0].options.duration, expected, 'Animation duration');
    const rect = nodes.content.getBoundingClientRect();
    assert(Math.abs(parseFloat(calls[0].frames[1].width) - rect.width * 0.6) < 1, 'Animation target uses transient instead of final width');
    await pause(expected + 80);
    equal(nodes.layer.style.width, '60%', 'Creative width preserved');
    equal(nodes.layer.style.height, 'auto', 'Creative height preserved');
    equal(nodes.layer.style.left, '35%', 'Creative position preserved');
    const finalRect = nodes.layer.getBoundingClientRect();
    assert(Math.abs(finalRect.width - parseFloat(calls[0].frames[1].width)) < 1, 'Width jumps after bridge animation');
    assert(Math.abs(finalRect.height - parseFloat(calls[0].frames[1].height)) < 1, 'Height jumps after bridge animation');
    nodes.layer.classList.add('fixture-later-mutation');
    await pause(80);
    equal(calls.length, 1, 'Unrelated mutation replayed animation');
    let writes = 0;
    const observer = new win.MutationObserver((records) => { writes += records.length; });
    observer.observe(nodes.slot, { subtree: true, attributes: true, attributeFilter: ['style'] });
    await pause(150);
    observer.disconnect();
    equal(writes, 0, 'Layout writes continue after settling');
  }

  async function run() {
    button.disabled = true;
    passed = 0;
    failed = 0;
    starvedSchedulerLive = false;
    results.replaceChildren();
    status.dataset.state = 'running';
    frame.src = `../index.html?test-run=${Date.now()}`;
    await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    win = frame.contentWindow;
    doc = frame.contentDocument;

    await test('В UI и отчёте одна версия Vasty; модули и ready-логи доступны до запуска', () => {
      assert(win.Vasty, 'Vasty API missing');
      const environment = doc.getElementById('environment').textContent;
      const environmentFacts = environment.split('\n').pop();
      const displayedVersions = environmentFacts.match(/\b\d+\.\d+\.\d+\b/g) || [];
      equal(displayedVersions.length, 1, 'Displayed application version count');
      equal(displayedVersions[0], win.Vasty.version, 'Displayed Vasty version');
      assert(!environmentFacts.includes('rmp-vast') && !environmentFacts.includes('compat') && !environmentFacts.includes('ZIP'), 'Per-module versions remain in environment');
      const report = win.Vasty.buildDiagnosticReport();
      const reportHeader = report.slice(0, report.indexOf('Generated UTC:'));
      equal((reportHeader.match(/\b\d+\.\d+\.\d+\b/g) || []).length, 1, 'Report header version count');
      for (const name of ['VPAID compat', 'VPAID layout compat', 'VPAID transition compat', 'ZIP export']) {
        assert(reportHeader.includes(name), `${name} missing in report`);
      }
      for (const event of ['vasty:compat-ready', 'vasty:vpaid-transition-bridge-ready', 'vasty:vpaid-layout-module-ready']) {
        const rows = eventRows(event);
        equal(rows.length, 1, `${event} log`);
        assert(!rows[0].textContent.includes(win.Vasty.version), `${event} repeats the Vasty version`);
      }
      assert(String(win.Array.prototype.push).includes('[native code]'), 'Array.push is patched');
      assert(String(Object.getOwnPropertyDescriptor(win.HTMLIFrameElement.prototype, 'sandbox').set).includes('[native code]'), 'Global iframe sandbox is patched');
    });

    await test('Cache key всех локальных JS/CSS совпадает с версией релиза', () => {
      const assets = Array.from(doc.querySelectorAll('script[src],link[rel="stylesheet"]')).map((node) => node.src || node.href);
      const local = assets.filter((value) => new URL(value).origin === location.origin);
      assert(local.length >= 7, 'Local assets missing');
      for (const value of local) equal(new URL(value).searchParams.get('v'), win.Vasty.version, 'Asset version');
      const scriptOrder = Array.from(doc.querySelectorAll('body > script[src]'), (script) => new URL(script.src).pathname.split('/').pop());
      equal(scriptOrder.join(','), 'vasty-core.js,app.js,vpaid-compat.js,vpaid-transition-compat.js,vpaid-layout-compat.js,report-export.js', 'Local script order');
    });

    await test('CDN runtime закреплён SRI и действительно загружен', () => {
      const expected = new Map([
        ['hls.min.js', 'sha384-EjzEuKbktrNTFpMLJKr9CPbBQjdi3b+hSp3X+IRM9bPcgMfyRD2Exd/FaoxjcTpS'],
        ['rmp-vast.min.js', 'sha384-mykhkVM80JIkJpSnzrnwGVIVB4GZVU6rDZqUezIfM7clMN1dQT6AJd5URp1aSEMe']
      ]);
      for (const [name, integrity] of expected) {
        const script = Array.from(doc.scripts).find((node) => new URL(node.src).pathname.endsWith(`/${name}`));
        assert(script, `${name} script missing`);
        equal(script.integrity, integrity, `${name} integrity`);
        equal(script.crossOrigin, 'anonymous', `${name} crossorigin`);
      }
      assert(typeof win.Hls === 'function' && typeof win.RmpVast === 'function', 'CDN runtime blocked or unavailable');
    });

    await test('ZIP и копирование дают одинаковый структурированный отчёт, XML сохраняется целиком', async () => {
      doc.getElementById('sampleButton').click();
      sample = doc.getElementById('vastInput').value;
      const xml = `\n  ${sample.replace('<Creatives>', '<Error>https://example.com/error</Error><Error>https://example.com/duplicate</Error><Creatives>')}\n  `;
      input(xml);
      doc.getElementById('analyzeButton').click();
      const { copied, entries } = await captureCopyAndZip();
      equal(withoutTimestamp(entries.get('report.txt')), withoutTimestamp(copied), 'Copy/ZIP report');
      equal(entries.get('vast.xml'), xml, 'Raw XML');
      assert(copied.includes(`------------\n${xml}\n`), 'Report trims raw XML');
      assert(copied.includes('\nWarnings:\n- ') && copied.includes('\nMedia:\n- MediaFile | video/mp4'), 'Structured analysis missing');
      assert(copied.includes('canPlayType='), 'Media capability missing');
      equal(entries.size, 3, 'ZIP file count');
      const events = entries.get('events.tsv').split('\n').filter(Boolean);
      assert(events.every((row) => row.split('\t').length === 3), 'TSV column count');
      assert(copied.endsWith(events.slice(1).join('\n')), 'Report and TSV events diverge');
    });

    await test('URL и сообщения об ошибках очищаются одним логгером; TSV остаётся трёхколоночным', () => {
      const detail = 'Error https://media.example/ad.mp4?runtime_secret=one#hidden\n at //cdn.example/a.js?runtime_secret=two\t https://bad:port/file?runtime_secret=three';
      win.Vasty.log('fixture:privacy', detail, 'error');
      win.dispatchEvent(new win.ErrorEvent('error', { message: detail, filename: 'https://cdn.example/file.js?runtime_secret=four', lineno: 9 }));
      win.dispatchEvent(new win.PromiseRejectionEvent('unhandledrejection', { promise: win.Promise.resolve(), reason: new win.Error(detail) }));
      const events = win.Vasty.buildDiagnosticFiles().find((file) => file.name === 'events.tsv').data;
      assert(!events.includes('runtime_secret') && !doc.getElementById('eventLog').textContent.includes('runtime_secret'), 'Runtime URL secret leaked');
      assert(events.includes('https://media.example/ad.mp4') && events.includes('//cdn.example/a.js'), 'Diagnostic URL path lost');
      assert(events.trim().split('\n').every((row) => row.split('\t').length === 3), 'Newline/tab broke TSV');
    });

    await test('URL-режим не экспортирует query/hash и не подмешивает старый XML-анализ', async () => {
      doc.querySelector('[data-mode="url"]').click();
      equal(doc.getElementById('analysisStatus').textContent, 'Режим URL', 'URL analysis status');
      equal(doc.getElementById('analysis').textContent, 'Введи VAST URL и нажми «Запустить».', 'URL mode hint');
      doc.getElementById('vastUrl').value = 'https://example.com/vast.xml?source_secret=value#fragment';
      const { copied, entries } = await captureCopyAndZip();
      equal(entries.get('vast-url.txt'), 'https://example.com/vast.xml', 'URL source');
      equal(withoutTimestamp(entries.get('report.txt')), withoutTimestamp(copied), 'URL copy/ZIP report');
      assert(!copied.includes('source_secret') && !copied.includes('VAST ANALYSIS'), 'URL report includes stale/private source');
    });

    await test('Очистить VAST сохраняет лог; очистить лог оставляет только TSV-заголовок', () => {
      const before = win.Vasty.buildDiagnosticFiles().find((file) => file.name === 'events.tsv').data;
      doc.getElementById('clearVastButton').click();
      equal(win.Vasty.buildDiagnosticFiles().find((file) => file.name === 'events.tsv').data, before, 'Clear VAST changed log');
      equal(doc.getElementById('vastInput').value, '', 'XML not cleared');
      equal(doc.getElementById('vastUrl').value, '', 'URL not cleared');
      doc.getElementById('clearButton').click();
      equal(win.Vasty.buildDiagnosticFiles().find((file) => file.name === 'events.tsv').data, 'time\tevent\tdetail\n', 'Empty TSV');
      assert(win.Vasty.buildDiagnosticReport().endsWith('(no events)'), 'Empty event report missing');
    });

    await test('Ошибки XML, VAST 4 Wrapper и JSON AdParameters остаются диагностируемыми', () => {
      doc.querySelector('[data-mode="xml"]').click();
      input('<VAST><Ad></VAST>');
      doc.getElementById('analyzeButton').click();
      assert(win.Vasty.buildDiagnosticReport().includes('Ошибка разбора XML'), 'Malformed XML not reported');
      input('<VAST version="4.2"><Ad><Wrapper><VASTAdTagURI>https://example.com/vast</VASTAdTagURI></Wrapper></Ad></VAST>');
      doc.getElementById('analyzeButton').click();
      assert(win.Vasty.buildDiagnosticReport().includes('VAST 4.2; Ads=1; Inline=0; Wrappers=1'), 'VAST 4 wrapper counts');
      input(sample.replace('<MediaFiles>', '<AdParameters><![CDATA[{"videos":[{"url":"https://example.com/heuristic.webm","type":"video/webm"}]}]]></AdParameters><MediaFiles>'));
      doc.getElementById('analyzeButton').click();
      assert(win.Vasty.buildDiagnosticReport().includes('AdParameters JSON | video/webm'), 'JSON video heuristic lost');
      input(sample);
      assert(!win.Vasty.buildDiagnosticReport().includes('VAST ANALYSIS'), 'Editing input retains stale analysis');
    });

    await test('Реальный rmp-vast запускает локальный VPAID; -1 не показывается как ошибка', async () => {
      await startVpaid();
      equal(doc.querySelector('#runtimeFacts dd:last-child').textContent, '—', 'Initial VAST error');
      assert(win.Vasty.buildDiagnosticReport().includes('VAST error: —'), 'Report initial VAST error');
      equal(doc.querySelector('.rmp-ad-vast-video-player').controls, false, 'VPAID native controls');
      assert(win.Vasty.buildDiagnosticReport().includes('обычного video fallback нет'), 'VPAID fallback warning lost');
    });

    await test('VAST URL проходит через HTTP Wrapper и запускает VPAID с рабочим sandbox', async () => {
      doc.getElementById('stopButton').click();
      doc.querySelector('[data-mode="url"]').click();
      doc.getElementById('vastUrl').value = new URL('./wrapper.xml', location.href).href;
      doc.getElementById('playButton').click();
      await until(() => doc.querySelector('.fixture-vpaid') && doc.getElementById('playerStatus').textContent === 'Воспроизведение', 'Wrapped VPAID did not start');
      assert(doc.querySelector('#vpaid-frame').sandbox.contains('allow-popups'), 'Wrapped VPAID sandbox missing');
      equal(doc.querySelector('.rmp-ad-vast-video-player').controls, false, 'URL VPAID native controls');
    });

    await test('Sandbox расширяется только у execution iframe этого плеера, независимо от порядка токенов', () => {
      const execution = doc.querySelector('#vpaid-frame');
      assert(execution.sandbox.contains('allow-popups-to-escape-sandbox'), 'Execution frame cannot open click-through');
      const container = execution.parentElement;
      for (const [id, parent, expected] of [['unrelated-frame', container, false], ['vpaid-frame', doc.body, false], ['vpaid-frame', container, true]]) {
        const probe = doc.createElement('iframe');
        probe.id = id;
        probe.sandbox = 'allow-same-origin   allow-scripts';
        probe.src = 'about:blank';
        parent.appendChild(probe);
        equal(probe.sandbox.contains('allow-popups'), expected, 'Sandbox scope/token order');
        probe.remove();
      }
    });

    await test('Только семантические remote-кнопки направляют события в execution iframe', async () => {
      doc.querySelector('[data-key-code="39"]').click();
      await until(() => doc.querySelector('.rmp-vpaid-container').dataset.fixtureKey === '39', 'Arrow key did not reach execution frame');
      const before = eventRows('vasty:vpaid-key-dispatch').length;
      doc.querySelector('.fixture-generic').click();
      equal(eventRows('vasty:vpaid-key-dispatch').length, before, 'Generic control was bridged');
    });

    await test('Повторный запуск сбрасывает общий таймер приложения и compatibility-логов', async () => {
      await pause(150);
      win.Vasty.log('fixture:first-clock');
      const first = parseInt(eventRows('fixture:first-clock')[0].querySelector('.log-time').textContent, 10);
      doc.getElementById('playButton').click();
      win.Vasty.log('fixture:second-clock');
      const second = parseInt(eventRows('fixture:second-clock')[0].querySelector('.log-time').textContent, 10);
      assert(first >= 150 && second < first, `Clock did not reset (${first}, ${second})`);
      await until(() => doc.querySelector('.fixture-vpaid'), 'Second VPAID did not initialize');
      doc.getElementById('stopButton').click();
    });

    await test('Composite layout: один владелец анимации, точная конечная геометрия, нет петли style', () => checkTransition('150ms', 150));
    await test('Composite transition: единый fallback 500 мс для нулевой длительности', () => checkTransition('0s', 500));
    await test('Длительная CSS-анимация креатива сохраняет свою длительность', async () => {
      const nodes = await composite(true, '4s');
      const before = eventRows('vasty:vpaid-transition-preserved').length;
      let calls = 0;
      nodes.layer.animate = () => { calls += 1; throw new Error('Long native transition must not be overlaid'); };
      Object.assign(nodes.layer.style, { width: '60%', height: 'auto', left: '35%' });
      await until(() => eventRows('vasty:vpaid-transition-preserved').length > before, 'Native transition decision missing');
      equal(calls, 0, 'Native CSS transition was overlaid');
      assert(win.getComputedStyle(nodes.layer).transitionDuration.split(',').every((value) => value.trim() === '4s'), 'Creative duration changed');
    });

    await test('Layout scheduler срабатывает, даже если requestAnimationFrame не вызывает callback', async () => {
      const fixture = document.createElement('iframe');
      fixture.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:360px;border:0';
      fixture.src = './layout-scheduler.html';
      document.body.appendChild(fixture);
      try {
        await new Promise((resolve) => fixture.addEventListener('load', resolve, { once: true }));
        const fixtureDoc = fixture.contentDocument;
        const layer = fixtureDoc.querySelector('.fixture-layer');
        await until(() => layer.dataset.vastyInitialAnchor === '1', 'Initial video anchor missing with starved rAF', 3000);
        equal(fixtureDoc.querySelector('.rmp-vpaid-container').dataset.vastyCompositeLayoutCompat, '1', 'Composite compatibility marker');
        starvedSchedulerLive = true;
      } finally {
        fixture.remove();
      }
    });

    await test('VPAID без Plyr-сигнатуры не получает layout/transition-патчи', async () => {
      assert(starvedSchedulerLive, 'Matching positive control did not apply the layout patch');
      const nodes = await composite(false);
      const before = nodes.layer.getAttribute('style');
      await pause(100);
      equal(nodes.layer.getAttribute('style'), before, 'Nonmatching creative style changed');
      assert(!nodes.layer.dataset.vastyInitialAnchor && !nodes.layer.dataset.vastyLayoutChanged, 'Nonmatching creative was recognized');
    });

    await test('Ошибки transition и вложенного video проходят общую очистку URL', async () => {
      const nodes = await composite();
      nodes.layer.animate = () => { throw new win.Error('Failed https://example.com/animation?compat_secret=hidden#hash'); };
      Object.assign(nodes.layer.style, { width: '60%', height: 'auto', left: '35%' });
      await until(() => eventRows('vasty:vpaid-transition-bridge-error').length, 'Transition failure missing');
      Object.defineProperty(nodes.video, 'error', { configurable: true, value: { code: 3, message: 'https://example.com/media?compat_secret=hidden' } });
      nodes.video.dispatchEvent(new win.Event('error'));
      const events = win.Vasty.buildDiagnosticFiles().find((file) => file.name === 'events.tsv').data;
      assert(!events.includes('compat_secret'), 'Compatibility error leaked query');
      assert(events.includes('media') && events.includes('vasty:vpaid-video-event'), 'Nested media diagnostics lost');
    });

    for (const controls of [true, false]) {
      await test(`Пропуск обычного VAST доступен; controls=${controls}; VPAID-состояние сброшено`, async () => {
        doc.querySelector('[data-mode="xml"]').click();
        doc.getElementById('controls').checked = controls;
        input(sourceVast(videoUrl));
        doc.getElementById('playButton').click();
        await until(() => doc.querySelector('.rmp-ad-container-skip-message')?.style.display === 'block', 'Skip did not become available');
        const video = doc.querySelector('.rmp-ad-vast-video-player');
        video.pause();
        const skip = doc.querySelector('.rmp-ad-container-skip');
        equal(video.controls, controls, 'Native controls option');
        assert(!doc.getElementById('vast-player').classList.contains('vasty-vpaid-active'), 'VPAID class leaked into normal VAST');
        const bounds = doc.getElementById('vast-player').getBoundingClientRect();
        const rect = skip.getBoundingClientRect();
        assert(rect.top >= bounds.top && rect.bottom <= bounds.top + bounds.height / 2, 'Skip overlaps lower native control area');
        assert(Number(win.getComputedStyle(skip).zIndex) > Number(win.getComputedStyle(video).zIndex), 'Video is above skip');
        const target = doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        assert(target === skip || skip.contains(target), 'Skip cannot receive pointer input');
        skip.click();
        equal(doc.getElementById('playerStatus').textContent, 'Пропущено', 'Skip action');
      });
    }

    await test('Настоящая ошибка выбора MediaFile остаётся видимой в UI, отчёте и логе', async () => {
      input(sourceVast(videoUrl, 'application/x-unsupported-fixture'));
      doc.getElementById('playButton').click();
      await until(() => doc.getElementById('playerStatus').textContent.startsWith('Ошибка'), 'Media selection error missing');
      assert(/VAST error: [0-9]+/.test(win.Vasty.buildDiagnosticReport()), 'Real VAST error not exported');
      assert(eventRows('aderror').length > 0, 'VAST error event hidden');
      assert(doc.querySelector('#runtimeFacts dd:last-child').textContent !== '—', 'Real VAST code not shown');
    });

    status.dataset.state = failed ? 'failed' : 'passed';
    status.textContent = `Завершено. Пройдено: ${passed}; ошибок: ${failed}`;
    button.disabled = false;
  }

  button.addEventListener('click', () => run().catch((error) => {
    status.dataset.state = 'failed';
    status.textContent = `Проверки остановлены: ${error.message}`;
    button.disabled = false;
  }));
})();
