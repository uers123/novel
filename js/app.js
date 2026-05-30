const App = (() => {
  let _novels = [];
  window._currentNovel = null;

  async function init() {
    Settings.init();
    TOC.init();
    Reader.init();
    await AudioPlayer.init();
    _bindTabs();
    _bindImportEvents();
    _bindMenuEvents();
    _bindTranslationEvents();
    await _loadNovels();
    if (_novels.length === 0) _loadLocalBooks();
    renderBookshelf();
  }

  async function _loadNovels() {
    try {
      const response = await fetch('/api/novels');
      if (response.ok) {
        const data = await response.json();
        _novels = data.novels || [];
        return;
      }
    } catch (_e) {}
    _novels = [];
  }

  function _loadLocalBooks() {
    if (typeof BOOKS_DATA === 'undefined') return;
    _novels = BOOKS_DATA.map(book => ({
      id: book.id,
      title: book.title,
      author: book.author,
      coverColor: book.coverColor,
      progress: book.progress || 0,
      description: book.description,
      chapterCount: (book.chapters || []).length,
      local: true,
    }));
  }

  function renderBookshelf(filter) {
    const grid = document.getElementById('bookshelf-grid');
    grid.innerHTML = '';
    let books = _novels.slice();
    if (filter === 'reading') books = books.filter(book => book.progress > 0 && book.progress < 100);
    if (filter === 'done') books = books.filter(book => book.progress >= 100);

    if (!books.length) {
      grid.innerHTML = `
        <div class="empty-bookshelf">
          <div class="empty-icon">书</div>
          <p>书架空空如也</p>
          <span>点击右下角 + 导入小说</span>
        </div>
      `;
      return;
    }

    books.forEach(book => {
      const card = document.createElement('button');
      card.className = 'book-card';
      card.innerHTML = `
        <div class="book-cover" style="background:${book.coverColor || '#5A7A9A'}">${_escapeHtml((book.title || '?')[0])}</div>
        <div class="book-title">${_escapeHtml(book.title || '未命名')}</div>
        <div class="book-author">${_escapeHtml(book.author || '')}</div>
        <div class="book-progress"><div class="book-progress-bar" style="width:${book.progress || 0}%"></div></div>
      `;
      card.addEventListener('click', () => _openBook(book));
      grid.appendChild(card);
    });
  }

  async function _openBook(book) {
    window._currentNovel = book;
    if (book.local) {
      const localBook = typeof BOOKS_DATA !== 'undefined' ? BOOKS_DATA.find(item => item.id === book.id) : null;
      if (localBook) {
        const progress = Storage.getProgress(book.id);
        window._currentNovel = { ...book, chapters: localBook.chapters };
        Reader.open(book.id, localBook.chapters, progress.chapterIdx || 0);
      }
      return;
    }

    try {
      const response = await fetch(`/api/novels/${book.id}`);
      if (!response.ok) throw new Error('无法打开小说');
      const data = await response.json();
      window._currentNovel = data;
      Reader.open(book.id, data.chapters || [], data.progress || 0);
    } catch (error) {
      alert(error.message || '打开小说失败');
    }
  }

  function _bindTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(item => item.classList.remove('active'));
        tab.classList.add('active');
        renderBookshelf(tab.dataset.tab);
      });
    });
  }

  function _bindImportEvents() {
    const importModal = document.getElementById('import-modal');
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const importSubmit = document.getElementById('import-submit');
    const crawlSubmit = document.getElementById('crawl-submit');
    const crawlUrl = document.getElementById('crawl-url');
    const crawlProgress = document.getElementById('crawl-progress');
    const crawlProgressText = document.getElementById('crawl-progress-text');

    document.getElementById('btn-import').addEventListener('click', () => importModal.classList.add('active'));
    document.getElementById('import-close').addEventListener('click', () => importModal.classList.remove('active'));
    importModal.addEventListener('click', event => {
      if (event.target === importModal) importModal.classList.remove('active');
    });

    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', event => {
      event.preventDefault();
      uploadZone.classList.add('dragging');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragging'));
    uploadZone.addEventListener('drop', event => {
      event.preventDefault();
      uploadZone.classList.remove('dragging');
      if (event.dataTransfer.files.length) {
        fileInput.files = event.dataTransfer.files;
        _handleFileSelect(event.dataTransfer.files[0]);
      }
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) _handleFileSelect(fileInput.files[0]);
    });
    importSubmit.addEventListener('click', _doImport);

    crawlSubmit.addEventListener('click', async () => {
      const url = crawlUrl.value.trim();
      if (!url) {
        alert('请输入小说目录页 URL');
        return;
      }

      crawlProgress.style.display = 'block';
      crawlProgressText.textContent = '正在导入目录并预抓100章...';
      crawlSubmit.disabled = true;
      try {
        const response = await fetch('/api/novels/import-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, prefetchChapters: 100 }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '爬取失败');
        crawlProgressText.textContent = `已导入《${data.novel.title}》，后台继续缓存章节`;
        await _loadNovels();
        renderBookshelf();
        setTimeout(() => importModal.classList.remove('active'), 500);
      } catch (error) {
        alert(error.message || '爬取失败');
      } finally {
        crawlSubmit.disabled = false;
        setTimeout(() => { crawlProgress.style.display = 'none'; }, 1200);
      }
    });
  }

  function _handleFileSelect(file) {
    if (!file.name.toLowerCase().endsWith('.txt')) {
      alert('请选择 TXT 文件');
      return;
    }
    document.getElementById('upload-form').style.display = 'block';
    document.getElementById('upload-zone').style.display = 'none';
    document.getElementById('import-title').value = file.name.replace(/\.txt$/i, '');
  }

  async function _doImport() {
    const fileInput = document.getElementById('file-input');
    if (!fileInput.files.length) return;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('title', document.getElementById('import-title').value.trim() || '未命名小说');
    formData.append('author', document.getElementById('import-author').value.trim());

    try {
      const response = await fetch('/api/novels/import', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '导入失败');
      await _loadNovels();
      renderBookshelf();
      fileInput.value = '';
      document.getElementById('upload-form').style.display = 'none';
      document.getElementById('upload-zone').style.display = 'block';
      document.getElementById('import-modal').classList.remove('active');
    } catch (error) {
      alert(error.message || '导入失败');
    }
  }

  function _bindMenuEvents() {
    const menuModal = document.getElementById('menu-modal');
    menuModal.addEventListener('click', event => {
      if (event.target === menuModal) menuModal.classList.remove('active');
    });

    document.getElementById('menu-translate').addEventListener('click', () => {
      menuModal.classList.remove('active');
      document.getElementById('translation-modal').classList.add('active');
      _prepareTranslation();
    });

    document.getElementById('menu-export').addEventListener('click', () => {
      menuModal.classList.remove('active');
      _exportCurrentChapter();
    });

    document.getElementById('menu-info').addEventListener('click', () => {
      menuModal.classList.remove('active');
      alert('AI 有声小说阅读器\n支持阅读、后端TTS朗读、URL爬取和本地模型翻译。');
    });

    document.getElementById('menu-delete').addEventListener('click', async () => {
      menuModal.classList.remove('active');
      const bookId = Reader.getCurrentBookId();
      if (!bookId || !confirm('确定删除这本小说吗？')) return;
      const response = await fetch(`/api/novels/${bookId}`, { method: 'DELETE' });
      if (response.ok) {
        await _loadNovels();
        Reader.goBack();
      }
    });
  }

  function _exportCurrentChapter() {
    const title = document.getElementById('chapter-title').textContent || 'chapter';
    const text = Reader.getCurrentChapterText();
    const blob = new Blob([`${title}\n\n${text}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function _bindTranslationEvents() {
    const modal = document.getElementById('translation-modal');
    document.getElementById('translation-close').addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', event => {
      if (event.target === modal) modal.classList.remove('active');
    });
    document.getElementById('trans-btn-start').addEventListener('click', _doTranslation);
  }

  function _prepareTranslation() {
    const text = Reader.getCurrentChapterText();
    document.getElementById('trans-original').textContent = text.substring(0, 700) + (text.length > 700 ? '...' : '');
    document.getElementById('trans-result').textContent = '点击“翻译”开始';
  }

  async function _doTranslation() {
    const state = Reader.getState();
    const resultBox = document.getElementById('trans-result');
    resultBox.textContent = '正在提交本地模型翻译任务...';
    try {
      const response = await fetch('/api/translate/chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          novelId: state.bookId,
          chapterIndex: state.chapterIndex,
          source: document.getElementById('trans-source-lang').value,
          target: document.getElementById('trans-target-lang').value,
          engine: 'nocle',
        }),
      });
      const data = await response.json();
      if (response.status === 200 && data.translated) {
        resultBox.textContent = data.translated;
        return;
      }
      if (!response.ok && !data.taskId) throw new Error(data.error || '翻译任务创建失败');
      await _pollTranslation(data.taskId, resultBox);
    } catch (error) {
      resultBox.textContent = error.message || '翻译失败';
    }
  }

  async function _pollTranslation(taskId, resultBox) {
    for (let i = 0; i < 240; i += 1) {
      const response = await fetch(`/api/translate/tasks/${taskId}`);
      const task = await response.json();
      if (task.status === 'complete') {
        resultBox.textContent = task.result.translated;
        return;
      }
      if (task.status === 'error') throw new Error(task.error || '翻译失败');
      resultBox.textContent = `本地模型翻译中... ${task.progress || 0}%`;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('翻译超时');
  }

  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { renderBookshelf };
})();
