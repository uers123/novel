"""
Flask backend for the novel reader.

Features:
- TXT import and URL catalog import.
- Lazy chapter crawling with background prefetch.
- Chapter progress and reader settings persistence.
- Local TTS service adapter, designed for ChatTTS.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory

try:
    from flask_cors import CORS
except ImportError:  # Keep the app importable before dependencies are installed.
    def CORS(_app: Flask) -> None:
        return None


if sys.platform == "win32":
    import io

    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
NOVELS_DIR = BASE_DIR / "novels"
SETTINGS_FILE = BASE_DIR / "settings.json"
TTS_CACHE_DIR = BASE_DIR / "tts_cache"
UPLOADS_DIR = BASE_DIR / "uploads"
CHUNK_SIZE = 2 * 1024 * 1024
DEFAULT_SETTINGS = {
    "theme": "day",
    "fontSize": 20,
    "lineHeight": 2.0,
    "bgColor": "#F6F3EC",
    "pageEffect": "updown",
    "brightness": 100,
    "voiceId": "qinglang_male",
    "emotion": "auto",
}

app = Flask(__name__, static_folder=str(PROJECT_DIR), static_url_path="")
CORS(app)

_JSON_LOCKS: dict[str, threading.RLock] = {}
_JSON_LOCKS_GUARD = threading.Lock()


def _path_lock(path: Path) -> threading.RLock:
    key = str(path.resolve())
    with _JSON_LOCKS_GUARD:
        lock = _JSON_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _JSON_LOCKS[key] = lock
        return lock


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with _path_lock(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lock = _path_lock(path)
    with lock:
        tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}.{threading.get_ident()}.{uuid.uuid4().hex}")
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())

            last_error: OSError | None = None
            for attempt in range(8):
                try:
                    os.replace(tmp, path)
                    return
                except OSError as exc:
                    last_error = exc
                    time.sleep(0.05 * (attempt + 1))

            try:
                path.unlink(missing_ok=True)
                os.replace(tmp, path)
            except OSError as exc:
                raise last_error or exc
        finally:
            tmp.unlink(missing_ok=True)


def split_sentences(text: str) -> list[str]:
    pieces = re.split(r"(?<=[。！？!?；;])\s*|\n+", text or "")
    sentences = [p.strip() for p in pieces if len(p.strip()) > 0]
    if not sentences and text:
        sentences = [text.strip()]
    return sentences


def chunk_text(text: str, max_chars: int = 2200) -> list[str]:
    paragraphs = [p for p in re.split(r"\n{2,}", text or "") if p.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if len(current) + len(paragraph) + 2 <= max_chars:
            current = f"{current}\n\n{paragraph}".strip()
        else:
            if current:
                chunks.append(current)
            if len(paragraph) <= max_chars:
                current = paragraph
            else:
                for i in range(0, len(paragraph), max_chars):
                    chunks.append(paragraph[i : i + max_chars])
                current = ""
    if current:
        chunks.append(current)
    return chunks or ([text] if text else [])


def _read_file_with_fallback_encoding(path: str) -> str:
    """Read a text file trying multiple encodings (UTF-8 → GBK → GB2312 → ascii)."""
    encodings = ["utf-8", "gbk", "gb2312", "utf-16", "ascii"]
    for enc in encodings:
        try:
            with open(path, "r", encoding=enc) as f:
                return f.read()
        except (UnicodeDecodeError, UnicodeError):
            continue
    # Last resort: read with errors='replace'
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


class NovelManager:
    def __init__(self, storage_dir: Path):
        self.storage_dir = storage_dir
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.index_file = self.storage_dir / "_index.json"
        self._index: dict[str, dict[str, Any]] = read_json(self.index_file, {})
        self._lock = threading.RLock()

    def _save_index(self) -> None:
        write_json(self.index_file, self._index)

    def _novel_path(self, novel_id: str) -> Path:
        return self.storage_dir / novel_id

    def _chapters_file(self, novel_id: str) -> Path:
        return self._novel_path(novel_id) / "chapters.json"

    def _crawl_file(self, novel_id: str) -> Path:
        return self._novel_path(novel_id) / "crawl_status.json"

    def _read_chapters(self, novel_id: str) -> list[dict[str, Any]]:
        return read_json(self._chapters_file(novel_id), [])

    def _write_chapters(self, novel_id: str, chapters: list[dict[str, Any]]) -> None:
        write_json(self._chapters_file(novel_id), chapters)

    def _read_crawl_status(self, novel_id: str) -> dict[str, Any]:
        chapters = self._read_chapters(novel_id)
        return read_json(
            self._crawl_file(novel_id),
            {
                "novelId": novel_id,
                "total": len(chapters),
                "cached": 0,
                "prefetchTarget": 0,
                "prefetched": 0,
                "inProgress": False,
                "failed": [],
                "updatedAt": None,
            },
        )

    def _write_crawl_status(self, novel_id: str, status: dict[str, Any]) -> None:
        status["updatedAt"] = datetime.now().isoformat()
        write_json(self._crawl_file(novel_id), status)

    def list_all(self) -> list[dict[str, Any]]:
        with self._lock:
            novels = []
            for novel_id, info in self._index.items():
                novels.append(
                    {
                        "id": novel_id,
                        "title": info.get("title", "Untitled"),
                        "author": info.get("author", ""),
                        "chapterCount": info.get("chapterCount", 0),
                        "progress": info.get("progress", 0),
                        "importedAt": info.get("importedAt", ""),
                        "source": info.get("source", ""),
                        "sourceType": info.get("sourceType", "txt"),
                    }
                )
            novels.sort(key=lambda item: item["importedAt"], reverse=True)
            return novels

    def get(self, novel_id: str) -> dict[str, Any] | None:
        with self._lock:
            info = self._index.get(novel_id)
            if not info:
                return None
            chapters = self._read_chapters(novel_id)
            return {
                "id": novel_id,
                "title": info.get("title", "Untitled"),
                "author": info.get("author", ""),
                "description": info.get("description", ""),
                "chapterCount": len(chapters),
                "progress": info.get("progress", 0),
                "source": info.get("source", ""),
                "sourceType": info.get("sourceType", "txt"),
                "importedAt": info.get("importedAt", ""),
                "chapters": chapters,
            }

    def _chapter_path(self, novel_id: str, chapter_index: int) -> Path:
        return self._novel_path(novel_id) / f"chapter_{chapter_index}.txt"

    def get_chapter(self, novel_id: str, chapter_index: int) -> dict[str, Any] | None:
        if novel_id not in self._index:
            return None

        chapter_path = self._chapter_path(novel_id, chapter_index)
        if not chapter_path.exists():
            if not self._crawl_chapter(novel_id, chapter_index):
                return None

        chapters = self._read_chapters(novel_id)
        title = f"第{chapter_index + 1}章"
        if 0 <= chapter_index < len(chapters):
            title = chapters[chapter_index].get("title", title)

        with open(chapter_path, "r", encoding="utf-8") as f:
            content = f.read()

        return {
            "novelId": novel_id,
            "chapterIndex": chapter_index,
            "title": title,
            "content": content,
            "sentences": split_sentences(content),
        }

    def import_from_txt(self, file_path: str, title: str | None = None, author: str = "", source: str = "") -> dict[str, Any]:
        novel_id = str(uuid.uuid4())[:8]
        novel_path = self._novel_path(novel_id)
        novel_path.mkdir(parents=True, exist_ok=True)

        text = _read_file_with_fallback_encoding(file_path)

        if not title:
            title = Path(file_path).stem.replace("_", " ").replace("-", " ")

        chapter_rx = re.compile(
            r"^[ \t]*(第[一二三四五六七八九十百千万零〇0-9]+[章节卷部集篇回](?:[ \t:：、-][^\n]*)?|"
            r"[序楔引终尾后番前][^\n]{0,20})\s*$",
            re.MULTILINE,
        )
        matches = list(chapter_rx.finditer(text))
        chapter_titles: list[str] = []
        chapter_texts: list[str] = []

        if matches:
            if matches[0].start() > 0:
                lead = text[: matches[0].start()].strip()
                if lead:
                    chapter_titles.append("前言")
                    chapter_texts.append(lead)
            for i, match in enumerate(matches):
                start = match.end()
                end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
                chapter_titles.append(match.group(1).strip())
                chapter_texts.append(text[start:end].strip())
        else:
            paragraphs = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
            if not paragraphs:
                chapter_titles.append("正文")
                chapter_texts.append(text.strip())
            else:
                chunk_size = max(1, min(50, math.ceil(len(paragraphs) / 5)))
                for start in range(0, len(paragraphs), chunk_size):
                    chunk = "\n\n".join(paragraphs[start : start + chunk_size]).strip()
                    if chunk:
                        chapter_titles.append(f"第{len(chapter_titles) + 1}章")
                        chapter_texts.append(chunk)

        chapters = []
        for index, chapter_title in enumerate(chapter_titles):
            content = chapter_texts[index] if index < len(chapter_texts) else ""
            with open(self._chapter_path(novel_id, index), "w", encoding="utf-8") as f:
                f.write(content)
            chapters.append({"index": index, "title": chapter_title, "cached": True})

        meta = {
            "title": title.strip() if title else "Untitled",
            "author": author.strip(),
            "source": source,
            "sourceType": "txt",
            "chapterCount": len(chapters),
            "progress": 0,
            "importedAt": datetime.now().isoformat(),
        }
        write_json(novel_path / "meta.json", meta)
        self._write_chapters(novel_id, chapters)
        self._write_crawl_status(
            novel_id,
            {
                "novelId": novel_id,
                "total": len(chapters),
                "cached": len(chapters),
                "prefetchTarget": 0,
                "prefetched": len(chapters),
                "inProgress": False,
                "failed": [],
                "updatedAt": datetime.now().isoformat(),
            },
        )
        with self._lock:
            self._index[novel_id] = meta
            self._save_index()
        return {"id": novel_id, **meta}

    def import_from_crawl(
        self,
        url: str,
        title: str | None = None,
        prefetch_chapters: int = 100,
        source_type: str = "auto",
    ) -> dict[str, Any]:
        try:
            crawler = self._new_crawler(source_type)
        except TypeError:
            crawler = self._new_crawler()
        if not crawler.fetch_novel_info(url):
            raise ValueError("Unable to parse the catalog URL.")

        novel_id = str(uuid.uuid4())[:8]
        novel_path = self._novel_path(novel_id)
        novel_path.mkdir(parents=True, exist_ok=True)

        chapters = [
            {"index": ch.index, "title": ch.title, "url": ch.url, "cached": False}
            for ch in crawler.chapters
        ]
        meta = {
            "title": (title or crawler.novel_title or "Untitled").strip(),
            "author": getattr(crawler, "novel_author", ""),
            "source": url,
            "sourceType": "url",
            "chapterCount": len(chapters),
            "progress": 0,
            "importedAt": datetime.now().isoformat(),
        }
        write_json(novel_path / "meta.json", meta)
        self._write_chapters(novel_id, chapters)
        self._write_crawl_status(
            novel_id,
            {
                "novelId": novel_id,
                "total": len(chapters),
                "cached": 0,
                "prefetchTarget": min(max(prefetch_chapters, 0), len(chapters)),
                "prefetched": 0,
                "inProgress": False,
                "failed": [],
                "updatedAt": datetime.now().isoformat(),
            },
        )
        with self._lock:
            self._index[novel_id] = meta
            self._save_index()

        if prefetch_chapters > 0:
            self.prefetch_chapters(novel_id, 0, prefetch_chapters)

        return {"id": novel_id, **meta}

    def _new_crawler(self, source_type: str = "auto"):
        crawler_path = str(PROJECT_DIR / "ASD")
        if crawler_path not in sys.path:
            sys.path.insert(0, crawler_path)
        from novel_crawler import NovelCrawler

        try:
            return NovelCrawler(preferred_source=source_type)
        except TypeError:
            crawler = NovelCrawler()
            if hasattr(crawler, "set_preferred_source"):
                crawler.set_preferred_source(source_type)
            return crawler

    def _crawl_chapter(self, novel_id: str, chapter_index: int) -> bool:
        chapters = self._read_chapters(novel_id)
        if chapter_index < 0 or chapter_index >= len(chapters):
            return False
        chapter = chapters[chapter_index]
        if not chapter.get("url"):
            return False

        try:
            crawler = self._new_crawler()
            chapter_obj = type(
                "ChapterRef",
                (),
                {"title": chapter.get("title", ""), "url": chapter.get("url", ""), "index": chapter_index},
            )()
            content = crawler.download_chapter(chapter_obj)
            if not content:
                raise ValueError("empty chapter content")

            with open(self._chapter_path(novel_id, chapter_index), "w", encoding="utf-8") as f:
                f.write(content)
            chapter["cached"] = True
            chapter["cachedAt"] = datetime.now().isoformat()
            self._write_chapters(novel_id, chapters)
            self._refresh_crawl_counts(novel_id)
            return True
        except Exception as exc:
            import traceback
            print(f"PREFETCH ERROR ch{chapter_index}: {exc}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            self._mark_crawl_failed(novel_id, chapter_index, str(exc))
            return False

    def _refresh_crawl_counts(self, novel_id: str) -> dict[str, Any]:
        chapters = self._read_chapters(novel_id)
        status = self._read_crawl_status(novel_id)
        status["total"] = len(chapters)
        status["cached"] = sum(1 for ch in chapters if ch.get("cached"))
        status["prefetched"] = status["cached"]
        self._write_crawl_status(novel_id, status)
        return status

    def _mark_crawl_failed(self, novel_id: str, chapter_index: int, error: str) -> None:
        status = self._read_crawl_status(novel_id)
        failed = [item for item in status.get("failed", []) if item.get("index") != chapter_index]
        failed.append({"index": chapter_index, "error": error, "time": datetime.now().isoformat()})
        status["failed"] = failed
        self._write_crawl_status(novel_id, status)

    def prefetch_chapters(self, novel_id: str, start: int, limit: int) -> None:
        def worker() -> None:
            status = self._read_crawl_status(novel_id)
            status["inProgress"] = True
            status["prefetchTarget"] = min(limit, status.get("total", limit))
            self._write_crawl_status(novel_id, status)
            try:
                chapters = self._read_chapters(novel_id)
                end = min(len(chapters), start + max(0, limit))
                for index in range(max(0, start), end):
                    if chapters[index].get("cached"):
                        continue
                    self._crawl_chapter(novel_id, index)
                    time.sleep(0.2)
            finally:
                status = self._refresh_crawl_counts(novel_id)
                status["inProgress"] = False
                self._write_crawl_status(novel_id, status)

        thread = threading.Thread(target=worker, name=f"prefetch-{novel_id}", daemon=True)
        thread.start()

    def crawl_status(self, novel_id: str) -> dict[str, Any] | None:
        if novel_id not in self._index:
            return None
        return self._refresh_crawl_counts(novel_id)

    def delete(self, novel_id: str) -> bool:
        with self._lock:
            if novel_id not in self._index:
                return False
            novel_path = self._novel_path(novel_id)
            if novel_path.exists():
                shutil.rmtree(novel_path)
            del self._index[novel_id]
            self._save_index()
            return True

    def update_meta(self, novel_id: str, updates: dict[str, Any]) -> bool:
        with self._lock:
            if novel_id not in self._index:
                return False
            allowed = {"title", "author", "description", "coverColor"}
            for key in allowed:
                if key in updates:
                    self._index[novel_id][key] = updates[key]
            self._save_index()
            return True

    def update_progress(self, novel_id: str, chapter_index: int) -> bool:
        with self._lock:
            if novel_id not in self._index:
                return False
            self._index[novel_id]["progress"] = int(chapter_index)
            self._save_index()
            return True


class TTSService:
    def __init__(self, cache_dir: Path):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.speakers_dir = cache_dir / "speakers"
        self.speakers_dir.mkdir(parents=True, exist_ok=True)
        self._chat = None
        self._model_error: str | None = None
        self._lock = threading.Lock()
        self._speaker_cache: dict[str, Any] = {}

        # GPU / VRAM settings (can be updated via API)
        self.gpu = {
            "maxBatchSize": 5,
            "useHalfPrecision": False,
            "clearCache": True,
            "maxVRAM": 80,
            "halfPrecisionFallback": False,
        }

        self.voices = [
            {"id": "ruanmeng_female", "name": "软萌萝莉", "gender": "female", "avatar": "萝", "seed": 11451},
            {"id": "child", "name": "萌娃童声", "gender": "child", "avatar": "童", "seed": 2222},
            {"id": "dashu_male", "name": "深沉大叔", "gender": "male", "avatar": "叔", "seed": 3333},
            {"id": "young_male", "name": "温柔少年", "gender": "male", "avatar": "少", "seed": 4444},
            {"id": "qinglang_male", "name": "清朗男声", "gender": "male", "avatar": "朗", "seed": 5555},
            {"id": "mature_male", "name": "成熟男声", "gender": "male", "avatar": "熟", "seed": 6666},
            {"id": "gentle_female", "name": "温柔女声", "gender": "female", "avatar": "温", "seed": 7777},
            {"id": "cool_female", "name": "清冷女声", "gender": "female", "avatar": "冷", "seed": 8888},
        ]

        self.emotions = {
            "neutral": {"prompt": "[oral_0]", "temperature": 0.3},
            "happy": {"prompt": "[oral_4][laugh_1]", "temperature": 0.5},
            "sad": {"prompt": "[oral_1][break_4]", "temperature": 0.2},
            "angry": {"prompt": "[oral_6]", "temperature": 0.7},
            "surprise": {"prompt": "[oral_5][break_4]", "temperature": 0.6},
        }

    def _cuda_available(self) -> bool:
        try:
            import torch
            return torch.cuda.is_available()
        except Exception:
            return False

    def _clear_gpu_cache(self) -> None:
        if not self.gpu.get("clearCache"):
            return
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass

    def _vram_usage_pct(self) -> float:
        try:
            import torch
            if not torch.cuda.is_available():
                return 0
            allocated = torch.cuda.memory_allocated()
            total = torch.cuda.get_device_properties(0).total_memory
            return (allocated / total) * 100 if total > 0 else 0
        except Exception:
            return 0

    def _maybe_throttle_batch(self, requested: int) -> int:
        vram_pct = self._vram_usage_pct()
        limit = self.gpu.get("maxVRAM", 80)
        if vram_pct > limit and requested > 1:
            reduced = max(1, requested // 2)
            import sys
            print(f"  VRAM {vram_pct:.0f}% > {limit}% — throttling {requested}->{reduced}", file=sys.stderr)
            return reduced
        return min(requested, self.gpu.get("maxBatchSize", 5))

    def update_gpu_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        for key in ("maxBatchSize", "useHalfPrecision", "clearCache", "maxVRAM"):
            if key in settings:
                self.gpu[key] = settings[key]
        return dict(self.gpu)

    def list_voices(self) -> list[dict[str, Any]]:
        available = self._chattts_available()
        return [{**voice, "installed": available, "available": available} for voice in self.voices]

    def list_emotions(self) -> list[dict[str, str]]:
        names = {
            "auto": "自动识别",
            "neutral": "平静",
            "happy": "开心",
            "sad": "悲伤",
            "angry": "愤怒",
            "surprise": "惊讶",
        }
        return [{"id": key, "name": names[key]} for key in ["auto", *self.emotions.keys()]]

    def _mock_enabled(self) -> bool:
        return os.environ.get("NOVEL_READER_MOCK_TTS", "").lower() in {"1", "true", "yes"}

    def _chattts_available(self) -> bool:
        if self._model_error:
            return False
        try:
            import ChatTTS
            return True
        except Exception:
            pass
        # Fallback: scan known site-packages paths
        try:
            import importlib.util
            import glob as _glob
            for _p in _glob.glob(
                sys.prefix + "/Lib/site-packages/ChatTTS",
            ) + _glob.glob(
                sys.prefix + "/lib/python*/site-packages/ChatTTS",
            ):
                if _p:
                    return True
        except Exception:
            pass
        return False

    def _ensure_chattts_importable(self) -> None:
        """Ensure ChatTTS can be imported, trying alternate site-packages paths if needed."""
        try:
            import ChatTTS  # noqa: F401
            return
        except ImportError:
            pass
        # Fallback: scan for ChatTTS in common site-packages locations
        import glob
        candidates = glob.glob(
            sys.prefix + "/Lib/site-packages/ChatTTS"
        ) + glob.glob(
            sys.prefix + "/lib/python*/site-packages/ChatTTS"
        )
        # Also check other Python installations
        for _base in ["D:/py3.13.3", "D:/anaconda", "C:/Users/39528/AppData/Local/Programs/Python/Python312"]:
            candidates += glob.glob(_base + "/Lib/site-packages/ChatTTS")
            candidates += glob.glob(_base + "/lib/python*/site-packages/ChatTTS")
        for _p in candidates:
            _sp = _p.replace("/ChatTTS", "").replace("\\ChatTTS", "")
            if _sp not in sys.path:
                sys.path.insert(0, _sp)
                try:
                    import ChatTTS  # noqa: F401
                    import sys
                    print(f"  ChatTTS found via fallback path: {_sp}", file=sys.stderr)
                    return
                except ImportError:
                    if _sp in sys.path:
                        sys.path.remove(_sp)
        raise ImportError("ChatTTS not found in any Python site-packages")

    def _load_model(self):
        if self._chat is not None:
            return self._chat
        if self._model_error:
            raise RuntimeError(self._model_error)
        try:
            self._ensure_chattts_importable()
            import ChatTTS
            import numpy as np
            import torch

            with self._lock:
                if self._chat is None:
                    chat = ChatTTS.Chat()
                    chat.load(source="huggingface", compile=False)
                    use_half = self._cuda_available() and self.gpu.get("useHalfPrecision", True)
                    if use_half:
                        try:
                            if hasattr(chat, 'decoder') and hasattr(chat.decoder, 'half'):
                                chat.decoder = chat.decoder.half()
                            if hasattr(chat, 'model') and hasattr(chat.model, 'half'):
                                chat.model = chat.model.half()
                        except Exception:
                            self.gpu["useHalfPrecision"] = False
                            self.gpu["halfPrecisionFallback"] = True
                    self._chat = chat
                    self._init_voice_embeddings()
                    self._clear_gpu_cache()
            return self._chat
        except Exception as exc:
            self._model_error = (
                "ChatTTS is not installed or failed to load. "
                "Install: pip install ChatTTS torch torchaudio soundfile transformers==4.41.0. "
                f"Details: {exc}"
            )
            raise RuntimeError(self._model_error) from exc

    def _init_voice_embeddings(self) -> None:
        for voice in self.voices:
            emb_path = self.speakers_dir / f"{voice['id']}.txt"
            if emb_path.exists():
                continue
            spk_emb = self._chat.sample_random_speaker()
            emb_path.write_text(spk_emb, encoding="utf-8")

    def _get_speaker_embedding(self, voice_id: str) -> str:
        if voice_id in self._speaker_cache:
            return self._speaker_cache[voice_id]
        emb_path = self.speakers_dir / f"{voice_id}.txt"
        if emb_path.exists():
            spk_emb = emb_path.read_text(encoding="utf-8")
        else:
            spk_emb = self._chat.sample_random_speaker()
            emb_path.write_text(spk_emb, encoding="utf-8")
        self._speaker_cache[voice_id] = spk_emb
        return spk_emb

    @staticmethod
    def detect_emotion(text: str) -> str:
        happy_kw = ["开心", "高兴", "快乐", "欢喜", "愉快", "兴奋", "惊喜", "美好", "棒", "赞", "哈哈", "嘻嘻", "笑了"]
        sad_kw = ["伤心", "难过", "悲伤", "悲哀", "流泪", "痛苦", "失落", "忧愁", "可怜", "呜呜", "哭了"]
        angry_kw = ["生气", "可恶", "该死", "混蛋", "滚开", "烦躁", "暴躁", "气死", "气人", "愤怒", "讨厌", "恨"]
        surprise_kw = ["惊讶", "震惊", "诧异", "竟然", "居然", "没想到", "天哪", "哇", "啊呀"]
        text_lower = text
        scores = {"neutral": 0, "happy": 0, "sad": 0, "angry": 0, "surprise": 0}
        for kw in happy_kw:
            scores["happy"] += text_lower.count(kw) * 2
        for kw in surprise_kw:
            scores["surprise"] += text_lower.count(kw) * 2
        for kw in sad_kw:
            scores["sad"] += text_lower.count(kw) * 2
        for kw in angry_kw:
            scores["angry"] += text_lower.count(kw) * 2
        scores["happy"] += text_lower.count("！") + text_lower.count("!")
        scores["surprise"] += text_lower.count("？") + text_lower.count("?")
        best = max(scores, key=scores.get)
        return best if scores[best] > 0 else "neutral"

    def _tts_params(self, voice_id: str, rate: float, emotion: str):
        import ChatTTS as CT
        voice_seed = 42
        for v in self.voices:
            if v["id"] == voice_id:
                voice_seed = v["seed"]
                break
        emotion_cfg = self.emotions.get(emotion, self.emotions["neutral"])
        spk_emb = self._get_speaker_embedding(voice_id)
        speed_val = max(1, min(9, round(rate * 5)))
        params_refine_text = CT.Chat.RefineTextParams(prompt=emotion_cfg["prompt"])
        params_infer_code = CT.Chat.InferCodeParams(
            spk_emb=spk_emb,
            manual_seed=voice_seed,
            temperature=emotion_cfg["temperature"],
            top_P=0.7,
            top_K=20,
            prompt=f"[speed_{speed_val}]",
        )
        return params_refine_text, params_infer_code

    def _synthesize_one(self, text: str, voice_id: str, rate: float, emotion: str) -> dict[str, Any]:
        digest = hashlib.sha256(f"{voice_id}|{rate}|{emotion}|{text}".encode("utf-8")).hexdigest()[:24]
        audio_path = self.cache_dir / f"{digest}.wav"
        if audio_path.exists():
            return {"cached": True, "audioUrl": f"/api/tts/audio/{audio_path.name}"}
        if self._mock_enabled():
            return {"cached": False, "audioUrl": f"/api/tts/audio/mock-{digest}.wav", "mock": True}
        chat = self._load_model()
        import soundfile as sf
        prp, pic = self._tts_params(voice_id, rate, emotion)
        try:
            with self._lock:
                wavs = chat.infer([text], params_refine_text=prp, params_infer_code=pic, use_decoder=True)
        except RuntimeError as exc:
            if self.gpu.get("useHalfPrecision") and "Half" in str(exc):
                self.gpu["useHalfPrecision"] = False
                self.gpu["halfPrecisionFallback"] = True
                self._chat = None
                chat = self._load_model()
                prp, pic = self._tts_params(voice_id, rate, emotion)
                with self._lock:
                    wavs = chat.infer([text], params_refine_text=prp, params_infer_code=pic, use_decoder=True)
            else:
                raise
        sf.write(str(audio_path), wavs[0], 24000)
        self._clear_gpu_cache()
        return {"cached": False, "audioUrl": f"/api/tts/audio/{audio_path.name}"}

    def synthesize(self, text: str, voice_id: str, rate: float = 1.0, emotion: str | None = None) -> dict[str, Any]:
        text = (text or "").strip()
        if not text:
            raise ValueError("text is required")
        voice_id = voice_id or "qinglang_male"
        if emotion == "auto":
            emotion = None
        emotion = emotion or self.detect_emotion(text)
        sentences = split_sentences(text)
        result = self._synthesize_one(text, voice_id, rate, emotion)
        return {**result, "sentences": sentences, "voiceId": voice_id}

    def synthesize_batch(self, texts: list[str], voice_id: str, rate: float = 1.0, emotion: str | None = None) -> list[dict[str, Any]]:
        texts = [t.strip() for t in texts if t.strip()]
        if not texts:
            return []
        voice_id = voice_id or "qinglang_male"
        if emotion == "auto":
            emotion = None
        results: list[dict[str, Any]] = [None] * len(texts)
        uncached: list[tuple[int, str, str, str]] = []
        for i, text in enumerate(texts):
            emo = emotion or self.detect_emotion(text)
            digest = hashlib.sha256(f"{voice_id}|{rate}|{emo}|{text}".encode("utf-8")).hexdigest()[:24]
            audio_path = self.cache_dir / f"{digest}.wav"
            if audio_path.exists():
                results[i] = {"index": i, "cached": True, "audioUrl": f"/api/tts/audio/{audio_path.name}"}
            else:
                uncached.append((i, text, emo, digest))
        if not uncached:
            return results
        if self._mock_enabled():
            for orig_idx, _text, _emo, digest in uncached:
                results[orig_idx] = {
                    "index": orig_idx,
                    "cached": False,
                    "audioUrl": f"/api/tts/audio/mock-{digest}.wav",
                    "mock": True,
                }
            return results
        chat = self._load_model()
        import soundfile as sf
        sub_batch_size = self._maybe_throttle_batch(len(uncached))
        for chunk_start in range(0, len(uncached), sub_batch_size):
            chunk = uncached[chunk_start:chunk_start + sub_batch_size]
            chunk_texts = [item[1] for item in chunk]
            batch_emo = chunk[0][2]
            prp, pic = self._tts_params(voice_id, rate, batch_emo)
            try:
                with self._lock:
                    wavs = chat.infer(chunk_texts, params_refine_text=prp, params_infer_code=pic, use_decoder=True, split_text=False)
            except RuntimeError as exc:
                if self.gpu.get("useHalfPrecision") and "Half" in str(exc):
                    self.gpu["useHalfPrecision"] = False
                    self.gpu["halfPrecisionFallback"] = True
                    self._chat = None
                    chat = self._load_model()
                    prp, pic = self._tts_params(voice_id, rate, batch_emo)
                    with self._lock:
                        wavs = chat.infer(chunk_texts, params_refine_text=prp, params_infer_code=pic, use_decoder=True, split_text=False)
                else:
                    raise
            for (orig_idx, text, emo, digest), wav in zip(chunk, wavs):
                audio_path = self.cache_dir / f"{digest}.wav"
                sf.write(str(audio_path), wav, 24000)
                results[orig_idx] = {"index": orig_idx, "cached": False, "audioUrl": f"/api/tts/audio/{audio_path.name}"}
            self._clear_gpu_cache()
        return results


class TranslationService:
    """Real-time text translation using deep-translator (free Google Translate API)."""

    def __init__(self):
        self._cache: dict[str, str] = {}
        self._lock = threading.Lock()

    def translate(self, text: str, target: str = "zh-CN", source: str = "auto") -> dict[str, Any]:
        if not text or not text.strip():
            return {"text": "", "source": source, "target": target}

        cache_key = f"{source}|{target}|{text}"
        with self._lock:
            cached = self._cache.get(cache_key)
            if cached:
                return {"text": cached, "source": source, "target": target, "cached": True}

        try:
            from deep_translator import GoogleTranslator
            translator = GoogleTranslator(source=source, target=target)
            result = translator.translate(text)
            translated = result or ""
            with self._lock:
                self._cache[cache_key] = translated
            return {"text": translated, "source": source, "target": target, "cached": False}
        except Exception as exc:
            raise RuntimeError(f"Translation failed: {exc}")

    def translate_batch(self, texts: list[str], target: str = "zh-CN", source: str = "auto") -> list[dict[str, Any]]:
        results = []
        for text in texts:
            try:
                results.append(self.translate(text, target, source))
            except Exception:
                results.append({"text": "", "source": source, "target": target, "error": True})
        return results


novel_manager = NovelManager(NOVELS_DIR)
tts_service = TTSService(TTS_CACHE_DIR)
translation_service = TranslationService()


@app.route("/")
def index():
    return send_from_directory(str(PROJECT_DIR), "index.html")


@app.route("/api/novels", methods=["GET"])
def api_list_novels():
    return jsonify({"novels": novel_manager.list_all()})


@app.route("/api/novels/<novel_id>", methods=["GET"])
def api_get_novel(novel_id: str):
    novel = novel_manager.get(novel_id)
    if not novel:
        return jsonify({"error": "novel not found"}), 404
    return jsonify(novel)


@app.route("/api/novels/<novel_id>/chapters/<int:chapter_index>", methods=["GET"])
def api_get_chapter(novel_id: str, chapter_index: int):
    chapter = novel_manager.get_chapter(novel_id, chapter_index)
    if not chapter:
        return jsonify({"error": "chapter not found"}), 404
    return jsonify(chapter)


@app.route("/api/novels/import", methods=["POST"])
def api_import_novel():
    if "file" not in request.files:
        return jsonify({"error": "TXT file is required"}), 400

    uploaded = request.files["file"]
    if not uploaded.filename:
        return jsonify({"error": "file name is empty"}), 400

    temp_path = NOVELS_DIR / f"_upload_{uuid.uuid4().hex}.txt"
    temp_path.parent.mkdir(parents=True, exist_ok=True)
    uploaded.save(str(temp_path))
    try:
        result = novel_manager.import_from_txt(
            str(temp_path),
            title=request.form.get("title") or Path(uploaded.filename).stem,
            author=request.form.get("author", ""),
        )
        return jsonify({"success": True, "novel": result}), 201
    finally:
        if temp_path.exists():
            temp_path.unlink()


@app.route("/api/novels/import/start", methods=["POST"])
def api_import_start():
    data = request.get_json(silent=True) or {}
    filename = Path(data.get("filename") or "upload.txt").name
    if not filename.lower().endswith(".txt"):
        return jsonify({"error": "TXT file is required"}), 400

    upload_id = uuid.uuid4().hex
    upload_dir = UPLOADS_DIR / upload_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    meta = {
        "uploadId": upload_id,
        "filename": filename,
        "title": data.get("title") or Path(filename).stem,
        "author": data.get("author", ""),
        "totalSize": int(data.get("totalSize", 0) or 0),
        "chunkSize": int(data.get("chunkSize", CHUNK_SIZE) or CHUNK_SIZE),
        "createdAt": datetime.now().isoformat(),
        "chunks": [],
    }
    write_json(upload_dir / "upload.json", meta)
    return jsonify({"uploadId": upload_id, "chunkSize": meta["chunkSize"]}), 201


@app.route("/api/novels/import/chunk", methods=["POST"])
def api_import_chunk():
    upload_id = request.form.get("uploadId", "")
    chunk_index = request.form.get("chunkIndex", "")
    if not upload_id or not chunk_index.isdigit() or "chunk" not in request.files:
        return jsonify({"error": "uploadId, chunkIndex and chunk are required"}), 400

    upload_dir = UPLOADS_DIR / upload_id
    meta_path = upload_dir / "upload.json"
    if not meta_path.exists():
        return jsonify({"error": "upload not found"}), 404

    index = int(chunk_index)
    chunk_file = upload_dir / f"chunk_{index:08d}.part"
    request.files["chunk"].save(str(chunk_file))

    meta = read_json(meta_path, {})
    chunks = set(int(item) for item in meta.get("chunks", []))
    chunks.add(index)
    meta["chunks"] = sorted(chunks)
    write_json(meta_path, meta)
    return jsonify({"success": True, "received": index})


@app.route("/api/novels/import/complete", methods=["POST"])
def api_import_complete():
    data = request.get_json(silent=True) or {}
    upload_id = data.get("uploadId", "")
    upload_dir = UPLOADS_DIR / upload_id
    meta_path = upload_dir / "upload.json"
    if not meta_path.exists():
        return jsonify({"error": "upload not found"}), 404

    meta = read_json(meta_path, {})
    chunk_files = sorted(upload_dir.glob("chunk_*.part"))
    if not chunk_files:
        return jsonify({"error": "no chunks uploaded"}), 400

    assembled = upload_dir / meta.get("filename", "upload.txt")
    with open(assembled, "wb") as out:
        for expected, chunk_file in enumerate(chunk_files):
            if chunk_file.name != f"chunk_{expected:08d}.part":
                return jsonify({"error": f"missing chunk {expected}"}), 400
            with open(chunk_file, "rb") as src:
                shutil.copyfileobj(src, out)

    try:
        result = novel_manager.import_from_txt(
            str(assembled),
            title=data.get("title") or meta.get("title"),
            author=data.get("author", meta.get("author", "")),
        )
        return jsonify({"success": True, "novel": result}), 201
    finally:
        shutil.rmtree(upload_dir, ignore_errors=True)


@app.route("/api/novels/import/<upload_id>", methods=["DELETE"])
def api_import_cancel(upload_id: str):
    upload_dir = UPLOADS_DIR / upload_id
    if not upload_dir.exists():
        return jsonify({"error": "upload not found"}), 404
    shutil.rmtree(upload_dir, ignore_errors=True)
    return jsonify({"success": True})


@app.route("/api/novels/import-url", methods=["POST"])
def api_import_from_url():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url is required"}), 400
    prefetch = int(data.get("prefetchChapters", 100))
    try:
        source_type = data.get("sourceType") or data.get("source") or "auto"
        result = novel_manager.import_from_crawl(
            url,
            title=data.get("title") or None,
            prefetch_chapters=prefetch,
            source_type=source_type,
        )
        status = novel_manager.crawl_status(result["id"])
        return jsonify({"success": True, "novel": result, "crawlStatus": status}), 201
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"crawl import failed: {exc}"}), 500


@app.route("/api/novels/<novel_id>/crawl-status", methods=["GET"])
def api_crawl_status(novel_id: str):
    status = novel_manager.crawl_status(novel_id)
    if not status:
        return jsonify({"error": "novel not found"}), 404
    return jsonify(status)


@app.route("/api/novels/<novel_id>", methods=["DELETE"])
def api_delete_novel(novel_id: str):
    if novel_manager.delete(novel_id):
        return jsonify({"success": True})
    return jsonify({"error": "novel not found"}), 404


@app.route("/api/novels/<novel_id>/meta", methods=["PUT"])
def api_update_novel_meta(novel_id: str):
    data = request.get_json(silent=True) or {}
    if novel_manager.update_meta(novel_id, data):
        return jsonify({"success": True, "novel": novel_manager.get(novel_id)})
    return jsonify({"error": "novel not found"}), 404


@app.route("/api/novels/<novel_id>/progress", methods=["PUT"])
def api_update_progress(novel_id: str):
    data = request.get_json(silent=True) or {}
    if novel_manager.update_progress(novel_id, int(data.get("chapterIndex", 0))):
        return jsonify({"success": True})
    return jsonify({"error": "novel not found"}), 404


@app.route("/api/tts/voices", methods=["GET"])
def api_tts_voices():
    return jsonify({"voices": tts_service.list_voices()})


@app.route("/api/tts/emotions", methods=["GET"])
def api_tts_emotions():
    return jsonify({"emotions": tts_service.list_emotions()})


@app.route("/api/tts/synthesize", methods=["POST"])
def api_tts_synthesize():
    data = request.get_json(silent=True) or {}
    try:
        text = data.get("text")
        if not text and data.get("novelId") and data.get("chapterIndex") is not None:
            chapter = novel_manager.get_chapter(data["novelId"], int(data["chapterIndex"]))
            if not chapter:
                return jsonify({"error": "chapter not found"}), 404
            sentences = chapter.get("sentences") or split_sentences(chapter["content"])
            sentence_index = data.get("sentenceIndex")
            text = sentences[int(sentence_index)] if sentence_index is not None else chapter["content"]
        result = tts_service.synthesize(
                text or "",
                data.get("voiceId") or DEFAULT_SETTINGS["voiceId"],
                float(data.get("rate", 1.0)),
                data.get("emotion"),
            )
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "installed": False}), 503
    except Exception as exc:
        return jsonify({"error": f"TTS failed: {exc}"}), 500


@app.route("/api/tts/synthesize_batch", methods=["POST"])
def api_tts_synthesize_batch():
    """Batch TTS: generate audio for multiple texts in one GPU call."""
    data = request.get_json(silent=True) or {}
    try:
        texts = data.get("texts", [])
        if not texts:
            return jsonify({"error": "texts list is required"}), 400
        results = tts_service.synthesize_batch(
            texts,
            data.get("voiceId") or DEFAULT_SETTINGS["voiceId"],
            float(data.get("rate", 1.0)),
            data.get("emotion"),
        )
        return jsonify({"results": results, "count": len(results)})
    except RuntimeError as exc:
        return jsonify({"error": str(exc), "installed": False}), 503
    except Exception as exc:
        return jsonify({"error": f"batch TTS failed: {exc}"}), 500


@app.route("/api/tts/audio/<path:filename>", methods=["GET"])
def api_tts_audio(filename: str):
    return send_from_directory(str(TTS_CACHE_DIR), filename)


@app.route("/api/tts/gpu-settings", methods=["GET"])
def api_tts_gpu_settings():
    return jsonify({"gpu": tts_service.gpu, "cudaAvailable": tts_service._cuda_available()})


@app.route("/api/tts/gpu-settings", methods=["PUT"])
def api_tts_update_gpu_settings():
    data = request.get_json(silent=True) or {}
    settings = tts_service.update_gpu_settings(data)
    return jsonify({"success": True, "gpu": settings})


@app.route("/api/translate", methods=["POST"])
def api_translate():
    """Translate text with auto-detect source language."""
    data = request.get_json(silent=True) or {}
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "text is required"}), 400
    target = data.get("target", "zh-CN")
    source = data.get("source", "auto")
    try:
        if data.get("batch"):
            texts = data.get("texts", [text])
            results = translation_service.translate_batch(texts, target, source)
            return jsonify({"results": results, "count": len(results)})
        result = translation_service.translate(text, target, source)
        return jsonify(result)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503
    except Exception as exc:
        return jsonify({"error": f"Translation failed: {exc}"}), 500


@app.route("/api/translate/chapter", methods=["POST"])
def api_translate_chapter():
    data = request.get_json(silent=True) or {}
    novel_id = data.get("novelId", "")
    chapter_index = data.get("chapterIndex")
    target = (data.get("target") or "zh-CN").lower()
    source = data.get("source", "auto")
    force = bool(data.get("force"))

    if not novel_id or chapter_index is None:
        return jsonify({"error": "novelId and chapterIndex are required"}), 400

    chapter = novel_manager.get_chapter(novel_id, int(chapter_index))
    if not chapter:
        return jsonify({"error": "chapter not found"}), 404

    translation_dir = novel_manager._novel_path(novel_id) / "translations"
    translation_dir.mkdir(parents=True, exist_ok=True)
    safe_target = re.sub(r"[^a-z0-9_-]+", "-", target)
    cache_file = translation_dir / f"chapter_{int(chapter_index)}_{safe_target}.txt"
    if cache_file.exists() and not force:
        translated = cache_file.read_text(encoding="utf-8")
        return jsonify({
            "novelId": novel_id,
            "chapterIndex": int(chapter_index),
            "target": target,
            "translated": translated,
            "text": translated,
            "cached": True,
        })

    try:
        chunks = chunk_text(chapter.get("content", ""), max_chars=1800)
        translated_chunks = [
            translation_service.translate(chunk, target, source).get("text", "")
            for chunk in chunks
        ]
        translated = "\n\n".join(item for item in translated_chunks if item)
        cache_file.write_text(translated, encoding="utf-8")
        return jsonify({
            "novelId": novel_id,
            "chapterIndex": int(chapter_index),
            "target": target,
            "translated": translated,
            "text": translated,
            "cached": False,
        })
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503
    except Exception as exc:
        return jsonify({"error": f"Translation failed: {exc}"}), 500


@app.route("/api/translate/tasks/<task_id>", methods=["GET"])
def api_translate_task(task_id: str):
    return jsonify({"error": "translation task not found", "taskId": task_id}), 404


@app.route("/api/languages", methods=["GET"])
def api_languages():
    """Return supported target languages for translation."""
    return jsonify({
        "languages": [
            {"code": "zh-CN", "name": "简体中文"},
            {"code": "zh-TW", "name": "繁体中文"},
            {"code": "en", "name": "English"},
            {"code": "ja", "name": "日本語"},
            {"code": "ko", "name": "한국어"},
            {"code": "fr", "name": "Français"},
            {"code": "de", "name": "Deutsch"},
            {"code": "es", "name": "Español"},
            {"code": "ru", "name": "Русский"},
            {"code": "th", "name": "ไทย"},
            {"code": "vi", "name": "Tiếng Việt"},
        ]
    })


@app.route("/api/settings", methods=["GET"])
def api_get_settings():
    settings = {**DEFAULT_SETTINGS, **read_json(SETTINGS_FILE, {})}
    return jsonify(settings)


@app.route("/api/settings", methods=["POST"])
def api_save_settings():
    settings = {**DEFAULT_SETTINGS, **(request.get_json(silent=True) or {})}
    write_json(SETTINGS_FILE, settings)
    return jsonify({"success": True, "settings": settings})


@app.route("/<path:path>")
def static_files(path: str):
    return send_from_directory(str(PROJECT_DIR), path)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    print("Novel reader backend starting")
    print(f"Python: {sys.executable}")
    print(f"Storage: {NOVELS_DIR}")
    _chattts_ok = tts_service._chattts_available()
    print(f"ChatTTS: {'✓ available' if _chattts_ok else '✗ NOT FOUND'}")
    if tts_service._cuda_available():
        import torch
        _vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        print(f"CUDA: ✓ {torch.cuda.get_device_name()} ({_vram:.1f} GB)")
    else:
        print("CUDA: ✗ not available")
    print(f"URL: http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
