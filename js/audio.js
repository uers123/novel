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
  let _isPlaying = false;
  let _isPreparing = false;
  let _sentences = [];
  let _sentenceIndex = 0;
  let _voices = [];
  let _voiceId = 'qinglang_male';

  async function init() {
    _voiceId = _loadVoiceId();
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

    _audio.addEventListener('ended', () => {
      _sentenceIndex += 1;
      _playCurrentSentence();
    });
    _audio.addEventListener('error', () => {
      _setInfo('音频播放失败');
      _isPlaying = false;
      _updateUI();
    });

    document.addEventListener('reader:chapter-loaded', () => {
      if (_isPlaying || els.bar.classList.contains('active')) {
        stopOnly();
        show();
      }
    });
  }

  function _loadVoiceId() {
    try {
      const settings = JSON.parse(localStorage.getItem('novel_settings') || '{}');
      return settings.voiceId || settings.voiceName || 'qinglang_male';
    } catch (_e) {
      return 'qinglang_male';
    }
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
      : '本地TTS模型未安装：后端会返回明确错误，安装 MeloTTS 后即可生成音频';
  }

  async function _previewVoice(voice) {
    _setInfo(`试听：${voice.name}`);
    try {
      const result = await _synthesize('这是一段音色试听。', voice.id);
      _audio.src = result.audioUrl;
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
    _isPlaying = true;
    _playCurrentSentence();
    _updateUI();
  }

  function hide() {
    stopOnly();
    els.bar.classList.remove('active');
    els.floatListenBtn.classList.remove('hidden');
    Reader.clearHighlight();
  }

  function stopOnly() {
    _isPlaying = false;
    _isPreparing = false;
    _audio.pause();
    _audio.removeAttribute('src');
    _audio.load();
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
        _audio.play().catch(error => _setInfo(error.message));
      } else {
        _playCurrentSentence();
      }
    }
    _updateUI();
  }

  async function _playCurrentSentence() {
    if (!_isPlaying) return;
    if (_sentenceIndex >= _sentences.length) {
      _setInfo('本章朗读完成');
      _isPlaying = false;
      Reader.clearHighlight();
      _updateUI();
      return;
    }

    const sentence = _sentences[_sentenceIndex];
    Reader.highlightSentence(_sentenceIndex);
    _setInfo(`生成朗读 ${_sentenceIndex + 1}/${_sentences.length}`);
    _isPreparing = true;
    _updateUI();

    try {
      const result = await _synthesize(sentence, _voiceId);
      if (!_isPlaying) return;
      _audio.src = result.audioUrl;
      _setInfo(`播放中 ${_sentenceIndex + 1}/${_sentences.length}`);
      await _audio.play();
    } catch (error) {
      _setInfo(error.message || '后端TTS不可用');
      _isPlaying = false;
    } finally {
      _isPreparing = false;
      _updateUI();
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
  };
})();
