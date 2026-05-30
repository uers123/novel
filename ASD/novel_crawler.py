"""
novel_crawler.py - 网页小说爬虫

功能:
  - 爬取常见小说网站的章节列表和正文内容
  - 支持整本下载和单章下载
  - 自动保存为 TXT 文件
  - 支持断点续爬

用法:
  python novel_crawler.py <小说目录页URL>
  python novel_crawler.py <小说目录页URL> --output ./output
  python novel_crawler.py <小说目录页URL> --start 5 --end 20
  python novel_crawler.py --interactive
"""

import os
import re
import sys
import json
import time
import argparse
from urllib.parse import urljoin, urlparse
from datetime import datetime

# Fix Windows console encoding - only when run directly (not when imported by Flask)
if sys.platform == 'win32' and __name__ == '__main__':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import requests
from bs4 import BeautifulSoup


# ===================== 配置 =====================

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.google.com/",
}

TIMEOUT = 15
RETRY_TIMES = 3
RETRY_DELAY = 2
CHAPTER_DELAY = 1  # 每章间隔，避免被封

# 持久化 Session，支持 Cookie 保持（如 syosetu 年龄验证）
_session = requests.Session()
_session.headers.update(HEADERS)
# 预置 syosetu 年龄验证 cookie（novel18.syosetu.com 需要）
_session.cookies.set('over18', 'yes', domain='.syosetu.com', path='/')


# ===================== 基础工具 =====================

def safe_filename(text, max_len=80):
    """将字符串转为安全的文件名"""
    text = re.sub(r'[\\/:*?"<>|]', '_', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:max_len]


def parse_url(base, href):
    """解析相对/绝对URL"""
    if not href:
        return None
    if href.startswith('//'):
        return 'https:' + href
    if href.startswith('/'):
        parsed = urlparse(base)
        return f"{parsed.scheme}://{parsed.netloc}{href}"
    if href.startswith(('http://', 'https://')):
        return href
    return urljoin(base, href)


def fetch(url, encoding=None):
    """获取页面内容，带重试机制（使用持久化 Session）"""
    for attempt in range(RETRY_TIMES):
        try:
            resp = _session.get(url, timeout=TIMEOUT)
            resp.raise_for_status()

            if encoding:
                resp.encoding = encoding
            else:
                # 自动检测编码
                encoding = resp.apparent_encoding or resp.encoding or 'utf-8'
                resp.encoding = encoding

            return resp.text

        except requests.RequestException as e:
            print(f"  ⚠️ 请求失败 (尝试 {attempt + 1}/{RETRY_TIMES}): {e}")
            if attempt < RETRY_TIMES - 1:
                time.sleep(RETRY_DELAY)

    return None


# ===================== 站点解析器 =====================

class Chapter:
    """表示一个章节"""
    def __init__(self, title, url, index=0):
        self.title = title.strip() if title else f"第{index + 1}章"
        self.url = url
        self.index = index

    def __str__(self):
        return f"{self.index + 1:04d}. {self.title}"


class BaseParser:
    """解析器基类"""
    SITE_NAME = ""
    SITE_DOMAINS = []

    def detect(self, url):
        """检测是否匹配此解析器"""
        domain = urlparse(url).netloc.lower()
        return any(d in domain for d in self.SITE_DOMAINS)

    def get_title(self, soup, url):
        """提取小说名"""
        return "未知书名"

    def parse_chapter_list(self, soup, url):
        """解析章节列表，返回 Chapter 列表"""
        raise NotImplementedError

    def parse_content(self, soup, url):
        """解析章节正文，返回文本内容"""
        raise NotImplementedError


