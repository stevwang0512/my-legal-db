#!/usr/bin/env python3
# Minimal builder: scan content/, make a manifest and stub shard files.
import os, json, re, pathlib, sys, hashlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTENT = ROOT/'content'
INDEX = ROOT/'index'
INDEX.mkdir(exist_ok=True)

docs = []
for p in CONTENT.rglob('*.md'):
    rel = p.relative_to(CONTENT).as_posix()
    title = None
    # try read first heading
    with p.open('r', encoding='utf-8') as f:
        text = f.read()
    m = re.search(r'^\s*#\s*(.+)$', text, flags=re.M)
    if m: title = m.group(1).strip()
    docs.append({'id': hashlib.md5(rel.encode()).hexdigest()[:8], 'title': title, 'path': rel})

# manifest for left doc list
(ROOT/'index/manifest.json').write_text(json.dumps({'docs': docs}, ensure_ascii=False, indent=2), encoding='utf-8')

# stub shard router & shard (for demo only)
route_js = {
  "route": "function(q){ return ['shard_00.json']; }"
}
(ROOT/'index/route.json').write_text(json.dumps(route_js, ensure_ascii=False), encoding='utf-8')

# very tiny demo shard with fake search
shard = {
  "search": "function(q){ return window.__DEMO_HITS__ || []; }"
}
(ROOT/'index/shard_00.json').write_text(json.dumps(shard, ensure_ascii=False), encoding='utf-8')

print('Built minimal index.')
