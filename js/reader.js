const Reader = (() => {
  const els = {
    view: document.getElementById('view-reader'),
    backBtn: document.getElementById('btn-back'),
    moreBtn: document.getElementById('btn-more'),
    headerStatus: document.getElementById('header-status'),
    chapterTitle: document.getElementById('chapter-title'),
    chapterText: document.getElementById('chapter-text'),
    progressSlider: document.getElementById('progress-slider'),
    prevLink: document.getElementById('prev-chapter'),
    nextLink: document.getElementById('next-chapter'),
    floatListenBtn: document.getElementById('float-listen-btn'),
  };

  let _currentBookId = null;
  let _currentChapterIndex = 0;
  let _chapters = [];
  let _sentences = [];
  let _isLoading = false;

  function open(bookId, chapters, startIndex) {
    _currentBookId = bookId;
    _chapters = chapters || [];
    _currentChapterIndex = Number(startIndex || 0);

    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    document.getElementById('view-bookshelf').classList.remove('active');
    els.view.classList.add('active');
    els.progressSlider.max = Math.max(0, _chapters.length - 1);
    _loadChapter(_currentChapterIndex);
  }

  function _loadChapter(index) {
    if (_isLoading || !_chapters.length || index < 0 || index >= _chapters.length) return;
    _isLoading = true;
    const previousIndex = _currentChapterIndex;
    _currentChapterIndex = index;

    const chapter = _chapters[index];
    els.chapterTitle.textContent = chapter.title || `第${index + 1}章`;
    els.headerStatus.textContent = `${index + 1}/${_chapters.length}`;
    els.progressSlider.value = index;
    els.prevLink.style.visibility = index > 0 ? 'visible' : 'hidden';
    els.nextLink.style.visibility = index < _chapters.length - 1 ? 'visible' : 'hidden';
    els.chapterText.innerHTML = '<p class="loading-text">章节加载中...</p>';

    _fetchChapterContent(index)
      .then(content => {
        _renderContent(content);
        _runPageEffect(index >= previousIndex ? 'next' : 'prev');
        _saveProgress(index);
        document.dispatchEvent(new CustomEvent('reader:chapter-loaded', { detail: getState() }));
      })
      .catch(() => {
        _renderContent(_getLocalContent(index));
        _runPageEffect(index >= previousIndex ? 'next' : 'prev');
        _saveProgress(index);
      })
      .finally(() => {
        _isLoading = false;
      });
  }

  async function _fetchChapterContent(index) {
    if (!_currentBookId) throw new Error('No book selected');
    const response = await fetch(`/api/novels/${_currentBookId}/chapters/${index}`);
    if (!response.ok) throw new Error('Chapter unavailable');
    const data = await response.json();
    return data.content || '';
  }

  function _getLocalContent(index) {
    const chapter = _chapters[index];
    if (!chapter) return '';
    if (typeof CHAPTER_CONTENT !== 'undefined' && CHAPTER_CONTENT[chapter.id]) {
      const data = CHAPTER_CONTENT[chapter.id];
      if (Array.isArray(data.paragraphs)) return data.paragraphs.join('\n\n');
      return data.content || '';
    }
    return `${chapter.title || `第${index + 1}章`}\n\n暂无章节内容`;
  }

  function _renderContent(content) {
    _sentences = [];
    clearHighlight();
    const text = _htmlToText(content || '');
    if (!text.trim()) {
      els.chapterText.innerHTML = '<p class="empty-text">暂无内容</p>';
      return;
    }

    const paragraphs = text.split(/\n+/).map(item => item.trim()).filter(Boolean);
    const html = paragraphs.map(paragraph => {
      const sentenceHtml = _splitSentences(paragraph).map(sentence => {
        const index = _sentences.length;
        _sentences.push(sentence);
        return `<span class="sentence" data-sentence-index="${index}">${_escapeHtml(sentence)}</span>`;
      }).join('');
      return `<p>${sentenceHtml}</p>`;
    }).join('');

    els.chapterText.innerHTML = html;
    els.view.querySelector('.reader-content').scrollTop = 0;
  }

  function _runPageEffect(direction) {
    const settings = typeof Settings !== 'undefined' ? Settings.get() : {};
    const effect = settings.pageEffect || 'updown';
    els.chapterText.classList.remove(
      'page-transition',
      'page-effect-push',
      'page-effect-cover',
      'page-effect-simulation',
      'page-effect-updown',
      'page-direction-next',
      'page-direction-prev',
    );
    void els.chapterText.offsetWidth;
    els.chapterText.classList.add('page-transition', `page-effect-${effect}`, `page-direction-${direction}`);
    window.setTimeout(() => {
      els.chapterText.classList.remove(
        'page-transition',
        'page-effect-push',
        'page-effect-cover',
        'page-effect-simulation',
        'page-effect-updown',
        'page-direction-next',
        'page-direction-prev',
      );
    }, 360);
  }

  function _splitSentences(text) {
    const matches = text.match(/[^。！？!?；;\n]+[。！？!?；;]?/g);
    return (matches || [text]).map(item => item.trim()).filter(Boolean);
  }

  function _htmlToText(content) {
    if (!content.includes('<')) return content;
    const div = document.createElement('div');
    div.innerHTML = content;
    return div.textContent || '';
  }

  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function _saveProgress(index) {
    try {
      if (typeof Storage !== 'undefined' && _currentBookId) {
        Storage.saveProgress(_currentBookId, { chapterIdx: index, pageIdx: 0, scrollPos: 0 });
        const percent = _chapters.length > 1 ? Math.round((index / (_chapters.length - 1)) * 100) : 0;
        Storage.saveToBookshelf(_currentBookId, { progress: percent });
      }
    } catch (_e) {}

    if (_currentBookId) {
      fetch(`/api/novels/${_currentBookId}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterIndex: index }),
      }).catch(() => {});
    }
  }

  function prevChapter() {
    if (_currentChapterIndex > 0) _loadChapter(_currentChapterIndex - 1);
  }

  function nextChapter() {
    if (_currentChapterIndex < _chapters.length - 1) _loadChapter(_currentChapterIndex + 1);
  }

  function goToChapter(index) {
    const nextIndex = Number(index);
    if (nextIndex >= 0 && nextIndex < _chapters.length) _loadChapter(nextIndex);
  }

  function goBack() {
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    document.getElementById('view-bookshelf').classList.add('active');
    _currentBookId = null;
    clearHighlight();
    if (typeof AudioPlayer !== 'undefined') AudioPlayer.hide();
    if (typeof App !== 'undefined' && App.renderBookshelf) App.renderBookshelf();
  }

  function highlightSentence(index) {
    clearHighlight();
    const el = els.chapterText.querySelector(`[data-sentence-index="${index}"]`);
    if (!el) return;
    el.classList.add('sentence-active');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function clearHighlight() {
    els.chapterText.querySelectorAll('.sentence-active').forEach(el => el.classList.remove('sentence-active'));
  }

  function getState() {
    return {
      bookId: _currentBookId,
      chapterIndex: _currentChapterIndex,
      chapters: _chapters,
      sentences: _sentences.slice(),
    };
  }

  function getCurrentBookId() {
    return _currentBookId;
  }

  function getCurrentChapterText() {
    return els.chapterText.textContent || '';
  }

  function getSentences() {
    return _sentences.slice();
  }

  function init() {
    els.backBtn.addEventListener('click', goBack);
    els.moreBtn.addEventListener('click', () => document.getElementById('menu-modal').classList.add('active'));
    els.progressSlider.addEventListener('input', () => goToChapter(parseInt(els.progressSlider.value, 10)));
    els.prevLink.addEventListener('click', prevChapter);
    els.nextLink.addEventListener('click', nextChapter);
    els.floatListenBtn.addEventListener('click', () => {
      if (typeof AudioPlayer !== 'undefined') {
        AudioPlayer.show();
        els.floatListenBtn.classList.add('hidden');
      }
    });

    document.addEventListener('keydown', event => {
      if (!els.view.classList.contains('active')) return;
      if (event.key === 'ArrowLeft') prevChapter();
      if (event.key === 'ArrowRight') nextChapter();
    });

    let touchStartX = 0;
    els.view.addEventListener('touchstart', event => {
      touchStartX = event.changedTouches[0].screenX;
    }, { passive: true });
    els.view.addEventListener('touchend', event => {
      const diff = event.changedTouches[0].screenX - touchStartX;
      if (Math.abs(diff) > 60) diff > 0 ? prevChapter() : nextChapter();
    }, { passive: true });

    TOC.setChapterClickHandler(index => {
      goToChapter(index);
      TOC.close();
    });
  }

  return {
    init,
    open,
    prevChapter,
    nextChapter,
    goToChapter,
    goBack,
    getState,
    getCurrentBookId,
    getCurrentChapterText,
    getSentences,
    highlightSentence,
    clearHighlight,
  };
})();
