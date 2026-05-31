import io
import os
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path

os.environ.setdefault("NOVEL_READER_MOCK_TTS", "1")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module
from app import NovelManager, app, write_json


class FakeChapter:
    def __init__(self, index, title, url):
        self.index = index
        self.title = title
        self.url = url


class FakeCrawler:
    last_preferred_source = None

    def __init__(self, preferred_source="auto"):
        FakeCrawler.last_preferred_source = preferred_source
        self.preferred_source = preferred_source
        self.novel_title = "测试爬取小说"
        self.novel_author = "测试作者"
        self.chapters = [
            FakeChapter(0, "第一章 起点", "https://example.test/1"),
            FakeChapter(1, "第二章 继续", "https://example.test/2"),
        ]

    def fetch_novel_info(self, _url):
        return True

    def download_chapter(self, chapter):
        return f"{chapter.title}\n\n这是第{chapter.index + 1}章的正文。"


class BackendTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.old_manager = app_module.novel_manager
        self.old_settings_file = app_module.SETTINGS_FILE
        self.old_uploads_dir = app_module.UPLOADS_DIR
        self.manager = NovelManager(Path(self.temp_dir) / "novels")
        app_module.novel_manager = self.manager
        app_module.SETTINGS_FILE = Path(self.temp_dir) / "settings.json"
        app_module.UPLOADS_DIR = Path(self.temp_dir) / "uploads"
        self.client = app.test_client()

    def tearDown(self):
        app_module.novel_manager = self.old_manager
        app_module.SETTINGS_FILE = self.old_settings_file
        app_module.UPLOADS_DIR = self.old_uploads_dir
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _txt_file(self, content):
        path = Path(self.temp_dir) / "book.txt"
        path.write_text(content, encoding="utf-8")
        return str(path)


class TestTxtImport(BackendTestCase):
    def test_import_txt_splits_chapters(self):
        result = self.manager.import_from_txt(
            self._txt_file("第一章 开始\n第一章正文。\n\n第二章 后来\n第二章正文。"),
            title="本地书",
        )

        novel = self.manager.get(result["id"])
        self.assertEqual(novel["title"], "本地书")
        self.assertEqual(len(novel["chapters"]), 2)
        chapter = self.manager.get_chapter(result["id"], 0)
        self.assertIn("第一章正文", chapter["content"])
        self.assertTrue(chapter["sentences"])

    def test_upload_api(self):
        data = {
            "title": "上传书",
            "author": "作者",
            "file": (io.BytesIO("第一章 上传\n正文。".encode("utf-8")), "upload.txt"),
        }
        response = self.client.post("/api/novels/import", data=data, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["novel"]["title"], "上传书")

    def test_chunked_upload_api(self):
        response = self.client.post(
            "/api/novels/import/start",
            json={"filename": "big.txt", "title": "大文件", "author": "作者", "totalSize": 24},
        )
        self.assertEqual(response.status_code, 201)
        upload_id = response.get_json()["uploadId"]

        chunks = [b"\xe7\xac\xac\xe4\xb8\x80\xe7\xab\xa0 \xe5\xa4\xa7\n", "正文。".encode("utf-8")]
        for index, payload in enumerate(chunks):
            response = self.client.post(
                "/api/novels/import/chunk",
                data={"uploadId": upload_id, "chunkIndex": str(index), "chunk": (io.BytesIO(payload), f"{index}.part")},
                content_type="multipart/form-data",
            )
            self.assertEqual(response.status_code, 200)

        response = self.client.post("/api/novels/import/complete", json={"uploadId": upload_id})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["novel"]["title"], "大文件")

    def test_cancel_chunked_upload(self):
        response = self.client.post("/api/novels/import/start", json={"filename": "cancel.txt"})
        upload_id = response.get_json()["uploadId"]
        response = self.client.delete(f"/api/novels/import/{upload_id}")
        self.assertEqual(response.status_code, 200)