class BiqugeStyleParser(BaseParser):
    """通用笔趣阁风格解析器（覆盖大部分中文小说站）"""
    SITE_NAME = "通用笔趣阁风格"
    SITE_DOMAINS = [
        'biquge', 'xbiquge', 'qubook', '69shu', '69xsw',
        'shuquge', 'uuks', 'bqg', 'qula', 'hetushu',
        'lingdian', 'quanshu', 'bxwx', 'zwdu',
        'biqubao', 'bqgka', 'bqg2', 'bqg99',
    ]

    def get_title(self, soup, url):
        # <meta property="og:novel:book_name">
        meta = soup.find('meta', property='og:novel:book_name')
        if meta and meta.get('content'):
            return meta['content'].strip()

        # <h1> 或 #info h1
        h1 = soup.find('h1')
        if h1:
            return h1.get_text(strip=True)

        return "未知书名"

    def get_author(self, soup):
        meta = soup.find('meta', property='og:novel:author')
        if meta and meta.get('content'):
            return meta['content'].strip()
        return ""

    def parse_chapter_list(self, soup, url):
        chapters = []
        seen = set()

        # 策略1: id="list" 内的 <dd> > <a>
        list_box = soup.find(id='list') or soup.find(id='chapterlist') or soup.find(class_='listmain')
        if not list_box:
            list_box = soup.find('div', class_='box_con') or soup.find(id='wrapper')

        if list_box:
            for a_tag in list_box.find_all('a', href=True):
                href = a_tag.get('href', '').strip()
                text = a_tag.get_text(strip=True)

                if not text or len(text) < 2:
                    continue
                if not href or href.startswith('#') or href == '/':
                    continue

                # 过滤非章节链接
                if not re.search(r'(章|节|话|卷|回|篇|幕)', text) and not re.search(r'\.(html|htm)$', href):
                    continue

                full_url = parse_url(url, href)
                if full_url and full_url not in seen:
                    seen.add(full_url)
                    chapters.append(Chapter(text, full_url, len(chapters)))

        # 策略2: 直接从 html 中所有 a 标签找
        if len(chapters) < 3:
            chapters = []
            seen.clear()
            for a_tag in soup.find_all('a', href=True):
                href = a_tag.get('href', '').strip()
                text = a_tag.get_text(strip=True)

                if not text or len(text) < 2:
                    continue
                if not re.search(r'(章|节|话|卷|回|篇|第)', text):
                    continue
                if not href.endswith('.html') and not href.endswith('.htm'):
                    continue

                full_url = parse_url(url, href)
                if full_url and full_url not in seen:
                    seen.add(full_url)
                    chapters.append(Chapter(text, full_url, len(chapters)))

        return chapters

    def parse_content(self, soup, url):
        # 策略1: id="content" 或 class="content"
        content_div = (
            soup.find(id='content')
            or soup.find(class_='content')
            or soup.find(id='chaptercontent')
            or soup.find(class_='chapter-content')
            or soup.find(id='booktxt')
        )

        if not content_div:
            # 策略2: 尝试大标签内的文本
            for tag in ['article', 'main', 'div']:
                content_div = soup.find(tag)
                if content_div and len(content_div.get_text(strip=True)) > 200:
                    break

        if not content_div:
            return ""

        # 清理
        for tag in content_div.find_all(['script', 'style', 'ins', 'iframe']):
            tag.decompose()

        # 获取文本
        text = content_div.get_text('\n', strip=True)

        # 去除常见的广告行
        ad_patterns = [
            r'请.*记住.*[网站].*',
            r'手.*机.*访.*问.*',
            r'推荐.*阅读.*',
            r'最快.*更新.*',
            r'最新章节.*',
            r'www\.\S+\.(com|cn|net)',
            r'天才.*秒.*记住.*',
            r'章节.*错误.*点.*举报',
            r'app.*下.*载.*',
            r'投.*推.*荐.*票.*',
            r'w w w\.',
        ]
        lines = []
        for line in text.split('\n'):
            line = line.strip()
            if not line:
                continue
            if any(re.match(p, line) for p in ad_patterns):
                continue
            lines.append(line)

        return '\n'.join(lines) if lines else text


