/**
 * reader.js - 阅读引擎
 * 章节显示、翻页、进度管理，对应图1
 */

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
  let _isLoading = false;

  /** 打开阅读页 */
  function open(bookId, chapters, startIndex) {
    _currentBookId = bookId;
    _chapters = chapters || [];
    _currentChapterIndex = startIndex || 0;

    // 切换视图
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    els.view.classList.add('active');
    document.getElementById('view-bookshelf').classList.remove('active');

    // 设置进度条范围
    els.progressSlider.max = Math.max(0, _chapters.length - 1);

    // 加载章节
    _loadChapter(_currentChapterIndex);
  }

  /** 加载指定章节 */
  function _loadChapter(index) {
    if (_isLoading) return;
    if (!_chapters || !_chapters.length) return;
    if (index < 0 || index >= _chapters.length) return;

    _isLoading = true;
    _currentChapterIndex = index;

    const ch = _chapters[index];
    els.chapterTitle.textContent = ch.title || `第${index + 1}章`;
    els.progressSlider.value = index;

    // 更新底部链接状态
    els.prevLink.style.visibility = index > 0 ? 'visible' : 'hidden';
    els.nextLink.style.visibility = index < _chapters.length - 1 ? 'visible' : 'hidden';

    // 尝试从后端获取内容
    _fetchChapterContent(index)
      .then(content => {
        _renderContent(content);
        _isLoading = false;
      })
      .catch(() => {
        // 降级：使用本地数据
        const localContent = _getLocalContent(index);
        _renderContent(localContent);
        _isLoading = false;
      });

    // 保存进度
    _saveProgress(index);
  }

  /** 从后端获取章节内容 */
  async function _fetchChapterContent(index) {
    if (!_currentBookId) throw new Error('No book selected');

    const resp = await fetch(`/api/novels/${_currentBookId}/chapters/${index}`);
    if (!resp.ok) throw new Error('Not found');

    const data = await resp.json();
    return data.content || '';
  }

  /** 从本地数据获取内容 */
  function _getLocalContent(index) {
    const ch = _chapters[index];
    if (!ch) return '';

    // 尝试从 CHAPTER_CONTENT 获取
    const contentId = ch.id;
    if (typeof CHAPTER_CONTENT !== 'undefined' && CHAPTER_CONTENT[contentId]) {
      const data = CHAPTER_CONTENT[contentId];
      if (data.paragraphs && Array.isArray(data.paragraphs)) {
        return data.paragraphs.map(p => `<p>${p}</p>`).join('');
      }
      return data.content || '';
    }

    return `<p>${ch.title || `第${index + 1}章`} - 内容加载中...</p>`;
  }

  /** 渲染内容 */
  function _renderContent(content) {
    if (!content) {
      els.chapterText.innerHTML = '<p style="color:var(--text-secondary);text-align:center;">暂无内容</p>';
      return;
    }

    // 如果内容已经是 HTML
    if (content.includes('<p>') || content.includes('<div>')) {
      els.chapterText.innerHTML = content;
    } else {
      // 纯文本 -> 按段落分割
      const paragraphs = content.split('\n').filter(p => p.trim());
      const html = paragraphs.map(p => `<p>${_escapeHtml(p.trim())}</p>`).join('');
      els.chapterText.innerHTML = html;
    }

    // 滚动到顶部
    els.view.querySelector('.reader-content').scrollTop = 0;
  }

  /** HTML 转义 */
  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /** 保存阅读进度 */
  function _saveProgress(index) {
    try {
      if (typeof Storage !== 'undefined' && _currentBookId) {
        Storage.saveProgress(_currentBookId, {
          chapterIdx: index,
          pageIdx: 0,
          scrollPos: 0,
        });
        Storage.saveToBookshelf(_currentBookId, { progress: Math.round((index / _chapters.length) * 100) });
      }
    } catch (e) { /* silent */ }

    // 同步到后端
    if (_currentBookId) {
      fetch(`/api/novels/${_currentBookId}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterIndex: index }),
      }).catch(() => {});
    }
  }

  /** 翻到上一章 */
  function prevChapter() {
    if (_currentChapterIndex > 0) {
      _loadChapter(_currentChapterIndex - 1);
    }
  }

  /** 翻到下一章 */
  function nextChapter() {
    if (_currentChapterIndex < _chapters.length - 1) {
      _loadChapter(_currentChapterIndex + 1);
    }
  }

  /** 跳转到指定章节 */
  function goToChapter(index) {
    if (index >= 0 && index < _chapters.length) {
      _loadChapter(index);
    }
  }

  /** 返回书架 */
  function goBack() {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-bookshelf').classList.add('active');
    _currentBookId = null;

    // 重建书架
    if (typeof App !== 'undefined' && App.renderBookshelf) {
      App.renderBookshelf();
    }
  }

  /** 获取当前状态 */
  function getState() {
    return {
      bookId: _currentBookId,
      chapterIndex: _currentChapterIndex,
      chapters: _chapters,
    };
  }

  function getCurrentBookId() {
    return _currentBookId;
  }

  /** 获取当前章节文本（用于翻译/音频） */
  function getCurrentChapterText() {
    return els.chapterText.textContent;
  }

  // ============ 事件绑定 ============

  function init() {
    // 返回
    els.backBtn.addEventListener('click', goBack);

    // 更多菜单
    els.moreBtn.addEventListener('click', () => {
      document.getElementById('menu-modal').classList.add('active');
    });

    // 进度条拖动
    els.progressSlider.addEventListener('input', () => {
      const idx = parseInt(els.progressSlider.value);
      if (idx !== _currentChapterIndex) {
        _loadChapter(idx);
      }
    });

    // 上一章/下一章
    els.prevLink.addEventListener('click', prevChapter);
    els.nextLink.addEventListener('click', nextChapter);

    // 悬浮听按钮
    els.floatListenBtn.addEventListener('click', () => {
      if (typeof AudioPlayer !== 'undefined') {
        AudioPlayer.show();
        els.floatListenBtn.classList.add('hidden');
      }
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (!els.view.classList.contains('active')) return;
      if (e.key === 'ArrowLeft') prevChapter();
      if (e.key === 'ArrowRight') nextChapter();
    });

    // 触屏滑动
    let touchStartX = 0;
    els.view.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    els.view.addEventListener('touchend', (e) => {
      const diff = e.changedTouches[0].screenX - touchStartX;
      if (Math.abs(diff) > 60) {
        if (diff > 0) prevChapter();
        else nextChapter();
      }
    }, { passive: true });

    // 关联目录点击
    TOC.setChapterClickHandler((index) => {
      goToChapter(index);
      TOC.close();
    });
  }

  return {
    init, open, prevChapter, nextChapter, goToChapter, goBack,
    getState, getCurrentBookId, getCurrentChapterText,
  };
})();