class TestCrawlImport(BackendTestCase):
    def setUp(self):
        super().setUp()
        self.manager._new_crawler = lambda source_type="auto": FakeCrawler(source_type)

    def test_import_url_catalog_and_lazy_load_chapter(self):
        result = self.manager.import_from_crawl("https://example.test/catalog", prefetch_chapters=0)
        status = self.manager.crawl_status(result["id"])
        self.assertEqual(status["cached"], 0)

        chapter = self.manager.get_chapter(result["id"], 1)
        self.assertIn("第2章的正文", chapter["content"])

        status = self.manager.crawl_status(result["id"])
        self.assertEqual(status["cached"], 1)
        self.assertFalse(status["inProgress"])

    def test_import_url_api(self):
        response = self.client.post(
            "/api/novels/import-url",
            json={"url": "https://example.test/catalog", "prefetchChapters": 0, "sourceType": "syosetu"},
        )
        self.assertEqual(response.status_code, 201)
        payload = response.get_json()
        self.assertEqual(payload["novel"]["chapterCount"], 2)
        self.assertEqual(payload["crawlStatus"]["prefetchTarget"], 0)
        self.assertEqual(FakeCrawler.last_preferred_source, "syosetu")

    def test_concurrent_json_writes_are_stable(self):
        path = Path(self.temp_dir) / "status.json"

        def worker(index):
            write_json(path, {"index": index})

        threads = [threading.Thread(target=worker, args=(index,)) for index in range(20)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertTrue(path.exists())
        self.assertIn("index", app_module.read_json(path, {}))


class TestSettingsAndTTS(BackendTestCase):
    def test_settings_round_trip(self):
        response = self.client.post("/api/settings", json={"theme": "night", "fontSize": 24})
        self.assertEqual(response.status_code, 200)
        response = self.client.get("/api/settings")
        self.assertEqual(response.get_json()["theme"], "night")
        self.assertEqual(response.get_json()["fontSize"], 24)

    def test_tts_voices_and_dependency_error_are_explicit(self):
        response = self.client.get("/api/tts/voices")
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.get_json()["voices"]), 0)

        response = self.client.post("/api/tts/synthesize", json={"text": "测试朗读", "voiceId": "qinglang_male"})
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["mock"])
        self.assertIn("/api/tts/audio/", payload["audioUrl"])

        response = self.client.get("/api/tts/emotions")
        self.assertEqual(response.status_code, 200)
        self.assertIn("auto", [item["id"] for item in response.get_json()["emotions"]])


class TestTranslation(BackendTestCase):
    def test_cached_chapter_translation_returns_immediately(self):
        result = self.manager.import_from_txt(self._txt_file("第一章 原文\nHello world."), title="翻译书")
        translation_dir = Path(self.temp_dir) / "novels" / result["id"] / "translations"
        translation_dir.mkdir(parents=True, exist_ok=True)
        (translation_dir / "chapter_0_zh-cn.txt").write_text("你好，世界。", encoding="utf-8")

        response = self.client.post(
            "/api/translate/chapter",
            json={"novelId": result["id"], "chapterIndex": 0, "target": "zh-cn", "engine": "nocle"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["cached"])
        self.assertIn("你好", response.get_json()["translated"])

    def test_missing_translation_task_is_404(self):
        response = self.client.get("/api/translate/tasks/not-found")
        self.assertEqual(response.status_code, 404)


class TestFrontendStatic(BackendTestCase):
    def test_static_shell_contains_target_surfaces(self):
        response = self.client.get("/")
        try:
            html = response.data.decode("utf-8")
            for marker in ["view-reader", "settings-modal", "settings-close", "voices-modal", "audio-bar", "translate-modal", "emotion-grid"]:
                self.assertIn(marker, html)
        finally:
            response.close()

    def test_js_and_css_assets_load(self):
        for filename in ["app.js", "reader.js", "settings.js", "audio.js", "toc.js", "data.js"]:
            response = self.client.get(f"/js/{filename}")
            try:
                self.assertEqual(response.status_code, 200, filename)
            finally:
                response.close()
        for filename in ["style.css", "themes.css"]:
            response = self.client.get(f"/css/{filename}")
            try:
                self.assertEqual(response.status_code, 200, filename)
            finally:
                response.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
