#!/usr/bin/env python3
import os, json, re, pathlib, hashlib, shutil

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTENT = ROOT/'content'
SITE = ROOT/'site'
SITE_INDEX = SITE/'index'
SITE_CONTENT = SITE/'content'

SITE_INDEX.mkdir(parents=True, exist_ok=True)
if SITE_CONTENT.exists():
    shutil.rmtree(SITE_CONTENT)
shutil.copytree(CONTENT, SITE_CONTENT)

docs = []
for p in CONTENT.rglob('*.md'):
    rel = p.relative_to(CONTENT).as_posix()
    text = p.read_text(encoding='utf-8')
    m = re.search(r'^\s*#\s*(.+)$', text, flags=re.M)
    title = m.group(1).strip() if m else rel
    docs.append({'id': hashlib.md5(rel.encode()).hexdigest()[:8], 'title': title, 'path': rel})

(SITE_INDEX/'manifest.json').write_text(json.dumps({'docs': docs}, ensure_ascii=False, indent=2), encoding='utf-8')
(SITE_INDEX/'route.json').write_text(json.dumps({"shards":["shard_00.json"]}, ensure_ascii=False), encoding='utf-8')
shard = { "search": "function(q){ if(!q) return []; return [{title:'示例命中', snippet:'这是一个占位搜索结果', path:'sample.md'}]; }" }
(SITE_INDEX/'shard_00.json').write_text(json.dumps(shard, ensure_ascii=False), encoding='utf-8')

print('Build finished.')
