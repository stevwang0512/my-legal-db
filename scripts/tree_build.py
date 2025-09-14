#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tree_build.py  (v0.24)
生成用于左侧“文档树”的 index/tree.json，支持：
1) weight（MD front-matter）与数字前缀排序：weight > 数字前缀 > 目录优先 > 名称
2) 展示名 display 去掉数字排序前缀（如“01 民法典”→“民法典”）
3) 不再注入“（该级文件）”分组，所有 md 直接出现在其父级 children 列表中
"""
import os, re, json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CONTENT_DIR = os.path.join(ROOT, "content")
OUT_DIR = os.path.join(ROOT, "index")
OUT_JSON = os.path.join(OUT_DIR, "tree.json")

# 正则
FRONT_MATTER_RE = re.compile(r'^---\s*\n(.*?)\n---\s*', re.S)
WEIGHT_RE        = re.compile(r'^\s*weight\s*:\s*(\d+)\s*$', re.M)
PREFIX_RE        = re.compile(r'^(\d+)[-_\. ]+')

def parse_weight_from_md(md_path: str):
    """从 md 文件的 front-matter 读取 weight（仅扫描开头几 KB）"""
    try:
        with open(md_path, "r", encoding="utf-8") as f:
            txt = f.read(4096)
        m = FRONT_MATTER_RE.match(txt)
        if not m:
            return None
        fm = m.group(1)
        wm = WEIGHT_RE.search(fm)
        if wm:
            return int(wm.group(1))
    except Exception:
        pass
    return None

def parse_prefix_weight(name: str):
    """从名称数字前缀解析排序权重"""
    m = PREFIX_RE.match(name)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            return None
    return None

def display_name(name: str) -> str:
    """去掉“01_ / 01- / 01. ”等数字前缀"""
    return PREFIX_RE.sub("", name, count=1)

def collect_children(dir_path: str):
    """递归收集目录/文件，注：不再构造“（该级文件）”包裹节点"""
    children = []
    for entry in os.scandir(dir_path):
        name = entry.name
        if name.startswith("."):
            continue
        full = entry.path
        if entry.is_dir():
            node = {
                "type": "dir",
                "name": name,
                "display": display_name(name),
                "path": os.path.relpath(full, ROOT).replace("\\", "/"),
                "children": collect_children(full),
            }
            # 目录：仅数字前缀
            pw = parse_prefix_weight(name)
            node["sort_weight"] = pw if pw is not None else 10**9
            children.append(node)
        else:
            if not name.lower().endswith(".md"):
                continue
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            # 文件：优先 front-matter weight，其次数字前缀
            w = parse_weight_from_md(full)
            if w is None:
                w = parse_prefix_weight(name)
            node = {
                "type": "file",
                "name": name,
                "display": display_name(name).rsplit(".md", 1)[0],
                "path": rel,
                "sort_weight": w if w is not None else 10**9,
            }
            children.append(node)
    # 排序：weight -> 目录优先 -> display 名称
    children.sort(key=lambda x: (x.get("sort_weight", 10**9), x["type"] != "dir", x["display"]))
    return children

def build_tree():
    if not os.path.isdir(CONTENT_DIR):
        raise SystemExit(f"[ERROR] content 目录不存在: {CONTENT_DIR}")
    tree = {
        "type": "root",
        "path": "content",
        "children": collect_children(CONTENT_DIR)
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(tree, f, ensure_ascii=False, indent=2)
    print(f"[OK] 写入: {OUT_JSON}")

if __name__ == "__main__":
    build_tree()
