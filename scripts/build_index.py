#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建“真·全文搜索”的静态索引（纯前端可用）：
- 读取 content/*.md
- 去掉 YAML front-matter
- jieba 分词（cut_for_search）
- 建立倒排索引：token -> { doc_id: 词频 }
- 生成：
  site/content/         # 用于 Pages 发布的原始文档
  site/index/docs.json  # 文档清单（id、path、title）
  site/index/shard_all.json  # 全量倒排索引（MVP）
  site/index/route.json # 路由信息（当前固定返回 shard_all.json）
"""
import os, re, json, hashlib, shutil, pathlib
from collections import defaultdict, Counter

# --- 依赖：jieba ---
try:
    import jieba
except ImportError:
    raise SystemExit("缺少 jieba，请在 CI 中先 pip install jieba")

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTENT = ROOT / 'content'
SITE = ROOT / 'site'
SITE_INDEX = SITE / 'index'
SITE_CONTENT = SITE / 'content'

def read_file(p: pathlib.Path) -> str:
    return p.read_text(encoding='utf-8', errors='ignore')

def strip_front_matter(md: str) -> str:
    m = re.match(r'^---[\s\S]*?---\n?', md)
    return md[m.end():] if m else md

def first_heading_title(md: str, fallback: str) -> str:
    m = re.search(r'^\s*#\s+(.+)$', md, flags=re.M)
    return (m.group(1).strip() if m else fallback)

def slugify(text: str) -> str:
    s = re.sub(r'[^\w\u4e00-\u9fa5]+', '-', text.strip().lower())
    s = re.sub(r'-{2,}', '-', s).strip('-')
    return s or 'sec'

def tokenize(text: str):
    """中文优先：jieba 的 cut_for_search；也兼容数字/字母。"""
    for tok in jieba.cut_for_search(text):
        tok = tok.strip()
        if not tok: 
            continue
        # 过滤超短标点/空白
        if all(ch in ' \t\r\n' for ch in tok): 
            continue
        yield tok

def main():
    # 1) 清空并复制 content -> site/content
    if SITE_CONTENT.exists():
        shutil.rmtree(SITE_CONTENT)
    shutil.copytree(CONTENT, SITE_CONTENT)

    SITE_INDEX.mkdir(parents=True, exist_ok=True)

    # 2) 扫描文档，抽取 title，建立文档清单
    docs = []           # [{id, path, title}]
    doc_bodies = {}     # id -> plain text（供摘要/定位）
    id_by_path = {}

    for p in sorted(CONTENT.rglob('*.md')):
        rel = p.relative_to(CONTENT).as_posix()
        raw = read_file(p)
        body = strip_front_matter(raw)
        title = first_heading_title(body, rel)
        doc_id = hashlib.md5(rel.encode('utf-8')).hexdigest()[:12]
        docs.append({'id': doc_id, 'path': rel, 'title': title})
        doc_bodies[doc_id] = body
        id_by_path[rel] = doc_id

    # 3) 建立倒排索引（token -> {doc_id: tf}）
    inverted = defaultdict(Counter)  # token -> Counter({doc_id: tf})
    for d in docs:
        doc_id = d['id']
        text = doc_bodies[doc_id]
        # 简单去 Markdown 标记（仅影响分词，不影响定位）
        plain = re.sub(r'`[^`]+`', ' ', text)
        plain = re.sub(r'#+\s*', ' ', plain)
        plain = re.sub(r'\*{1,2}', ' ', plain)
        tokens = list(tokenize(plain))
        cnt = Counter(tokens)
        for t, tf in cnt.items():
            inverted[t][doc_id] += tf

    # 4) 写 docs.json
    (SITE_INDEX / 'docs.json').write_text(
        json.dumps({'docs': docs}, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

    # 5) 写 shard_all.json（MVP）
    #    结构：{ "postings": { token: [[doc_id, tf], ...] } }
    #    注意：真实大规模会分片；这里先简化为一个文件，先“可用”
    postings = { t: [[doc_id, int(tf)] for doc_id, tf in doc_tf.items()]
                 for t, doc_tf in inverted.items() }

    (SITE_INDEX / 'shard_all.json').write_text(
        json.dumps({'postings': postings}, ensure_ascii=False),
        encoding='utf-8'
    )

    # 6) 写 route.json（前端知道从哪个文件加载索引）
    (SITE_INDEX / 'route.json').write_text(
        json.dumps({'mode': 'single', 'files': ['shard_all.json']}, ensure_ascii=False),
        encoding='utf-8'
    )

    print(f'Indexed {len(docs)} document(s), {len(inverted)} unique tokens.')
    print('Output -> site/index/docs.json, site/index/shard_all.json, site/index/route.json')

if __name__ == '__main__':
    main()
