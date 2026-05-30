"""
test_delivery.py - AI 有声小说播放器 全功能交付测试
保留此文件，随时可运行: python backend/test_delivery.py
"""
import os, sys, json, tempfile, unittest
sys.path.insert(0, os.path.dirname(__file__))
from app import app, novel_manager

class TestImportFunction(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        for nid in list(novel_manager._index.keys()):
            novel_manager.delete(nid)
        self.test_dir = tempfile.mkdtemp()
    def tearDown(self):
        for nid in list(novel_manager._index.keys()):
            novel_manager.delete(nid)
        import shutil
        if os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir)

    def _create_txt(self, name, content):
        p = os.path.join(self.test_dir, name)
        with open(p, 'w', encoding='utf-8') as f: f.write(content)
        return p

    def test_simple_txt(self):
        result = novel_manager.import_from_txt(self._create_txt("n.txt", "内容"))
        self.assertEqual(result['title'], 'n')

    def test_chapter_titles(self):
        content = "第一章 少年\n少年走在路上。\n第二章 中年\n中年思考。"
        result = novel_manager.import_from_txt(self._create_txt("t.txt", content), title="测试")
        novel = novel_manager.get(result['id'])
        self.assertEqual(len(novel['chapters']), 2)
        self.assertEqual(novel['chapters'][0]['title'], '第一章 少年')

    def test_chapter_content(self):
        content = "第一章 测试\n这是第一段。"
        result = novel_manager.import_from_txt(self._create_txt("c.txt", content), title="C")
        ch = novel_manager.get_chapter(result['id'], 0)
        self.assertIn('第一段', ch['content'])

    def test_empty_file(self):
        result = novel_manager.import_from_txt(self._create_txt("e.txt", ""), title="空")
        self.assertIsNotNone(result)

    def test_api_import(self):
        content = "第一章 API\nAPI导入测试内容。"
        p = self._create_txt("api.txt", content)
        with open(p, 'rb') as f:
            resp = self.client.post('/api/novels/import', data={
                'file': (f, 'api.txt'), 'title': 'API测试', 'author': '作者',
            })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(json.loads(resp.data)['novel']['title'], 'API测试')

class TestSettingsAPI(unittest.TestCase):
    def setUp(self): self.client = app.test_client()
    def test_get_settings(self):
        r = self.client.get('/api/settings'); self.assertEqual(r.status_code, 200)
    def test_save_settings(self):
        self.client.post('/api/settings', json={'theme':'night','fontSize':20})
        r = self.client.get('/api/settings')
        self.assertEqual(json.loads(r.data)['theme'], 'night')

class TestTranslationAPI(unittest.TestCase):
    def setUp(self): self.client = app.test_client()
    def test_translate(self):
        r = self.client.post('/api/translate', json={'text':'Hello'})
        self.assertEqual(r.status_code, 200); self.assertIn('result', json.loads(r.data))
    def test_empty(self):
        r = self.client.post('/api/translate', json={'text':''})
        self.assertEqual(json.loads(r.data)['result'], '')

class TestNovelAPI(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        for nid in list(novel_manager._index.keys()): novel_manager.delete(nid)
        d = tempfile.mkdtemp(); p = os.path.join(d, "n.txt")
        with open(p, 'w', encoding='utf-8') as f: f.write("第一章 测试\n内容")
        self.novel = novel_manager.import_from_txt(p, title="列表测试")
        import shutil; shutil.rmtree(d)
    def tearDown(self):
        for nid in list(novel_manager._index.keys()): novel_manager.delete(nid)
    def test_list(self): self.assertEqual(self.client.get('/api/novels').status_code, 200)
    def test_detail(self):
        r = self.client.get(f'/api/novels/{self.novel["id"]}')
        self.assertEqual(json.loads(r.data)['title'], '列表测试')
    def test_404(self): self.assertEqual(self.client.get('/api/novels/x').status_code, 404)
    def test_progress(self):
        r = self.client.put(f'/api/novels/{self.novel["id"]}/progress', json={'chapterIndex':1})
        self.assertEqual(r.status_code, 200)
    def test_delete(self):
        self.client.delete(f'/api/novels/{self.novel["id"]}')
        self.assertEqual(self.client.get(f'/api/novels/{self.novel["id"]}').status_code, 404)

class TestFrontend(unittest.TestCase):
    def setUp(self): self.client = app.test_client()
    def test_index(self):
        html = self.client.get('/').data.decode('utf-8')
        for v in ['view-bookshelf','view-reader','audio-bar','settings-modal','voices-grid','toc-modal']:
            self.assertIn(v, html)
    def test_js(self):
        for f in ['app.js','reader.js','settings.js','audio.js','toc.js','data.js']:
            r = self.client.get(f'/js/{f}')
            self.assertEqual(r.status_code, 200, f)
    def test_css(self):
        for f in ['style.css','themes.css']:
            self.assertEqual(self.client.get(f'/css/{f}').status_code, 200)

class TestCrawlerModule(unittest.TestCase):
    def test_importable(self):
        root = os.path.dirname(os.path.dirname(__file__))
        asd = os.path.join(root, 'ASD')
        if asd not in sys.path: sys.path.insert(0, asd)
        from novel_crawler import NovelCrawler
        self.assertIsNotNone(NovelCrawler())

if __name__ == '__main__':
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for tc in [TestImportFunction, TestSettingsAPI, TestTranslationAPI, TestNovelAPI, TestFrontend, TestCrawlerModule]:
        suite.addTest(loader.loadTestsFromTestCase(tc))
    result = unittest.TextTestRunner(verbosity=0).run(suite)
    print(f"\n{'='*50}\n{result.testsRun} tests, {result.testsRun - len(result.failures) - len(result.errors)} pass")
    if result.failures or result.errors: print(f"{len(result.failures)} failures, {len(result.errors)} errors")
    exit(0 if result.wasSuccessful() else 1)
