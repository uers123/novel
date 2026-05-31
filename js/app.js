const App = (() => {
  let _novels = [];
  window._currentNovel = null;
  const CHUNK_THRESHOLD = 2 * 1024 * 1024;
  const CHUNK_SIZE = 2 * 1024 * 1024;

  async function init() {
    Settings.init();
    TOC.init();
    Reader.init();
    await AudioPlayer.init();
    _bindTabs();
    _bindImportEvents();
    _bindMenuEvents();
    _bindTranslateEvents();
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
          body: JSON.stringify({
            url,
            prefetchChapters: 100,
            sourceType: document.getElementById('crawl-source').value,
          }),
        });
        let data;
        try {
          data = await response.json();
        } catch (_jsonErr) {
          throw new Error(`服务器错误 (${response.status})`);
        }
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

    const file = fileInput.files[0];
    const title = document.getElementById('import-title').value.trim() || '未命名小说';
    const author = document.getElementById('import-author').value.trim();

    if (file.size > CHUNK_THRESHOLD) {
      await _doChunkedImport(file, title, author);
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    formData.append('author', author);

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

  async function _doChunkedImport(file, title, author) {
    const submit = document.getElementById('import-submit');
    const originalText = submit.textContent;
    let uploadId = null;
    submit.disabled = true;
    try {
      const startResponse = await fetch('/api/novels/import/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, title, author, totalSize: file.size, chunkSize: CHUNK_SIZE }),
      });
      const startData = await startResponse.json();
      if (!startResponse.ok) throw new Error(startData.error || '无法开始分块上传');
      uploadId = startData.uploadId;

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      for (let index = 0; index < totalChunks; index += 1) {
        const formData = new FormData();
        formData.append('uploadId', uploadId);
        formData.append('chunkIndex', String(index));
        formData.append('chunk', file.slice(index * CHUNK_SIZE, Math.min(file.size, (index + 1) * CHUNK_SIZE)));
        submit.textContent = `上传中 ${index + 1}/${totalChunks}`;
        const chunkResponse = await fetch('/api/novels/import/chunk', { method: 'POST', body: formData });
        const chunkData = await chunkResponse.json();
        if (!chunkResponse.ok) throw new Error(chunkData.error || `分块 ${index + 1} 上传失败`);
      }

      submit.textContent = '正在合并...';
      const completeResponse = await fetch('/api/novels/import/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, title, author }),
      });
      const completeData = await completeResponse.json();
      if (!completeResponse.ok) throw new Error(completeData.error || '导入失败');
      await _loadNovels();
      renderBookshelf();
      document.getElementById('file-input').value = '';
      document.getElementById('upload-form').style.display = 'none';
      document.getElementById('upload-zone').style.display = 'block';
      document.getElementById('import-modal').classList.remove('active');
    } catch (error) {
      if (uploadId) {
        fetch(`/api/novels/import/${uploadId}`, { method: 'DELETE' }).catch(() => {});
      }
      alert(error.message || '导入失败');
    } finally {
      submit.disabled = false;
      submit.textContent = originalText;
    }
  }

  function _bindMenuEvents() {
    const menuModal = document.getElementById('menu-modal');
    menuModal.addEventListener('click', event => {
      if (event.target === menuModal) menuModal.classList.remove('active');
    });

    const editModal = document.getElementById('edit-modal');
    editModal.addEventListener('click', event => {
      if (event.target === editModal) editModal.classList.remove('active');
    });
    document.getElementById('edit-close').addEventListener('click', () => editModal.classList.remove('active'));
    document.getElementById('edit-submit').addEventListener('click', _doEditBook);

    document.getElementById('menu-export').addEventListener('click', () => {
      menuModal.classList.remove('active');
      _exportCurrentChapter();
    });

    document.getElementById('menu-edit').addEventListener('click', () => {
      menuModal.classList.remove('active');
      _openEditModal();
    });

    document.getElementById('menu-info').addEventListener('click', () => {
      menuModal.classList.remove('active');
      alert('AI 有声小说阅读器\n支持阅读、后端TTS朗读和URL爬取。');
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

  function _bindTranslateEvents() {
    const modal = document.getElementById('translate-modal');
    document.getElementById('nav-translate').addEventListener('click', _openTranslatePanel);
    document.getElementById('translate-close').addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', event => {
      if (event.target === modal) modal.classList.remove('active');
    });
    document.getElementById('translate-chapter-btn').addEventListener('click', async () => {
      const btn = document.getElementById('translate-chapter-btn');
      btn.disabled = true;
      btn.textContent = '翻译中...';
      try {
        await _translateCurrentChapter();
      } finally {
        btn.disabled = false;
        btn.textContent = '翻译本章';
      }
    });
    document.getElementById('translate-target').addEventListener('change', () => {
      // If auto-translate is on, re-translate immediately
      if (document.getElementById('translate-auto').checked) {
        document.getElementById('translate-chapter-btn').click();
      }
    });
    document.addEventListener('reader:chapter-loaded', () => {
      if (document.getElementById('translate-auto').checked && modal.classList.contains('active')) {
        _translateCurrentChapter();
      }
    });
  }

  function _openTranslatePanel() {
    document.getElementById('translate-modal').classList.add('active');
    document.getElementById('translate-result').textContent = '点击「翻译本章」按钮开始翻译';
  }

  async function _translateCurrentChapter() {
    const state = Reader.getState();
    if (!state.bookId) {
      document.getElementById('translate-result').textContent = '没有可翻译的文本';
      return;
    }
    const target = document.getElementById('translate-target').value;
    document.getElementById('translate-result').textContent = '翻译中...';

    try {
      const response = await fetch('/api/translate/chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          novelId: state.bookId,
          chapterIndex: state.chapterIndex,
          target,
          source: 'auto',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '翻译失败');
      document.getElementById('translate-result').textContent = data.translated || data.text || '(空结果)';
    } catch (error) {
      document.getElementById('translate-result').textContent = `翻译失败：${error.message}`;
    }
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

  function _openEditModal() {
    const book = window._currentNovel;
    if (!book) return;
    document.getElementById('edit-title').value = book.title || '';
    document.getElementById('edit-author').value = book.author || '';
    // Highlight current cover color
    const color = book.coverColor || '#5A7A9A';
    document.querySelectorAll('#edit-colors .color-swatch').forEach(item => {
      item.classList.toggle('active', item.dataset.color === color);
    });
    document.getElementById('edit-modal').classList.add('active');
  }

  async function _doEditBook() {
    const book = window._currentNovel;
    if (!book) return;
    const title = document.getElementById('edit-title').value.trim();
    const author = document.getElementById('edit-author').value.trim();
    const activeColor = document.querySelector('#edit-colors .color-swatch.active');
    const coverColor = activeColor ? activeColor.dataset.color : '#5A7A9A';
    if (!title) { alert('书籍名称不能为空'); return; }
    try {
      const response = await fetch(`/api/novels/${book.id}/meta`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, author, coverColor }),
      });
      if (!response.ok) throw new Error('保存失败');
      const data = await response.json();
      if (data.novel) window._currentNovel = data.novel;
      document.getElementById('edit-modal').classList.remove('active');
      // Refresh bookshelf to show updated info
      await _loadNovels();
      renderBookshelf();
    } catch (error) {
      alert(error.message || '保存失败');
    }
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
