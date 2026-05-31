const AudioPlayer = (() => {
  const els = {
    bar: document.getElementById('audio-bar'),
    playBtn: document.getElementById('audio-play-btn'),
    pauseIcon: document.getElementById('audio-pause-icon'),
    info: document.getElementById('audio-info'),
    closeBtn: document.getElementById('audio-close'),
    floatListenBtn: document.getElementById('float-listen-btn'),
    voicesModal: document.getElementById('voices-modal'),
    voicesClose: document.getElementById('voices-close'),
    voicesGrid: document.getElementById('voices-grid'),
    voicesNote: document.getElementById('voices-note'),
  };

  const _audio = new Audio();
  const _nextAudio = new Audio();  // Preload buffer for seamless transition
  let _isPlaying = false;
  let _isPreparing = false;
  let _sentences = [];
  let _sentenceIndex = 0;
  let _voices = [];
  let _voiceId = 'qinglang_male';
  let _prefetchCache = {};
  let _isPrefetching = false;
  let _speed = 1.0;

  async function init() {
    _voiceId = _loadVoiceId();
    _speed = _loadSpeed();
    await loadVoices();
    _bindEvents();
  }

  function _bindEvents() {
    els.playBtn.addEventListener('click', togglePlay);
    els.pauseIcon.addEventListener('click', togglePlay);
    els.closeBtn.addEventListener('click', hide);
    document.getElementById('nav-voices').addEventListener('click', openVoices);
    els.voicesClose.addEventListener('click', closeVoices);
    els.voicesModal.addEventListener('click', event => {
      if (event.target === els.voicesModal) closeVoices();
    });

    // When current audio ends, seamlessly switch to preloaded next audio
    _audio.addEventListener('ended', () => {
      _swapToNext();
    });
    _audio.addEventListener('error', () => {
      _setInfo('音频播放失败');
      _isPlaying = false;
      _updateUI();
    });
    // Preload next sentence when nearing end of current one
    _audio.addEventListener('timeupdate', () => {
      if (!_isPlaying) return;
      const remaining = _audio.duration - _audio.currentTime;
      if (remaining > 0 && remaining < 1.5 && !_nextAudio.src) {
        _preloadNext();
      }
    });

    _nextAudio.addEventListener('canplaythrough', () => {
      // Next audio is buffered and ready — just wait for current to end
    });

    document.addEventListener('reader:chapter-loaded', () => {
      if (_isPlaying || els.bar.classList.contains('active')) {
        stopOnly();
        show();
      }
    });
  }

  function _swapToNext() {
    if (_nextAudio.src) {
      // Swap: next becomes current
      const nextSrc = _nextAudio.src;
      _nextAudio.removeAttribute('src');
      _nextAudio.load();
      _sentenceIndex += 1;
      _playFromBuffer(nextSrc);
    } else {
      _sentenceIndex += 1;
      _playCurrentSentence();
    }
  }

  function _playFromBuffer(src) {
    if (!_isPlaying) return;
    if (_sentenceIndex >= _sentences.length) {
      _finishChapter();
      return;
    }
    Reader.highlightSentence(_sentenceIndex);
    _setInfo(`播放中 ${_sentenceIndex + 1}/${_sentences.length}`);
    _audio.src = src;
    _audio.playbackRate = _speed;
    _audio.play().catch(() => {
      // Fallback: synthesize and play
      _playCurrentSentence();
    });
    _prefetchRemaining();
  }

  function _preloadNext() {
    const nextIdx = _sentenceIndex + 1;
    if (nextIdx >= _sentences.length || _nextAudio.src) return;

    const cached = _prefetchCache[nextIdx];
    if (cached && cached.audioUrl) {
      _nextAudio.src = cached.audioUrl;
      _nextAudio.playbackRate = _speed;
      _nextAudio.load();
    }
  }

  function _loadVoiceId() {
    try {
      const settings = JSON.parse(localStorage.getItem('novel_settings') || '{}');
      return settings.voiceId || settings.voiceName || 'qinglang_male';
    } catch (_e) {
      return 'qinglang_male';
    }
  }

  function _loadSpeed() {
    try {
      return parseFloat(localStorage.getItem('novel_tts_speed')) || 1.0;
    } catch (_e) {
      return 1.0;
    }
  }

  function _saveSpeed(speed) {
    _speed = speed;
    _audio.playbackRate = speed;
    _nextAudio.playbackRate = speed;
    try {
      localStorage.setItem('novel_tts_speed', String(speed));
    } catch (_e) {}
  }

  function _saveVoiceId(voiceId) {
    _voiceId = voiceId;
    try {
      const settings = JSON.parse(localStorage.getItem('novel_settings') || '{}');
      settings.voiceId = voiceId;
      localStorage.setItem('novel_settings', JSON.stringify(settings));
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      }).catch(() => {});
    } catch (_e) {}
  }

  async function loadVoices() {
    try {
      const response = await fetch('/api/tts/voices');
      const data = await response.json();
      _voices = data.voices || [];
    } catch (_e) {
      _voices = [];
    }
    if (!_voices.length) {
      _voices = [
        { id: 'qinglang_male', name: '清朗男声', avatar: '朗', installed: false },
        { id: 'gentle_female', name: '温柔女声', avatar: '温', installed: false },
      ];
    }
    _renderVoices();
  }

  function _renderVoices() {
    els.voicesGrid.innerHTML = '';
    _voices.forEach(voice => {
      const card = document.createElement('button');
      card.className = `voice-card ${voice.id === _voiceId ? 'active' : ''}`;
      card.innerHTML = `
        <span class="voice-avatar">${voice.avatar || '声'}</span>
        ${voice.installed ? '' : '<span class="voice-download">↓</span>'}
        <span class="voice-name">${voice.name}</span>
      `;
      card.addEventListener('click', () => {
        _saveVoiceId(voice.id);
        _renderVoices();
        _previewVoice(voice);
      });
      els.voicesGrid.appendChild(card);
    });

    const installed = _voices.some(voice => voice.installed);
    els.voicesNote.textContent = installed
      ? '点击音色可试听并设为默认朗读音色'
      : '本地TTS模型未安装：后端会返回明确错误，安装 ChatTTS 后即可生成音频';

    // Add speed control below the note
    _renderSpeedControl();
  }

  function _renderSpeedControl() {
    // Remove existing speed control if present
    const existing = document.querySelector('.tts-speed-control');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.className = 'tts-speed-control';
    container.style.cssText = 'padding:0 20px 16px;border-top:1px solid var(--divider-color);margin-top:4px';

    const labelRow = document.createElement('div');
    labelRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px';

    const label = document.createElement('span');
    label.style.cssText = 'font-size:13px;color:var(--text-secondary)';
    label.textContent = '语速';

    const value = document.createElement('span');
    value.id = 'speed-display';
    value.style.cssText = 'font-size:13px;color:var(--text-primary);font-weight:600;min-width:32px;text-align:right';
    value.textContent = `${_speed.toFixed(1)}x`;

    labelRow.appendChild(label);
    labelRow.appendChild(value);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0.5';
    slider.max = '2.0';
    slider.step = '0.1';
    slider.value = String(_speed);
    slider.style.cssText = 'width:100%';

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      document.getElementById('speed-display').textContent = `${val.toFixed(1)}x`;
    });
    slider.addEventListener('change', () => {
      const val = parseFloat(slider.value);
      _saveSpeed(val);
    });

    container.appendChild(labelRow);
    container.appendChild(slider);

    // Insert after voices-note
    els.voicesNote.parentNode.insertBefore(container, els.voicesNote.nextSibling);
  }

  async function _previewVoice(voice) {
    _setInfo(`试听：${voice.name}`);
    try {
      const result = await _synthesize('这是一段音色试听。', voice.id);
      _audio.src = result.audioUrl;
      _audio.playbackRate = _speed;
      await _audio.play();
    } catch (error) {
      _setInfo(error.message || '试听失败');
    }
  }

  function openVoices() {
    _renderVoices();
    els.voicesModal.classList.add('active');
  }

  function closeVoices() {
    els.voicesModal.classList.remove('active');
  }

  function show() {
    _sentences = Reader.getSentences();
    if (!_sentences.length) {
      _setInfo('当前章节没有可朗读文本');
      return;
    }
    els.bar.classList.add('active');
    els.floatListenBtn.classList.add('hidden');
    _sentenceIndex = 0;
    _prefetchCache = {};
    _nextAudio.removeAttribute('src');
    _nextAudio.load();
    _isPlaying = true;
    _playCurrentSentence();
    _updateUI();
  }

  function hide() {
    stopOnly();
    els.bar.classList.remove('active');
    els.floatListenBtn.classList.remove('hidden');
    Reader.clearHighlight();
    _prefetchCache = {};
    _nextAudio.removeAttribute('src');
    _nextAudio.load();
  }

  function stopOnly() {
    _isPlaying = false;
    _isPreparing = false;
    _isPrefetching = false;
    _audio.pause();
    _audio.removeAttribute('src');
    _audio.load();
    _nextAudio.removeAttribute('src');
    _nextAudio.load();
    _updateUI();
  }

  function togglePlay() {
    if (_isPreparing) return;
    if (_isPlaying) {
      _isPlaying = false;
      _audio.pause();
      _setInfo('已暂停');
    } else {
      _isPlaying = true;
      if (_audio.src && _audio.currentTime > 0 && !_audio.ended) {
        _audio.playbackRate = _speed;
        _audio.play().catch(error => _setInfo(error.message));
      } else {
        _playCurrentSentence();
      }
    }
    _updateUI();
  }

  function _finishChapter() {
    _setInfo('本章朗读完成');
    _isPlaying = false;
    _isPrefetching = false;
    Reader.clearHighlight();
    _updateUI();
  }

  async function _playCurrentSentence() {
    if (!_isPlaying) return;

    if (_sentenceIndex >= _sentences.length) {
      _finishChapter();
      return;
    }

    const sentence = _sentences[_sentenceIndex];
    Reader.highlightSentence(_sentenceIndex);
    _setInfo(`生成朗读 ${_sentenceIndex + 1}/${_sentences.length}`);
    _isPreparing = true;
    _updateUI();

    try {
      let result = _prefetchCache[_sentenceIndex];
      if (!result) {
        result = await _synthesize(sentence, _voiceId);
      }
      if (!_isPlaying) return;

      _audio.src = result.audioUrl;
      _audio.playbackRate = _speed;
      _setInfo(`播放中 ${_sentenceIndex + 1}/${_sentences.length}`);
      await _audio.play();

      _prefetchRemaining();
    } catch (error) {
      _setInfo(error.message || '后端TTS不可用');
      _isPlaying = false;
      _isPrefetching = false;
    } finally {
      _isPreparing = false;
      _updateUI();
    }
  }

  async function _prefetchRemaining() {
    if (_isPrefetching) return;
    _isPrefetching = true;

    const start = _sentenceIndex + 1;
    const end = Math.min(start + 20, _sentences.length);
    if (start >= end) { _isPrefetching = false; return; }

    const batchTexts = [];
    const batchIndices = [];
    for (let i = start; i < end; i++) {
      if (_prefetchCache[i]) continue;
      batchTexts.push(_sentences[i]);
      batchIndices.push(i);
    }

    if (batchTexts.length === 0) { _isPrefetching = false; return; }

    try {
      const response = await fetch('/api/tts/synthesize_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: batchTexts, voiceId: _voiceId }),
      });
      if (!response.ok) { _isPrefetching = false; return; }
      const data = await response.json();
      if (data.results) {
        data.results.forEach((item, idx) => {
          const origIndex = batchIndices[idx];
          if (origIndex !== undefined && item.audioUrl) {
            _prefetchCache[origIndex] = { audioUrl: item.audioUrl };
          }
        });
      }
    } catch (_e) {
    } finally {
      _isPrefetching = false;
    }
  }

  async function _synthesize(text, voiceId) {
    const response = await fetch('/api/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || '后端TTS服务不可用');
    }
    return data;
  }

  function setSpeed(speed) {
    _saveSpeed(speed);
  }

  function _setInfo(text) {
    els.info.textContent = text;
  }

  function _updateUI() {
    const indicator = els.playBtn.querySelector('.play-indicator');
    if (indicator) indicator.style.background = _isPlaying ? '#2ECC71' : '#E74C3C';
    els.pauseIcon.textContent = _isPlaying ? 'Ⅱ' : '▶';
  }

  return {
    init,
    show,
    hide,
    togglePlay,
    loadVoices,
    setSpeed,
  };
})();
