#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建站点数据：
- 同时扫描 content/ 与 site/content/（多根扫描）
- 生成：
  1) /index/tree.json  + /site/index/tree.json（树状目录）
  2) /index/docs.json  + /site/index/docs.json（扁平文档清单）
- 目录与文件统一支持数字前缀排序（01_ / 01- / 01. / 01 空格）
- JSON 中的文件 path 带真实前缀：content/... 或 site/content/...
"""
from __future__ import annotations

from pathlib import Path
from collections import defaultdict
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]

# ========= 读取正文标题（保留旧功能） =========
def read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""

def strip_front_matter(s: str) -> str:
    if s.startswith("---"):
        m = re.search(r"^---\s*$.*?^---\s*$", s, flags=re.S | re.M)
        if m:
            return s[m.end():]
    return s

def first_heading_title(s: str, fallback: str) -> str:
    m = re.search(r"^\s*#{1,6}\s+(.+?)\s*$", s, flags=re.M)
    return m.group(1).strip() if m else fallback

# ========= 排序 + 剥前缀（目录与 md 统一） =========
ORDER_RE = re.compile(r"^(?P<num>\d+)[\s._-]+")

def strip_prefix(name: str) -> str:
    m = ORDER_RE.match(name)
    return name[m.end():] if m else name

def order_key(name: str):
    """有数字前缀的先按数字，再按无前缀名；无前缀的整体排后。"""
    m = ORDER_RE.match(name)
    if m:
        return (0, int(m.group("num")), strip_prefix(name).lower())
    return (1, name.lower())

# ========= 多根扫描：content/ 与 site/content/ =========
def detect_content_roots() -> list[tuple[str, Path]]:
    roots: list[tuple[str, Path]] = []
    p1 = ROOT / "content"
    p2 = ROOT / "site" / "content"
    if p1.exists():
        roots.append(("content", p1))          # 前缀 'content'
    if p2.exists():
        roots.append(("site/content", p2))     # 前缀 'site/content'
    return roots

# ========= 构建树（L2/L3/L4）与扁平 docs =========
def build_tree_and_docs(roots: list[tuple[str, Path]]):
    """
    允许：
      - L3 目录下直接放 md
      - 或 L4 目录下放 md
    返回：
      tree: 目录树（3 层）
      docs: 扁平文档列表（用于“全部文档”或检索）
    """
    level2 = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    flat_docs = []

    for prefix, src in roots:
        for p in src.rglob("*.md"):
            parts = p.relative_to(src).parts
            # 统一输出 path：带真实前缀
            rel  = p.relative_to(src).as_posix()
            path = f"{prefix}/{rel}"

            raw   = read_text(p)
            title = first_heading_title(strip_front_matter(raw), p.stem)

            # 扁平 docs 项
            flat_docs.append({
                "type": "file",
                "name": p.name,
                "display": strip_prefix(p.stem),
                "path": path,     # 关键：带真实前缀（content/ 或 site/content/）
                "title": title
            })

            # 三层树分桶
            if len(parts) == 3:
                L2, L3, _ = parts
                level2[L2][L3]["__files__"].append((p, path, title))
            elif len(parts) >= 4:
                L2, L3, L4 = parts[0], parts[1], parts[2]
                level2[L2][L3][L4].append((p, path, title))
            else:
                # 太浅的结构不进树（扁平列表已收录）
                continue

    tree = []
    for name2 in sorted(level2.keys(), key=order_key):
        n2 = {"type": "dir", "name": name2, "display": strip_prefix(name2), "children": []}
        for name3 in sorted(level2[name2].keys(), key=order_key):
            bucket = level2[name2][name3]
            n3 = {"type": "dir", "name": name3, "display": strip_prefix(name3), "children": []}

            files_lvl3 = bucket.get("__files__", [])
            if files_lvl3:
                for f, path, title in sorted(files_lvl3, key=lambda x: order_key(x[0].name)):
                    n3["children"].append({
                        "type": "file",
                        "name": f.name,
                        "display": strip_prefix(f.stem),
                        "path": path,
                        "title": title
                    })

            for name4 in sorted((k for k in bucket.keys() if k != "__files__"), key=order_key):
                files = bucket[name4]
                if not files:
                    continue
                n4 = {"type": "dir", "name": name4, "display": strip_prefix(name4), "children": []}
                for f, path, title in sorted(files, key=lambda x: order_key(x[0].name)):
                    n4["children"].append({
                        "type": "file",
                        "name": f.name,
                        "display": strip_prefix(f.stem),
                        "path": path,
                        "title": title
                    })
                n3["children"].append(n4)

            n2["children"].append(n3)
        tree.append(n2)

    # 扁平 docs 排序（按文件名的排序键）
    flat_docs.sort(key=lambda d: order_key(Path(d["path"]).name))
    return tree, flat_docs

# ========= 写出到 /index 与 /site/index =========
def write_outputs(tree, docs):
    out_roots = [ROOT / "index", ROOT / "site" / "index"]
    for out_dir in out_roots:
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "tree.json").write_text(
                json.dumps(tree, ensure_ascii=False, indent=2), "utf-8"
            )
            (out_dir / "docs.json").write_text(
                json.dumps(docs, ensure_ascii=False, indent=2), "utf-8"
            )
            print("[ok] write:", out_dir)
        except Exception as e:
            print("[skip]", out_dir, e)

def main():
    roots = detect_content_roots()
    if not roots:
        print("[error] neither content/ nor site/content/ exists under repo root:", ROOT)
        sys.exit(1)
    tree, docs = build_tree_and_docs(roots)
    write_outputs(tree, docs)

if __name__ == "__main__":
    main()
