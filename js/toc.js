const TOC = (() => {
  const els = {
    modal: document.getElementById('toc-modal'),
    close: document.getElementById('toc-close'),
    body: document.getElementById('toc-body'),
  };

  let _chapters = [];
  let _onChapterClick = index => console.log('Navigate to chapter:', index);

  function open(_bookId, chapters, currentIndex) {
    _chapters = chapters || [];
    _render(currentIndex);
    els.modal.classList.add('active');
  }

  function _render(activeIndex) {
    els.body.innerHTML = '';
    if (!_chapters.length) {
      els.body.innerHTML = '<div class="toc-item empty">暂无章节</div>';
      return;
    }
    _chapters.forEach((chapter, index) => {
      const item = document.createElement('button');
      item.className = `toc-item ${index === activeIndex ? 'active' : ''}`;
      item.textContent = chapter.title || `第${index + 1}章`;
      item.addEventListener('click', () => _onChapterClick(index));
      els.body.appendChild(item);
    });
  }

  function setChapterClickHandler(handler) {
    _onChapterClick = handler;
  }

  function close() {
    els.modal.classList.remove('active');
  }

  function init() {
    document.getElementById('nav-toc').addEventListener('click', () => {
      if (typeof Reader !== 'undefined' && Reader.getCurrentBookId()) {
        const state = Reader.getState();
        const novel = window._currentNovel;
        open(novel && novel.id, state.chapters, state.chapterIndex);
      } else {
        open(null, [], 0);
      }
    });
    els.close.addEventListener('click', close);
    els.modal.addEventListener('click', event => {
      if (event.target === els.modal) close();
    });
  }

  return { init, open, close, setChapterClickHandler };
})();
