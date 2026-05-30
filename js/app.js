/**
 * app.js - 主应用逻辑
 * 书架渲染、页面路由、小说导入、翻译、更多菜单
 */

const App = (() => {
  // ============ 状态 ============
  let _novels = [];

  // 当前阅读中的小说（供其他模块访问）
  window._currentNovel = null;

  // ============ 初始化 ============
  async function init() {
    // 初始化各模块
    Settings.init();
    TOC.init();
    Reader.init();
    AudioPlayer.init();

    // 绑定 UI 事件
    _bindImportEvents();
    _bindMenuEvents();
    _bindTranslationEvents();

    // 从后端加载小说列表
    await _loadNovels();

    // 如果没有后端小说，使用本地示例数据
    if (_novels.length === 0) {
      _loadLocalBooks();
    }

    // 渲染书架
    renderBookshelf();

    console.log('App initialized');
  }

  // ============ 数据加载 ============

  /** 从后端加载小说列表 */
  async function _loadNovels() {
    try {
      const resp = await fetch('/api/novels');
      if (resp.ok) {
        const data = await resp.json();
        _novels = data.novels || [];
        return;
      }
    } catch (e) {
      // 后端不可用，使用本地数据
    }
    _novels = [];
  }

  /** 加载本地示例书籍 */
  function _loadLocalBooks() {
    if (typeof BOOKS_DATA !== 'undefined') {
      _novels = BOOKS_DATA.map(b => ({
        id: b.id,
        title: b.title,
        author: b.author,
        coverColor: b.coverColor,
        progress: b.progress,
        description: b.description,
        chapterCount: (b.chapters || []).length,
        local: true,
      }));
    }
  }

  // ============ 书架渲染 ============

  function renderBookshelf(filter) {
    const grid = document.getElementById('bookshelf-grid');
    grid.innerHTML = '';

    let books = _novels;

    // 过滤
    if (filter === 'reading') {
      books = books.filter(b => b.progress > 0 && b.progress < 100);
    } else if (filter === 'done') {
      books = books.filter(b => b.progress >= 100);
    }

    if (books.length === 0) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--text-secondary)">
          <p style="font-size:48px;margin-bottom:12px">📚</p>
          <p>书架空空如也</p>
          <p style="font-size:13px;margin-top:4px">点击右下角 + 导入小说</p>
        </div>
      `;
      return;
    }

    books.forEach(book => {
      const card = document.createElement('div');
      card.className = 'book-card';
      card.innerHTML = `
        <div class="book-cover" style="background:${book.coverColor || '#5A7A9A'}">
          ${book.title ? book.title[0] : '?'}
        </div>
        <div class="book-title">${book.title}</div>
        <div class="book-author">${book.author || ''}</div>
        <div class="book-progress">
          <div class="book-progress-bar" style="width:${book.progress || 0}%"></div>
        </div>
      `;
      card.addEventListener('click', () => _openBook(book));
      grid.appendChild(card);
    });
  }

  /** 打开书籍 */
  async function _openBook(book) {
    window._currentNovel = book;

    if (book.local) {
      // 本地书籍 - 使用 BOOKS_DATA
      const bd = (typeof BOOKS_DATA !== 'undefined')
        ? BOOKS_DATA.find(b => b.id === book.id)
        : null;
      if (bd) {
        const progress = Storage.getProgress(book.id);
        Reader.open(book.id, bd.chapters, progress.chapterIdx || 0);
        return;
      }
    }

    // 后端书籍
    try {
      const resp = await fetch(`/api/novels/${book.id}`);
      if (resp.ok) {
        const data = await resp.json();
        window._currentNovel = data;
        const chapters = data.chapters || [];
        Reader.open(book.id, chapters, data.progress || 0);
      }
    } catch (e) {
      console.error('Failed to open book:', e);
    }
  }

  // ============ 导入事件 ============

  function _bindImportEvents() {
    const importModal = document.getElementById('import-modal');
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const uploadForm = document.getElementById('upload-form');
    const importSubmit = document.getElementById('import-submit');
    const crawlSubmit = document.getElementById('crawl-submit');
    const crawlUrl = document.getElementById('crawl-url');
    const crawlProgress = document.getElementById('crawl-progress');

    // 打开导入面板
    document.getElementById('btn-import').addEventListener('click', () => {
      importModal.classList.add('active');
    });

    document.getElementById('import-close').addEventListener('click', () => {
      importModal.classList.remove('active');
    });
    importModal.addEventListener('click', (e) => {
      if (e.target === importModal) importModal.classList.remove('active');
    });

    // 上传区域点击
    uploadZone.addEventListener('click', () => fileInput.click());

    // 拖拽上传
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = 'var(--accent)';
    });
    uploadZone.addEventListener('dragleave', () => {
      uploadZone.style.borderColor = '';
    });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = '';
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        _handleFileSelect(e.dataTransfer.files[0]);
      }
    });

    // 选择文件
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        _handleFileSelect(fileInput.files[0]);
      }
    });

    // 确认导入
    importSubmit.addEventListener('click', () => _doImport());

    // 爬取
    crawlSubmit.addEventListener('click', async () => {
      const url = crawlUrl.value.trim();
      if (!url) { alert('请输入小说URL'); return; }

      crawlProgress.style.display = 'block';
      crawlSubmit.disabled = true;

      try {
        const resp = await fetch('/api/novels/import-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });

        if (resp.ok) {
          const result = await resp.json();
          alert(`✅ 爬取成功: ${result.novel.title}`);
          crawlUrl.value = '';
          await _loadNovels();
          renderBookshelf();
          importModal.classList.remove('active');
        } else {
          const err = await resp.json();
          alert(`❌ ${err.error || '爬取失败'}`);
        }
      } catch (e) {
        alert('❌ 网络错误，请确认后端已启动');
      } finally {
        crawlProgress.style.display = 'none';
        crawlSubmit.disabled = false;
      }
    });
  }

  function _handleFileSelect(file) {
    if (!file.name.endsWith('.txt')) {
      alert('请选择 TXT 文件');
      return;
    }

    document.getElementById('upload-form').style.display = 'block';
    document.getElementById('upload-zone').style.display = 'none';
    document.getElementById('import-title').value = file.name.replace(/\.txt$/i, '');
  }

  async function _doImport() {
    const fileInput = document.getElementById('file-input');
    const title = document.getElementById('import-title').value.trim() || '未命名小说';
    const author = document.getElementById('import-author').value.trim();

    if (!fileInput.files.length) return;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('title', title);
    formData.append('author', author);

    try {
      const resp = await fetch('/api/novels/import', {
        method: 'POST',
        body: formData,
      });

      if (resp.ok) {
        const result = await resp.json();
        alert(`✅ 导入成功: ${result.novel.title}`);
        // 重置表单
        document.getElementById('upload-form').style.display = 'none';
        document.getElementById('upload-zone').style.display = 'block';
        fileInput.value = '';
        document.getElementById('import-author').value = '';
        // 刷新书架
        await _loadNovels();
        renderBookshelf();
        document.getElementById('import-modal').classList.remove('active');
      } else {
        const err = await resp.json();
        alert(`❌ ${err.error || '导入失败'}`);
      }
    } catch (e) {
      alert('❌ 网络错误，请确认后端已启动');
    }
  }

  // ============ 更多菜单 ============

  function _bindMenuEvents() {
    const menuModal = document.getElementById('menu-modal');

    // 关闭
    menuModal.addEventListener('click', (e) => {
      if (e.target === menuModal) menuModal.classList.remove('active');
    });

    // 翻译本章
    document.getElementById('menu-translate').addEventListener('click', () => {
      menuModal.classList.remove('active');
      document.getElementById('translation-modal').classList.add('active');
      _prepareTranslation();
    });

    // 导出 TXT
    document.getElementById('menu-export').addEventListener('click', () => {
      menuModal.classList.remove('active');
      _exportCurrentChapter();
    });

    // 删除小说
    document.getElementById('menu-delete').addEventListener('click', async () => {
      menuModal.classList.remove('active');
      const bookId = Reader.getCurrentBookId();
      if (!bookId) return;

      if (!confirm('确定删除这本小说吗？')) return;

      try {
        const resp = await fetch(`/api/novels/${bookId}`, { method: 'DELETE' });
        if (resp.ok) {
          alert('已删除');
          Reader.goBack();
        }
      } catch (e) {
        alert('删除失败');
      }
    });

    // 关于
    document.getElementById('menu-info').addEventListener('click', () => {
      menuModal.classList.remove('active');
      alert('AI 有声小说播放器 v1.0\n\n纯前端 + Flask 后端\n支持导入、爬取、翻译');
    });
  }

  /** 导出当前章节为 TXT */
  function _exportCurrentChapter() {
    const title = document.getElementById('chapter-title').textContent;
    const text = document.getElementById('chapter-text').textContent;
    const content = `${title}\n\n${text}`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ============ 翻译 ============

  function _bindTranslationEvents() {
    const transModal = document.getElementById('translation-modal');

    document.getElementById('translation-close').addEventListener('click', () => {
      transModal.classList.remove('active');
    });
    transModal.addEventListener('click', (e) => {
      if (e.target === transModal) transModal.classList.remove('active');
    });

    document.getElementById('trans-btn-start').addEventListener('click', _doTranslation);
  }

  function _prepareTranslation() {
    const text = Reader.getCurrentChapterText();
    document.getElementById('trans-original').textContent =
      text.substring(0, 500) + (text.length > 500 ? '...' : '');
    document.getElementById('trans-result').textContent = '点击"翻译"按钮开始';
  }

  async function _doTranslation() {
    const resultBox = document.getElementById('trans-result');
    const original = document.getElementById('trans-original');
    const source = document.getElementById('trans-source-lang').value;
    const target = document.getElementById('trans-target-lang').value;

    resultBox.textContent = '翻译中...';

    try {
      // 优先使用后端翻译
      const resp = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: original.textContent,
          source,
          target,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        resultBox.textContent = data.result || '翻译失败';
      } else {
        resultBox.textContent = '后端翻译服务不可用';
      }
    } catch (e) {
      resultBox.textContent = '翻译服务暂不可用，请确认后端已启动';
    }
  }

  // ============ Tab 切换 ============

  function _bindTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderBookshelf(tab.dataset.tab);
      });
    });
  }

  // ============ 启动 ============

  // DOM 就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      _bindTabs();
      init();
    });
  } else {
    _bindTabs();
    init();
  }

  return { renderBookshelf };
})();
