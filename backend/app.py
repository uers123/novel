"""
app.py - AI 有声小说播放器后端

提供:
  - 小说导入 (上传TXT / 爬取URL)
  - 章节管理
  - 翻译 (Google翻译 / LLM接口)
  - 设置持久化
  - 静态文件服务 (前端 SPA)
"""

import os
import re
import sys
import json
import uuid
import shutil
import threading
from datetime import datetime
from pathlib import Path

# 修复 Windows 终端编码问题
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# ===================== 路径配置 =====================

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent  # 项目根目录
NOVELS_DIR = BASE_DIR / "novels"
SETTINGS_FILE = BASE_DIR / "settings.json"

# ===================== Flask 初始化 =====================

app = Flask(__name__, static_folder=str(PROJECT_DIR), static_url_path="")
CORS(app)

# ===================== 数据模型 =====================


class NovelManager:
    """小说管理器"""

    def __init__(self, storage_dir):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.index_file = self.storage_dir / "_index.json"
        self._index = self._load_index()

    def _load_index(self):
        if self.index_file.exists():
            with open(self.index_file, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}

    def _save_index(self):
        with open(self.index_file, "w", encoding="utf-8") as f:
            json.dump(self._index, f, ensure_ascii=False, indent=2)

    def _novel_path(self, novel_id):
        return self.storage_dir / novel_id

    def list_all(self):
        novels = []
        for nid, info in self._index.items():
            novels.append({
                "id": nid,
                "title": info.get("title", "未知"),
                "author": info.get("author", ""),
                "chapterCount": info.get("chapterCount", 0),
                "progress": info.get("progress", 0),
                "importedAt": info.get("importedAt", ""),
                "source": info.get("source", ""),
            })
        novels.sort(key=lambda x: x["importedAt"], reverse=True)
        return novels

    def get(self, novel_id):
        info = self._index.get(novel_id)
        if not info:
            return None

        npath = self._novel_path(novel_id)
        chapters_file = npath / "chapters.json"

        chapters = []
        if chapters_file.exists():
            with open(chapters_file, "r", encoding="utf-8") as f:
                chapters = json.load(f)

        return {
            "id": novel_id,
            "title": info.get("title", "未知"),
            "author": info.get("author", ""),
            "description": info.get("description", ""),
            "chapterCount": len(chapters),
            "progress": info.get("progress", 0),
            "source": info.get("source", ""),
            "importedAt": info.get("importedAt", ""),
            "chapters": chapters,
        }

    def get_chapter(self, novel_id, chapter_index):
        info = self._index.get(novel_id)
        if not info:
            return None

        npath = self._novel_path(novel_id)
        chapter_file = npath / f"chapter_{chapter_index}.txt"

        if not chapter_file.exists():
            return None

        with open(chapter_file, "r", encoding="utf-8") as f:
            content = f.read()

        # 获取章节标题
        chapters_file = npath / "chapters.json"
        title = f"第{int(chapter_index) + 1}章"
        if chapters_file.exists():
            with open(chapters_file, "r", encoding="utf-8") as f:
                ch_list = json.load(f)
                idx = int(chapter_index)
                if 0 <= idx < len(ch_list):
                    title = ch_list[idx].get("title", title)

        return {
            "novelId": novel_id,
            "chapterIndex": int(chapter_index),
            "title": title,
            "content": content,
        }

    def import_from_txt(self, file_path, title=None, author="", source=""):
        """从TXT文件导入小说"""
        novel_id = str(uuid.uuid4())[:8]
        npath = self._novel_path(novel_id)
        npath.mkdir(parents=True, exist_ok=True)

        # 读取文件
        with open(file_path, "r", encoding="utf-8") as f:
            text = f.read()

        # 自动检测标题
        if not title:
            title = Path(file_path).stem
            title = re.sub(r'[_-]', ' ', title)

        # 分章逻辑：按行首章节标记分割
        chapter_rx = re.compile(
            r'^[ \t]*'
            r'(第[一二三四五六七八九十百千万0-9]+[章节回部集卷篇][^\n]*'
            r'|第\d+[章节回部集卷篇][^\n]*'
            r'|序章[^\n]*|楔子[^\n]*|尾声[^\n]*|后记[^\n]*|番外[^\n]*|前言[^\n]*)'
            r'\s*$',
            re.MULTILINE
        )

        matches = list(chapter_rx.finditer(text))
        chapters = []
        chapter_texts = []

        if matches:
            # 处理首个标题前的引言部分
            if matches[0].start() > 0:
                lead = text[:matches[0].start()].strip()
                if lead:
                    chapters.append("前言")
                    chapter_texts.append(lead)

            for i, m in enumerate(matches):
                ch_title = m.group(1).strip()
                start = m.end()
                end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
                content = text[start:end].strip()
                chapters.append(ch_title)
                chapter_texts.append(content)
        else:
            # 无章节标记，按段落分
            paragraphs = text.split('\n\n')
            chunk_size = min(50, max(1, len(paragraphs) // 5 + 1))
            for i in range(0, len(paragraphs), chunk_size):
                chunk = '\n\n'.join(paragraphs[i:i + chunk_size]).strip()
                if chunk:
                    chapters.append(f"第{len(chapters) + 1}章")
                    chapter_texts.append(chunk)

        if not chapter_texts:
            chapters.append("正文")
            chapter_texts.append(text.strip())

        # 保存章节索引
        ch_index = []
        for i, ch_title in enumerate(chapters):
            ch_index.append({"index": i, "title": ch_title})
        with open(npath / "chapters.json", "w", encoding="utf-8") as f:
            json.dump(ch_index, f, ensure_ascii=False, indent=2)

        # 保存每章内容
        for i, content in enumerate(chapter_texts):
            with open(npath / f"chapter_{i}.txt", "w", encoding="utf-8") as f:
                f.write(content.strip())

        # 保存元数据
        meta = {
            "title": title.strip(),
            "author": author.strip(),
            "source": source,
            "chapterCount": len(chapters),
            "progress": 0,
            "importedAt": datetime.now().isoformat(),
        }
        with open(npath / "meta.json", "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

        # 更新索引
        self._index[novel_id] = meta
        self._save_index()

        return {"id": novel_id, **meta}

    def import_from_crawl(self, url, title=None):
        """爬取并导入小说"""
        # 导入爬虫模块
        import sys as _sys
        crawler_path = str(Path(__file__).resolve().parent.parent / "ASD")
        if crawler_path not in _sys.path:
            _sys.path.insert(0, crawler_path)

        from novel_crawler import NovelCrawler

        crawler = NovelCrawler()
        success = crawler.fetch_novel_info(url)
        if not success:
            raise ValueError("无法解析该URL，请检查链接是否正确")

        title = title or crawler.novel_title

        # 下载所有章节
        output_dir = crawler.download_all()

        # 从下载结果导入
        txt_file = Path(output_dir) / f"{crawler.novel_title}.txt"
        if txt_file.exists():
            return self.import_from_txt(
                str(txt_file),
                title=title,
                author=crawler.novel_author,
                source=url,
            )
        raise ValueError("爬取成功但未找到结果文件")

    def delete(self, novel_id):
        if novel_id not in self._index:
            return False
        npath = self._novel_path(novel_id)
        if npath.exists():
            shutil.rmtree(npath)
        del self._index[novel_id]
        self._save_index()
        return True

    def update_progress(self, novel_id, chapter_index):
        if novel_id in self._index:
            self._index[novel_id]["progress"] = chapter_index
            self._save_index()


novel_manager = NovelManager(NOVELS_DIR)


# ===================== 翻译引擎 =====================


class Translator:
    """翻译引擎"""

    def __init__(self):
        self._translator = None
        self._lock = threading.Lock()

    def _get_google_translator(self):
        try:
            from googletrans import Translator as GTranslator
            return GTranslator()
        except ImportError:
            return None

    def translate(self, text, source="auto", target="zh-cn"):
        """翻译文本"""
        if not text or len(text.strip()) == 0:
            return ""

        # Google 翻译 (免费)
        try:
            tr = self._get_google_translator()
            if tr:
                result = tr.translate(text[:5000], src=source, dest=target)
                return result.text
        except Exception as e:
            return f"[翻译服务暂不可用: {e}]\n\n{text[:2000]}"

        return text[:2000]

    def translate_chapter(self, novel_id, chapter_index, source="auto", target="zh-cn"):
        """翻译单个章节"""
        chapter = novel_manager.get_chapter(novel_id, chapter_index)
        if not chapter:
            return None

        content = chapter["content"]
        translated = self.translate(content, source, target)

        # 缓存翻译结果
        npath = novel_manager._novel_path(novel_id)
        trans_dir = npath / "translations"
        trans_dir.mkdir(exist_ok=True)
        trans_file = trans_dir / f"chapter_{chapter_index}_{target}.txt"
        with open(trans_file, "w", encoding="utf-8") as f:
            f.write(translated)

        return {
            "novelId": novel_id,
            "chapterIndex": chapter_index,
            "title": chapter["title"],
            "original": content[:200],
            "translated": translated,
            "target": target,
        }


translator = Translator()


# ===================== API 路由 =====================

# ----- 静态文件服务 -----

@app.route("/")
def index():
    return send_from_directory(str(PROJECT_DIR), "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(str(PROJECT_DIR), path)


# ----- 小说管理 -----

@app.route("/api/novels", methods=["GET"])
def api_list_novels():
    novels = novel_manager.list_all()
    return jsonify({"novels": novels})


@app.route("/api/novels/<novel_id>", methods=["GET"])
def api_get_novel(novel_id):
    novel = novel_manager.get(novel_id)
    if not novel:
        return jsonify({"error": "小说不存在"}), 404
    return jsonify(novel)


@app.route("/api/novels/<novel_id>/chapters/<int:chapter_index>", methods=["GET"])
def api_get_chapter(novel_id, chapter_index):
    chapter = novel_manager.get_chapter(novel_id, chapter_index)
    if not chapter:
        return jsonify({"error": "章节不存在"}), 404
    return jsonify(chapter)


@app.route("/api/novels/import", methods=["POST"])
def api_import_novel():
    """导入小说：支持上传TXT文件或指定URL"""
    if "file" in request.files:
        file = request.files["file"]
        if file.filename == "":
            return jsonify({"error": "未选择文件"}), 400

        temp_path = NOVELS_DIR / "_temp_upload.txt"
        file.save(str(temp_path))

        title = request.form.get("title") or Path(file.filename).stem
        author = request.form.get("author", "")

        result = novel_manager.import_from_txt(str(temp_path), title=title, author=author)
        if temp_path.exists():
            temp_path.unlink()

        return jsonify({"success": True, "novel": result}), 201

    return jsonify({"error": "请上传TXT文件"}), 400


@app.route("/api/novels/import-url", methods=["POST"])
def api_import_from_url():
    """从URL爬取小说"""
    data = request.get_json()
    url = data.get("url", "").strip()
    title = data.get("title", "")

    if not url:
        return jsonify({"error": "请输入URL"}), 400

    try:
        result = novel_manager.import_from_crawl(url, title=title)
        return jsonify({"success": True, "novel": result}), 201
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"爬取失败: {str(e)}"}), 500


@app.route("/api/novels/<novel_id>", methods=["DELETE"])
def api_delete_novel(novel_id):
    if novel_manager.delete(novel_id):
        return jsonify({"success": True})
    return jsonify({"error": "小说不存在"}), 404


@app.route("/api/novels/<novel_id>/progress", methods=["PUT"])
def api_update_progress(novel_id):
    data = request.get_json()
    chapter_index = data.get("chapterIndex", 0)
    novel_manager.update_progress(novel_id, chapter_index)
    return jsonify({"success": True})


# ----- 翻译 -----

@app.route("/api/translate", methods=["POST"])
def api_translate():
    """翻译文本"""
    data = request.get_json()
    text = data.get("text", "")
    source = data.get("source", "auto")
    target = data.get("target", "zh-cn")

    result = translator.translate(text, source=source, target=target)
    return jsonify({"result": result})


@app.route("/api/translate/chapter", methods=["POST"])
def api_translate_chapter():
    """翻译指定小说的指定章节"""
    data = request.get_json()
    novel_id = data.get("novelId")
    chapter_index = data.get("chapterIndex")
    source = data.get("source", "auto")
    target = data.get("target", "zh-cn")

    if not novel_id or chapter_index is None:
        return jsonify({"error": "缺少参数 novelId 或 chapterIndex"}), 400

    result = translator.translate_chapter(novel_id, int(chapter_index), source, target)
    if not result:
        return jsonify({"error": "章节不存在"}), 404

    return jsonify(result)


@app.route("/api/translate/novel/<novel_id>", methods=["POST"])
def api_translate_novel(novel_id):
    """翻译整本小说"""
    data = request.get_json()
    source = data.get("source", "auto")
    target = data.get("target", "zh-cn")

    novel = novel_manager.get(novel_id)
    if not novel:
        return jsonify({"error": "小说不存在"}), 404

    def translate_all():
        for ch in novel["chapters"]:
            idx = ch["index"]
            translator.translate_chapter(novel_id, idx, source, target)

    thread = threading.Thread(target=translate_all, daemon=True)
    thread.start()

    return jsonify({
        "success": True,
        "message": f"开始翻译 {len(novel['chapters'])} 章",
        "taskId": f"trans_{novel_id}",
    })


# ----- 设置持久化 -----

@app.route("/api/settings", methods=["GET"])
def api_get_settings():
    if SETTINGS_FILE.exists():
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            settings = json.load(f)
    else:
        settings = {
            "theme": "day",
            "fontSize": 16,
            "lineHeight": 1.8,
            "bgColor": "#F9F7F4",
            "pageEffect": "updown",
            "brightness": 100,
            "voice": None,
        }
    return jsonify(settings)


@app.route("/api/settings", methods=["POST"])
def api_save_settings():
    settings = request.get_json()
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
    return jsonify({"success": True})


# ===================== 启动 =====================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 AI 有声小说播放器后端启动中...")
    print(f"   📂 小说存储: {NOVELS_DIR}")
    print(f"   🌐 地址: http://localhost:{port}")
    print(f"   📖 按 Ctrl+C 停止服务器")
    print()
    app.run(host="0.0.0.0", port=port, debug=True)
