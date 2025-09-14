#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/tree_build.py  — v0.24-compat
为当前前端（app.js 读取 `index/tree.json`）生成索引；
同时解决：
- 输出目录改为 `site/index/`（之前写在仓库根 `index/` 导致 Pages 看不到）；
- 支持将“（该级文件）/该级文件/本级文件”等占位目录里的 md “上提”到上一级；
- 支持“01 名称”前缀排序，显示时去前缀；
- 可选 `.order.json` 强制排序。
"""
from __future__ import annotations
import os, json, re, pathlib
from typing import Dict, List

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTENT = ROOT / "content"
OUT_DIR = ROOT / "site" / "index"
OUT_DIR.mkdir(parents=True, exist_ok=True)

NUM_RE = re.compile(r'^\s*(\d{1,3})[._\-\s]+')
PLACEHOLDERS = {"该级文件","本级文件","docs","_files","（该级文件）","（本级文件）"}

def strip_prefix(s:str)->str:
    return NUM_RE.sub("", s).strip()

def sort_key(name:str):
    m = NUM_RE.match(name)
    if m:
        try: return (int(m.group(1)), strip_prefix(name))
        except: pass
    return (10_000, name.lower())

def load_order_map(folder: pathlib.Path)->Dict[str,int]:
    f = folder/".order.json"
    if f.exists():
        try: return json.loads(f.read_text("utf-8"))
        except: return {}
    return {}

def build_dir(folder: pathlib.Path)->dict:
    node = {"type":"dir","title": strip_prefix(folder.name), "name": folder.name, "children":[]}
    omap = load_order_map(folder)

    # md 文件作为叶子
    files = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower()==".md"]
    files.sort(key=lambda p:(omap.get(p.name, sort_key(p.name)), p.name))
    for f in files:
        node["children"].append({
            "type":"file",
            "title": strip_prefix(f.stem),
            "name": f.name,
            "path": str(f.as_posix())
        })

    # 子目录
    subdirs = [p for p in folder.iterdir() if p.is_dir()]
    subdirs.sort(key=lambda p:(omap.get(p.name, sort_key(p.name)), p.name))
    for d in subdirs:
        # 占位目录 -> 上提其中的 md，然后跳过该目录
        if d.name in PLACEHOLDERS:
            mds = [p for p in d.iterdir() if p.is_file() and p.suffix.lower()==".md"]
            mds.sort(key=lambda p:(omap.get(p.name, sort_key(p.name)), p.name))
            for f in mds:
                node["children"].append({
                    "type":"file",
                    "title": strip_prefix(f.stem),
                    "name": f.name,
                    "path": str(f.as_posix())
                })
            continue
        node["children"].append(build_dir(d))

    return node

def main():
    root_node = {"type":"root","children":[]}
    lvl1 = [p for p in CONTENT.iterdir() if p.is_dir()]
    lvl1.sort(key=lambda p:(sort_key(p.name), p.name))
    for d in lvl1:
        root_node["children"].append(build_dir(d))
    (OUT_DIR/"tree.json").write_text(json.dumps(root_node, ensure_ascii=False, indent=2), "utf-8")
    print("[tree_build] wrote", OUT_DIR/"tree.json")

if __name__ == "__main__":
    main()
