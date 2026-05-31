# AI 有声小说阅读器

一个简洁的本地小说阅读器，支持 TXT 导入、URL 爬取、阅读进度保存、实时翻译和 ChatTTS 本地语音合成。

## 运行

```powershell
python -m pip install -r backend/requirements.txt
python backend/app.py
```

浏览器打开 `http://localhost:5000`。

基础阅读功能无需安装 ChatTTS。启用本地语音合成时，另行安装 `ChatTTS`、`torch`、`torchaudio`、`soundfile` 和 `transformers==4.41.0`。

## 测试

```powershell
$env:NOVEL_READER_MOCK_TTS = "1"
python -m unittest discover -s backend -p "test*.py" -v
```

## 目录

- `index.html`、`css/`、`js/`：前端页面与交互。
- `backend/app.py`：Flask 服务、小说存储、翻译和 TTS 接口。
- `ASD/novel_crawler.py`：多来源小说爬虫。
- `backend/test_delivery.py`：交付回归测试。

本地运行产生的小说数据、设置、音频缓存和上传临时文件不会进入版本库或发行包。
