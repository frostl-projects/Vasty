(() => {
  'use strict';
  const fixtureUrl = document.currentScript.src;

  window.getVPAIDAd = () => {
    const listeners = new Map();
    let slot;
    let volume = 0;
    let width = 640;
    let height = 360;
    const emit = (name, ...args) => {
      const listener = listeners.get(name);
      listener?.callback.apply(listener.context, args);
    };

    return {
      handshakeVersion: () => '2.0',
      subscribe(callback, name, context) { listeners.set(name, { callback, context }); },
      unsubscribe(callback, name) { listeners.delete(name); },
      getAdLinear: () => true,
      getAdExpanded: () => false,
      getAdIcons: () => false,
      getAdCompanions: () => '',
      getAdSkippableState: () => true,
      getAdDuration: () => 30,
      getAdRemainingTime: () => 30,
      getAdWidth: () => width,
      getAdHeight: () => height,
      getAdVolume: () => volume,
      setAdVolume(value) { volume = value; emit('AdVolumeChange'); },
      initAd(w, h, viewMode, bitrate, creativeData, environment) {
        width = w;
        height = h;
        slot = environment.slot;
        slot.innerHTML = '<div class="fixture-vpaid" style="padding:20px;background:#182238;color:white">' +
          '<p>Локальный VPAID 2.0 без трекеров</p>' +
          '<button type="button" data-key-code="39">Вправо</button> ' +
          '<button type="button" class="fixture-generic">Обычная кнопка</button> ' +
          '<button type="button" class="fixture-popup">Тестовый переход</button></div>';
        document.body.addEventListener('keydown', (event) => { slot.dataset.fixtureKey = String(event.keyCode); });
        slot.querySelector('.fixture-popup').addEventListener('click', () => {
          const popup = window.open(new URL('./popup.html', fixtureUrl).href, '_blank');
          slot.dataset.fixturePopup = popup ? 'opened' : 'blocked';
          if (popup) popup.opener = null;
        });
        emit('AdLoaded');
      },
      startAd() { emit('AdStarted'); emit('AdImpression'); emit('AdVideoStart'); },
      stopAd() { emit('AdStopped'); },
      skipAd() { emit('AdSkipped'); emit('AdStopped'); },
      pauseAd() { emit('AdPaused'); },
      resumeAd() { emit('AdPlaying'); },
      resizeAd(w, h) { width = w; height = h; emit('AdSizeChange'); },
      expandAd() {},
      collapseAd() {}
    };
  };
})();