class SyosetuParser(BaseParser):
    """「小説家になろう」系サイト解析器（syosetu.com / novel18.syosetu.com）"""
    SITE_NAME = "Syosetu/Nocuturn"
    SITE_DOMAINS = [
        'syosetu.com', 'novel18.syosetu.com',
    ]

    def get_title(self, soup, url):
        meta = soup.find('meta', property='og:title')
        if meta and meta.get('content'):
            return meta['content'].strip()
        h1 = soup.find('h1')
        if h1:
            return h1.get_text(strip=True)
        return "未知书名"

    def get_author(self, soup):
        # syosetu 作者信息在 <p class="c-announce"> 中 "作者：xxx"
        announce = soup.find('p', class_='c-announce')
        if announce:
            text = announce.get_text(strip=True)
            import re
            m = re.search(r'作者[：:]\s*(\S+)', text)
            if m:
                return m.group(1).strip()
        meta = soup.find('meta', property='og:author')
        if meta and meta.get('content'):
            return meta['content'].strip()
        return ""

    def parse_chapter_list(self, soup, url):
        chapters = []
        seen = set()

        # syosetu 章节列表在 div.p-eplist__sublist > a
        for sublist in soup.find_all('div', class_='p-eplist__sublist'):
            a = sublist.find('a', href=True)
            if not a:
                continue
            href = a.get('href', '').strip()
            text = a.get_text(strip=True)
            if not text or not href or href.startswith('#'):
                continue

            full_url = parse_url(url, href)
            if full_url and full_url not in seen:
                seen.add(full_url)
                chapters.append(Chapter(text, full_url, len(chapters)))

        # Note: syosetu 目录页已是正序（第1章在前）
        for i, ch in enumerate(chapters):
            ch.index = i

        return chapters

    def parse_content(self, soup, url):
        # syosetu 正文在 div.p-novel__body > div.p-novel__text > p
        body = soup.find('div', class_='p-novel__body')
        if not body:
            return ""

        paragraphs = []
        for text_div in body.find_all('div', class_='p-novel__text'):
            # 跳过后记
            if 'p-novel__text--afterword' in text_div.get('class', []):
                continue
            for p in text_div.find_all('p'):
                text = p.get_text(strip=True)
                if text:
                    paragraphs.append(text)

        return '\n'.join(paragraphs) if paragraphs else ""


class CustomParser(BaseParser):
    """自定义规则解析器 - 通过指定CSS选择器来解析"""
    SITE_NAME = "自定义"
    SITE_DOMAINS = []

    def __init__(self, chapter_list_sel='a', content_sel='body', title_sel='h1'):
        self._list_sel = chapter_list_sel
        self._content_sel = content_sel
        self._title_sel = title_sel
        super().__init__()

    def detect(self, url):
        return False  # 不自定检测，通过 --custom 参数手动指定

    def get_title(self, soup, url):
        h1 = soup.select_one(self._title_sel)
        return h1.get_text(strip=True) if h1 else "自定义小说"

    def parse_chapter_list(self, soup, url):
        chapters = []
        seen = set()
        for a_tag in soup.select(self._list_sel):
            href = a_tag.get('href', '').strip()
            text = a_tag.get_text(strip=True)
            if not text or not href or href.startswith('#'):
                continue
            full_url = parse_url(url, href)
            if full_url and full_url not in seen:
                seen.add(full_url)
                chapters.append(Chapter(text, full_url, len(chapters)))
        return chapters

    def parse_content(self, soup, url):
        el = soup.select_one(self._content_sel)
        if not el:
            return ""
        for tag in el.find_all(['script', 'style']):
            tag.decompose()
        return el.get_text('\n', strip=True)


# ===================== 爬虫核心 =====================

