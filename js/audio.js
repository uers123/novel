/**
 * audio.js - 音频播放控制 (图2)
 * 浮动播放栏、TTS 状态管理
 */

const AudioPlayer = (() => {
  const els = {
    bar: document.getElementById('audio-bar'),
    playBtn: document.getElementById('audio-play-btn'),
    pauseIcon: document.getElementById('audio-pause-icon'),
    info: document.getElementById('audio-info'),
    closeBtn: document.getElementById('audio-close'),
    floatListenBtn: document.getElementById('float-listen-btn'),
  };

  let _isPlaying = false;
  let _currentChapterIndex = -1;
  let _currentSentenceIndex = 0;
  let _sentences = [];
  let _speechSynth = window.speechSynthesis;
  let _utterance = null;

  /** 显示播放栏 */
  function show() {
    els.bar.classList.add('active');
    _updateInfo();

    // 准备文本
    _prepareSentences();

    if (!_isPlaying) {
      _startPlayback();
    }
  }

  /** 隐藏播放栏 */
  function hide() {
    _stopPlayback();
    els.bar.classList.remove('active');
    els.floatListenBtn.classList.remove('hidden');
  }

  /** 切换播放/暂停 */
  function togglePlay() {
    if (_isPlaying) {
      _pausePlayback();
    } else {
      _resumePlayback();
    }
  }

  /** 准备句子列表 */
  function _prepareSentences() {
    try {
      const text = Reader.getCurrentChapterText();
      if (!text) {
        _sentences = ['暂无内容可播放'];
        return;
      }
      // 按标点分句
      _sentences = text
        .split(/[。！？\n！？\n]+/)
        .map(s => s.trim())
        .filter(s => s.length > 3);

      if (_sentences.length === 0) {
        _sentences = [text.substring(0, 100)];
      }
    } catch (e) {
      _sentences = ['无法获取文本'];
    }
    _currentSentenceIndex = 0;
  }

  /** 开始播放 */
  function _startPlayback() {
    if (!_speechSynth) {
      els.info.textContent = '浏览器不支持语音';
      return;
    }

    _isPlaying = true;
    _updateUI();
    _speakNext();
  }

  /** 暂停播放 */
  function _pausePlayback() {
    _isPlaying = false;
    _updateUI();
    if (_speechSynth && _speechSynth.speaking) {
      _speechSynth.pause();
    }
    els.info.textContent = '已暂停';
  }

  /** 恢复播放 */
  function _resumePlayback() {
    _isPlaying = true;
    _updateUI();
    if (_speechSynth && _speechSynth.paused) {
      _speechSynth.resume();
      els.info.textContent = '播放中';
    } else {
      _speakNext();
    }
  }

  /** 停止播放 */
  function _stopPlayback() {
    _isPlaying = false;
    if (_speechSynth) {
      _speechSynth.cancel();
    }
    _updateUI();
  }

  /** 朗读下一句 */
  function _speakNext() {
    if (!_isPlaying || !_speechSynth) return;

    if (_currentSentenceIndex >= _sentences.length) {
      // 播完当前章节
      els.info.textContent = '本章结束';
      _isPlaying = false;
      _updateUI();
      return;
    }

    const text = _sentences[_currentSentenceIndex];
    _utterance = new SpeechSynthesisUtterance(text);
    _utterance.lang = 'zh-CN';
    _utterance.rate = 0.9;
    _utterance.pitch = 1.0;
    _utterance.volume = 1.0;

    // 获取保存的音色偏好
    try {
      const settings = JSON.parse(localStorage.getItem('novel_settings') || '{}');
      if (settings.voiceName) {
        const voices = _speechSynth.getVoices();
        const matched = voices.find(v => v.name.includes(settings.voiceName));
        if (matched) _utterance.voice = matched;
      }
    } catch (e) { /* silent */ }

    _utterance.onend = () => {
      _currentSentenceIndex++;
      _speakNext();
    };

    _utterance.onerror = () => {
      _currentSentenceIndex++;
      _speakNext();
    };

    _speechSynth.speak(_utterance);
    els.info.textContent = `播放中 ${_currentSentenceIndex + 1}/${_sentences.length}`;
  }

  /** 更新 UI 状态 */
  function _updateUI() {
    // 红点指示器
    const indicator = els.playBtn.querySelector('.play-indicator');
    if (indicator) {
      indicator.style.background = _isPlaying ? '#2ECC71' : '#E74C3C';
    }

    // 暂停图标
    els.pauseIcon.textContent = _isPlaying ? '❚❚' : '▶';
  }

  function _updateInfo() {
    try {
      const state = Reader.getState();
      const ch = state.chapters[state.chapterIndex];
      els.info.textContent = ch ? ch.title : '播放器';
    } catch (e) {
      els.info.textContent = '播放器';
    }
  }

  // ============ 事件绑定 ============

  function init() {
    els.playBtn.addEventListener('click', togglePlay);
    els.pauseIcon.addEventListener('click', togglePlay);
    els.closeBtn.addEventListener('click', hide);
  }

  return { init, show, hide, togglePlay };
})();
