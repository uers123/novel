const Settings = (() => {
  const $ = id => document.getElementById(id);
  const els = {
    modal: $('settings-modal'),
    brightness: $('brightness-slider'),
    fontSize: $('fontsize-slider'),
    fontSizeDisplay: $('fontsize-display'),
    colorPalette: $('color-palette'),
    effectOptions: $('page-effect-options'),
    eyeCare: $('set-eye-care'),
    readerContent: $('reader-content'),
    nightBtn: $('nav-night'),
  };

  let _settings = {
    theme: 'day',
    fontSize: 20,
    lineHeight: 2.0,
    bgColor: '#F6F3EC',
    pageEffect: 'updown',
    brightness: 100,
    voiceId: 'qinglang_male',
    emotion: 'auto',
  };
  let _hasLocalSettings = false;

  function init() {
    _loadLocal();
    _applyAll();
    _loadServer();
    _loadGpuSettings();
    _bindEvents();
  }

  function _bindEvents() {
    document.getElementById('nav-settings').addEventListener('click', () => {
      els.modal.classList.add('active');
    });
    document.getElementById('settings-close').addEventListener('click', () => {
      els.modal.classList.remove('active');
    });
    els.modal.addEventListener('click', event => {
      if (event.target === els.modal) els.modal.classList.remove('active');
    });

    els.brightness.addEventListener('input', () => set('brightness', parseInt(els.brightness.value, 10), false));
    els.brightness.addEventListener('change', () => _persist());
    els.fontSize.addEventListener('input', () => set('fontSize', parseInt(els.fontSize.value, 10), false));
    els.fontSize.addEventListener('change', () => _persist());

    els.colorPalette.addEventListener('click', event => {
      const swatch = event.target.closest('.color-swatch');
      if (!swatch) return;
      set('bgColor', swatch.dataset.color);
    });

    els.effectOptions.addEventListener('click', event => {
      const option = event.target.closest('.effect-option');
      if (!option) return;
      set('pageEffect', option.dataset.effect);
    });

    els.eyeCare.addEventListener('click', () => {
      set('theme', _settings.theme === 'eye' ? 'day' : 'eye');
    });

    els.nightBtn.addEventListener('click', () => {
      set('theme', _settings.theme === 'night' ? 'day' : 'night');
    });
  }

  function _loadLocal() {
    try {
      const saved = localStorage.getItem('novel_settings');
      if (saved) {
        _hasLocalSettings = true;
        _settings = { ..._settings, ...JSON.parse(saved) };
      }
    } catch (_e) {}
  }

  async function _loadServer() {
    try {
      const response = await fetch('/api/settings');
      if (!response.ok) return;
      const data = await response.json();
      _settings = _hasLocalSettings ? { ...data, ..._settings } : { ..._settings, ...data };
      _applyAll();
    } catch (_e) {}
  }

  function get() {
    return { ..._settings };
  }

  function set(key, value, persist = true) {
    _settings[key] = value;
    _apply(key);
    if (persist) _persist();
  }

  function _persist() {
    try {
      localStorage.setItem('novel_settings', JSON.stringify(_settings));
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(_settings),
      }).catch(() => {});
    } catch (_e) {}
  }

  function _applyAll() {
    ['theme', 'fontSize', 'lineHeight', 'bgColor', 'brightness', 'pageEffect'].forEach(_apply);
    _syncUI();
  }

  function _apply(key) {
    if (key === 'theme') {
      document.documentElement.setAttribute('data-theme', _settings.theme);
      els.nightBtn.innerHTML = _settings.theme === 'night' ? '☀<span>日间</span>' : '☾<span>夜间</span>';
      // Clear inline bgColor when using theme colors (night/eye)
      if (_settings.theme === 'night' || _settings.theme === 'eye') {
        delete _settings.bgColor;
        els.readerContent.style.backgroundColor = '';
      }
    }
    if (key === 'fontSize') {
      document.documentElement.style.setProperty('--reader-font-size', `${_settings.fontSize}px`);
      els.fontSizeDisplay.textContent = _settings.fontSize;
    }
    if (key === 'lineHeight') {
      document.documentElement.style.setProperty('--reader-line-height', _settings.lineHeight);
    }
    if (key === 'bgColor') {
      els.readerContent.style.backgroundColor = _settings.bgColor;
      els.colorPalette.querySelectorAll('.color-swatch').forEach(item => {
        item.classList.toggle('active', item.dataset.color === _settings.bgColor);
      });
    }
    if (key === 'brightness') {
      document.body.style.setProperty('--brightness-filter', `brightness(${_settings.brightness / 100})`);
    }
    if (key === 'pageEffect') {
      els.effectOptions.querySelectorAll('.effect-option').forEach(item => {
        item.classList.toggle('active', item.dataset.effect === _settings.pageEffect);
      });
    }
  }

  function _syncUI() {
    els.brightness.value = _settings.brightness;
    els.fontSize.value = _settings.fontSize;
    els.fontSizeDisplay.textContent = _settings.fontSize;
  }

  // ── GPU / VRAM settings ──────────────────────────

  async function _loadGpuSettings() {
    try {
      const response = await fetch('/api/tts/gpu-settings');
      if (!response.ok) return;
      const data = await response.json();
      if (!data.cudaAvailable) return;

      const gpu = data.gpu || {};
      document.getElementById('gpu-batch-row').style.display = '';
      document.getElementById('gpu-half-row').style.display = '';
      document.getElementById('gpu-cache-row').style.display = '';
      document.getElementById('gpu-vram-row').style.display = '';

      const batchSlider = document.getElementById('gpu-max-batch');
      batchSlider.value = gpu.maxBatchSize || 5;
      document.getElementById('gpu-batch-display').textContent = gpu.maxBatchSize + '句';
      document.getElementById('gpu-half').checked = gpu.useHalfPrecision !== false;
      document.getElementById('gpu-clear-cache').checked = gpu.clearCache !== false;
      const vramSlider = document.getElementById('gpu-max-vram');
      vramSlider.value = gpu.maxVRAM || 80;
      document.getElementById('gpu-vram-display').textContent = gpu.maxVRAM + '%';

      batchSlider.addEventListener('change', () => _saveGpuSetting('maxBatchSize', parseInt(batchSlider.value, 10)));
      batchSlider.addEventListener('input', () => {
        document.getElementById('gpu-batch-display').textContent = batchSlider.value + '句';
      });
      document.getElementById('gpu-half').addEventListener('change', () => {
        _saveGpuSetting('useHalfPrecision', document.getElementById('gpu-half').checked);
      });
      document.getElementById('gpu-clear-cache').addEventListener('change', () => {
        _saveGpuSetting('clearCache', document.getElementById('gpu-clear-cache').checked);
      });
      vramSlider.addEventListener('change', () => _saveGpuSetting('maxVRAM', parseInt(vramSlider.value, 10)));
      vramSlider.addEventListener('input', () => {
        document.getElementById('gpu-vram-display').textContent = vramSlider.value + '%';
      });
    } catch (_e) {}
  }

  async function _saveGpuSetting(key, value) {
    try {
      await fetch('/api/tts/gpu-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
    } catch (_e) {}
  }

  return { init, get, set };
})();