class NovelCrawler:
    """小说爬虫主引擎"""

    def __init__(self):
        self.parsers = [
            BiqugeStyleParser(),
            SyosetuParser(),
        ]
        self.novel_title = ""
        self.novel_author = ""
        self.chapters = []
        self.output_dir = ""

    def add_custom_parser(self, parser):
        self.parsers.append(parser)

    def _find_parser(self, url):
        """找到匹配的解析器"""
        for p in self.parsers:
            if p.detect(url):
                return p
        # 默认使用通用解析器
        return BiqugeStyleParser()

    def fetch_novel_info(self, url):
        """获取小说信息（书名、作者）和章节列表"""
        print(f"\n📖 正在解析目录页: {url}")

        html = fetch(url)
        if not html:
            print("❌ 无法访问目录页")
            return False

        soup = BeautifulSoup(html, 'html.parser')
        parser = self._find_parser(url)

        self.novel_title = parser.get_title(soup, url)
        print(f"  书名: {self.novel_title}")

        if hasattr(parser, 'get_author'):
            self.novel_author = parser.get_author(soup)
            if self.novel_author:
                print(f"  作者: {self.novel_author}")

        # 解析章节列表
        print("  正在解析章节列表...")
        self.chapters = parser.parse_chapter_list(soup, url)

        if not self.chapters:
            print("❌ 未找到任何章节链接")
            return False

        print(f"  ✅ 共发现 {len(self.chapters)} 章")
        return True

    def download_chapter(self, chapter, retry_count=3):
        """下载单个章节"""
        for attempt in range(retry_count):
            html = fetch(chapter.url)
            if not html:
                continue

            soup = BeautifulSoup(html, 'html.parser')
            parser = self._find_parser(chapter.url)
            content = parser.parse_content(soup, chapter.url)

            if content and len(content) > 50:
                return content
            elif content:
                print(f"  ⚠️ 内容过短 ({len(content)}字)，可能解析不完整")

            time.sleep(1)

        return ""

    def download_all(self, start=0, end=None, output_dir=None):
        """下载全部章节"""
        if not self.chapters:
            print("❌ 没有章节可下载")
            return

        if output_dir:
            self.output_dir = output_dir
        else:
            name = safe_filename(self.novel_title) if self.novel_title else "novel"
            self.output_dir = os.path.join(os.getcwd(), name)

        os.makedirs(self.output_dir, exist_ok=True)

        if end is None or end > len(self.chapters):
            end = len(self.chapters)

        target_chapters = self.chapters[start:end]
        total = len(target_chapters)

        # 准备文本收集
        all_text = []
        success_count = 0
        failed = []

        # 添加书籍头信息
        all_text.append(f"{self.novel_title}")
        if self.novel_author:
            all_text.append(f"作者：{self.novel_author}")
        all_text.append(f"下载时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
        all_text.append("=" * 60)
        all_text.append("")

        print(f"\n{'='*60}")
        print(f"📥 开始下载: {self.novel_title}")
        print(f"   范围: 第{start + 1}章 ~ 第{end}章 (共{total}章)")
        print(f"   保存到: {self.output_dir}")
        print(f"{'='*60}\n")

        for i, ch in enumerate(target_chapters):
            idx = start + i + 1
            print(f"  [{idx:04d}/{end:04d}] {ch.title}", end="")

            content = self.download_chapter(ch)
            time.sleep(CHAPTER_DELAY)

            if content:
                all_text.append(f"第{idx}章 {ch.title}")
                all_text.append("")
                all_text.append(content)
                all_text.append("")
                all_text.append("")
                success_count += 1
                print(f"  ✅ ({len(content)}字)")
            else:
                failed.append(ch)
                print(f"  ❌ 下载失败")

        # 保存完整TXT
        txt_path = os.path.join(self.output_dir, f"{safe_filename(self.novel_title)}.txt")
        full_text = '\n'.join(all_text)
        with open(txt_path, 'w', encoding='utf-8') as f:
            f.write(full_text)

        # 保存章节索引JSON
        index_path = os.path.join(self.output_dir, "chapters.json")
        ch_data = [
            {"index": c.index, "title": c.title, "url": c.url}
            for c in self.chapters
        ]
        with open(index_path, 'w', encoding='utf-8') as f:
            json.dump({
                "title": self.novel_title,
                "author": self.novel_author,
                "total": len(self.chapters),
                "chapters": ch_data,
            }, f, ensure_ascii=False, indent=2)

        # 打印结果
        print(f"\n{'='*60}")
        print(f"✅ 下载完成!")
        print(f"   成功: {success_count}/{total}")
        print(f"   失败: {len(failed)}")
        print(f"   总字数: {len(full_text)}")
        print(f"   文件: {txt_path}")
        print(f"   索引: {index_path}")

        if failed:
            print(f"\n⚠️ 失败的章节:")
            for ch in failed:
                print(f"   - {ch.title}: {ch.url}")

        print(f"{'='*60}\n")
        return txt_path

    def preview_chapters(self, count=10):
        """预览前几章"""
        if not self.chapters:
            print("❌ 无章节列表")
            return

        print(f"\n📋 《{self.novel_title}》章节预览 (前{count}章):")
        print("-" * 40)
        for i, ch in enumerate(self.chapters[:count]):
            print(f"  {i + 1:04d}. {ch.title}")
        if len(self.chapters) > count:
            print(f"  ... 共 {len(self.chapters)} 章")
        print()


# ===================== 交互模式 =====================

def interactive_mode():
    """交互式爬虫模式"""
    print("\n" + "=" * 60)
    print("  📚 小说爬虫 - 交互模式")
    print("=" * 60)

    url = input("\n📌 请输入小说目录页URL: ").strip()
    while not url:
        url = input("📌 URL不能为空，请输入: ").strip()

    crawler = NovelCrawler()
    success = crawler.fetch_novel_info(url)
    if not success:
        print("❌ 解析失败，退出")
        return

    crawler.preview_chapters()

    # 下载范围
    total = len(crawler.chapters)
    range_input = input(f"\n📌 下载范围 (1-{total})，直接回车下载全部: ").strip()

    start, end = 0, total
    if range_input:
        parts = range_input.replace('，', ',').split(',')
        if len(parts) == 1:
            try:
                start = int(parts[0]) - 1
                end = start + 1
            except ValueError:
                pass
        elif len(parts) == 2:
            try:
                start = max(0, int(parts[0]) - 1)
                end = min(total, int(parts[1]))
            except ValueError:
                pass

    start = max(0, min(start, total - 1))
    end = max(start + 1, min(end, total))

    # 输出目录
    output_dir = input(f"📌 保存文件夹 (直接回车: ./{safe_filename(crawler.novel_title)}): ").strip()

    crawler.download_all(start=start, end=end, output_dir=output_dir or None)

    # 询问是否保存配置
    save_config = input(f"\n📌 是否保存当前配置以便日后续爬? (y/N): ").strip().lower()
    if save_config == 'y':
        config_path = os.path.join(
            output_dir or safe_filename(crawler.novel_title),
            "crawler_config.json"
        )
        config = {
            "title": crawler.novel_title,
            "url": url,
            "total_chapters": total,
            "downloaded": list(range(start, end)),
        }
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        print(f"  ✅ 配置已保存: {config_path}")


# ===================== 命令行入口 =====================

def main():
    parser = argparse.ArgumentParser(
        description="📚 网页小说爬虫 - 下载并保存小说为 TXT 文件",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s https://www.biquge.com/novel/12345/
  %(prog)s https://www.biquge.com/novel/12345/ --start 5 --end 20
  %(prog)s https://www.biquge.com/novel/12345/ --output ./my_novels
  %(prog)s --interactive
  %(prog)s --list-sites
        """
    )
    parser.add_argument('url', nargs='?', help='小说目录页URL')
    parser.add_argument('--output', '-o', help='输出文件夹路径')
    parser.add_argument('--start', '-s', type=int, default=0, help='起始章节 (从1开始, 默认0=从头)')
    parser.add_argument('--end', '-e', type=int, default=0, help='结束章节 (默认=全部)')
    parser.add_argument('--interactive', '-i', action='store_true', help='交互模式')
    parser.add_argument('--list-sites', action='store_true', help='列出支持的网站')
    parser.add_argument('--preview', '-p', type=int, nargs='?', const=10, metavar='N',
                        help='预览前N章 (默认10章)')
    parser.add_argument('--custom', metavar='SELECTORS',
                        help='自定义解析: "list_sel,content_sel,title_sel" CSS选择器')

    args = parser.parse_args()

    # 列出支持的网站
    if args.list_sites:
        print("\n📚 支持的网站类型:")
        print("-" * 40)
        domains = BiqugeStyleParser.SITE_DOMAINS
        print(f"  笔趣阁风格 ({len(domains)}个):")
        for d in domains:
            print(f"    • *.{d}.*")
        print("\n⚠️ 提示: 其他网站可尝试 --custom 参数")
        print()
        return

    # 交互模式
    if args.interactive or not args.url:
        interactive_mode()
        return

    # 命令行模式
    crawler = NovelCrawler()

    # 自定义解析器
    if args.custom:
        parts = [p.strip() for p in args.custom.split(',')]
        list_sel = parts[0] if len(parts) > 0 else 'a'
        content_sel = parts[1] if len(parts) > 1 else 'body'
        title_sel = parts[2] if len(parts) > 2 else 'h1'
        crawler.add_custom_parser(CustomParser(list_sel, content_sel, title_sel))

    success = crawler.fetch_novel_info(args.url)
    if not success:
        sys.exit(1)

    if args.preview:
        crawler.preview_chapters(args.preview)

    if args.end == 0:
        args.end = len(crawler.chapters)

    crawler.download_all(
        start=max(0, args.start - 1) if args.start > 0 else 0,
        end=args.end,
        output_dir=args.output
    )


if __name__ == '__main__':
    main()
