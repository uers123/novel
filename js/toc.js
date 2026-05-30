/**
 * toc.js - 目录管理
 * 侧滑目录面板、章节导航
 */

const TOC = (() => {
  const els = {
    modal: document.getElementById('toc-modal'),
    close: document.getElementById('toc-close'),
    body: document.getElementById('toc-body'),
  };

  let _currentBookId = null;
  let _chapters = [];

  /** 打开目录 */
  function open(bookId, chapters, currentIndex) {
    _currentBookId = bookId;
    _chapters = chapters || [];
    _render(currentIndex);
    els.modal.classList.add('active');
  }

  /** 渲染目录列表 */
  function _render(activeIndex) {
    els.body.innerHTML = '';
    if (!_chapters.length) {
      els.body.innerHTML = '<div class="toc-item" style="color:var(--text-secondary)">暂无章节</div>';
      return;
    }

    _chapters.forEach((ch, i) => {
      const div = document.createElement('div');
      div.className = 'toc-item' + (i === activeIndex ? ' active' : '');
      div.textContent = ch.title || `第${i + 1}章`;
      div.addEventListener('click', () => _onChapterClick(i));
      els.body.appendChild(div);
    });
  }

  /** 点击章节回调 */
  let _onChapterClick = (index) => {
    // 由 reader.js 覆盖
    console.log('Navigate to chapter:', index);
  };

  function setChapterClickHandler(handler) {
    _onChapterClick = handler;
  }

  function init() {
    document.getElementById('nav-toc').addEventListener('click', () => {
      // 如果当前正在阅读，打开当前书籍的目录
      if (typeof Reader !== 'undefined' && Reader.getCurrentBookId()) {
        const state = Reader.getState();
        const novel = window._currentNovel;
        if (novel && novel.chapters) {
          open(novel.id, novel.chapters, state.chapterIndex);
        }
      } else {
        open(null, [], 0);
      }
    });

    els.close.addEventListener('click', () => {
      els.modal.classList.remove('active');
    });
    els.modal.addEventListener('click', (e) => {
      if (e.target === els.modal) els.modal.classList.remove('active');
    });
  }

  function close() {
    els.modal.classList.remove('active');
  }

  return { init, open, close, setChapterClickHandler };
})();
