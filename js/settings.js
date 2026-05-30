/**
 * settings.js - 设置面板 (图3)
 * 亮度、字号、背景色、翻页效果、主题切换
 */

const Settings = (() => {
  // DOM 引用
  const $ = id => document.getElementById(id);

  const els = {
    modal: $('settings-modal'),
    close: $('settings-close'),
    brightness: $('brightness-slider'),
    fontSize: $('fontsize-slider'),
    fontSizeDisplay: $('fontsize-display'),
    colorPalette: $('color-palette'),
    effectOptions: $('page-effect-options'),
    eyeCare: $('set-eye-care'),
    autoRead: $('set-auto-read'),
    readerContent: $('reader-content'),
    chapterText: $('chapter-text'),
  };

  // 默认设置
  let _settings = {
    theme: 'day',
    fontSize: 16,
    lineHeight: 1.8,
    bgColor: '#F9F7F4',
    pageEffect: 'updown',
    brightness: 100,
  };

  /** 从 localStorage 加载设置 */
  function load() {
    try {
      const saved = Storage ? Storage.getSettings() : null;
      if (saved) {
        _settings = { ..._settings, ...saved };
      }
    } catch (e) {
      // fallback to defaults
    }
    _applyAll();
  }

  /** 获取当前设置 */
  function get() {
    return { ..._settings };
  }

  /** 保存到 localStorage + 后端 */
  function _persist() {
    try {
      if (typeof Storage !== 'undefined') {
        Storage.saveSettings(_settings);
      }
      // 同步到后端
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(_settings),
      }).catch(() => {});
    } catch (e) { /* silent */ }
  }

  /** 应用所有设置 */
  function _applyAll() {
    _applyTheme();
    _applyFontSize();
    _applyBgColor();
    _applyBrightness();
    _applyPageEffect();
    _syncUI();
  }

  /** 应用主题 */
  function _applyTheme() {
    document.documentElement.setAttribute('data-theme', _settings.theme);
  }

  /** 应用字号 */
  function _applyFontSize() {
    const root = document.documentElement;
    root.style.setProperty('--reader-font-size', _settings.fontSize + 'px');
    els.fontSizeDisplay.textContent = _settings.fontSize;
  }

  /** 应用背景色 */
  function _applyBgColor() {
    els.readerContent.style.backgroundColor = _settings.bgColor;
    // 更新色板选中状态
    els.colorPalette.querySelectorAll('.color-swatch').forEach(el => {
      const color = el.dataset.color;
      el.classList.toggle('active', color === _settings.bgColor);
    });
  }

  /** 应用亮度 */
  function _applyBrightness() {
    const bright = _settings.brightness / 100;
    document.body.style.setProperty('--brightness-filter', `brightness(${bright})`);
  }

  /** 应用翻页效果 */
  function _applyPageEffect() {
    els.effectOptions.querySelectorAll('.effect-option').forEach(el => {
      el.classList.toggle('active', el.dataset.effect === _settings.pageEffect);
    });
  }

  /** 同步 UI 控件值与当前设置 */
  function _syncUI() {
    els.brightness.value = _settings.brightness;
    els.fontSize.value = _settings.fontSize;
    els.fontSizeDisplay.textContent = _settings.fontSize;
  }

  /** 修改单个设置项 */
  function set(key, value) {
    _settings[key] = value;
    _persist();

    switch (key) {
      case 'theme': _applyTheme(); break;
      case 'fontSize': _applyFontSize(); break;
      case 'bgColor': _applyBgColor(); break;
      case 'brightness': _applyBrightness(); break;
      case 'pageEffect': _applyPageEffect(); break;
    }
  }

  // ============ 事件绑定 ============

  function init() {
    // 打开/关闭
    document.getElementById('nav-settings').addEventListener('click', () => {
      els.modal.classList.add('active');
    });
    els.close.addEventListener('click', () => {
      els.modal.classList.remove('active');
    });
    els.modal.addEventListener('click', (e) => {
      if (e.target === els.modal) els.modal.classList.remove('active');
    });

    // 亮度
    els.brightness.addEventListener('input', () => {
      _settings.brightness = parseInt(els.brightness.value);
      _applyBrightness();
    });
    els.brightness.addEventListener('change', _persist);

    // 字号
    els.fontSize.addEventListener('input', () => {
      _settings.fontSize = parseInt(els.fontSize.value);
      _applyFontSize();
    });
    els.fontSize.addEventListener('change', _persist);

    // 背景色板
    els.colorPalette.addEventListener('click', (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;
      _settings.bgColor = swatch.dataset.color;
      _applyBgColor();
      _persist();
    });

    // 翻页效果
    els.effectOptions.addEventListener('click', (e) => {
      const opt = e.target.closest('.effect-option');
      if (!opt) return;
      _settings.pageEffect = opt.dataset.effect;
      _applyPageEffect();
      _persist();
    });

    // 护眼模式 = 切换到护眼主题
    els.eyeCare.addEventListener('click', () => {
      set('theme', _settings.theme === 'eye' ? 'day' : 'eye');
      // 更新夜间按钮图标
      const nightBtn = document.getElementById('nav-night');
      if (nightBtn) {
        nightBtn.innerHTML = _settings.theme === 'night' ? '☀<span>日间</span>' : '🌙<span>夜间</span>';
      }
    });

    // 夜间模式快捷切换 (底部导航)
    document.getElementById('nav-night').addEventListener('click', () => {
      const themes = ['day', 'night', 'eye', 'parchment'];
      const current = themes.indexOf(_settings.theme);
      const next = themes[(current + 1) % themes.length];
      set('theme', next);
      const nightBtn = document.getElementById('nav-night');
      nightBtn.innerHTML = next === 'night' ? '☀<span>日间</span>' : '🌙<span>夜间</span>';
    });

    // 加载设置
    load();
  }

  return { init, load, get, set };
})();
