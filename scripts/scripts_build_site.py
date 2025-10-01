#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
build_site.py — v0.28-stable
- Scan BOTH content/ and site/content/ as sources (content/ has priority)
- Copy missing/updated files into site/content/
- Build site/index/docs.json (flat list) and site/index/tree.json (hierarchy)
- Build a tiny full-text index (route.json + shard_all.json) for future use
"""
from __future__ import annotations
import os, re, json, hashlib, shutil, sys
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
SRC1 = ROOT / "content"
SRC2 = ROOT / "site" / "content"
DST  = ROOT / "site" / "content"
IDX  = ROOT / "site" / "index"

def md_title(text: str) -> str:
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("# "):
            return s[2:].strip()
    return ""

def list_md_files(base: Path) -> list[Path]:
    return [p for p in base.rglob("*.md") if p.is_file()]

def sha1_bytes(data: bytes) -> str:
    import hashlib
    h = hashlib.sha1(); h.update(data); return h.hexdigest()

def copy_if_different(src: Path, dst: Path) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)
    bsrc = src.read_bytes()
    if dst.exists():
        if sha1_bytes(bsrc) == sha1_bytes(dst.read_bytes()):
            return False
    dst.write_bytes(bsrc); return True

def merge_sources() -> tuple[list[Path], list[str]]:
    """Return all .md paths that should be present in DST and a log."""
    logs = []
    wanted = []
    priority = []
    if SRC1.exists():
        files = list_md_files(SRC1)
        priority = files
        logs.append(f"[merge] content/: {len(files)} files")
    else:
        logs.append("[merge] content/ missing")
    if SRC2.exists():
        files2 = list_md_files(SRC2)
        logs.append(f"[merge] site/content/: {len(files2)} files (as fallback)")
        # Include only those not present in content/
        if priority:
            pset = {str(p.relative_to(SRC1)) for p in priority}
            files2 = [p for p in files2 if str(p.relative_to(SRC2)) not in pset]
        wanted = priority + files2
    else:
        logs.append("[merge] site/content/ missing (will create)")
        wanted = priority
    return wanted, logs

def build_tree(paths: list[Path], base: Path) -> list[dict]:
    # Build hierarchy from a list of absolute paths
    tree = {}
    for p in paths:
        rel = p.relative_to(base).as_posix()
        parts = rel.split("/")
        cur = tree
        for part in parts[:-1]:
            cur = cur.setdefault(part, {})
        cur[parts[-1]] = None
    def to_nodes(d: dict, prefix: str) -> list[dict]:
        dirs = []
        files = []
        for name, sub in sorted(d.items(), key=lambda kv: kv[0]):
            if sub is None:
                files.append({"type":"file","name":name,"title":strip_order_prefix(name),"path": (prefix+name)})
            else:
                dirs.append({"type":"dir","name":name,"children": to_nodes(sub, prefix+name+"/")})
        return dirs + files
    return to_nodes(tree, "")

def strip_order_prefix(s: str) -> str:
    return re.sub(r"^\d+[-_. ]+", "", s)

def tokenize(text: str) -> list[str]:
    text = re.sub(r"[^\w\u4e00-\u9fff]+", " ", text)
    return [t for t in text.split() if len(t) > 1]

def build_index(docs: list[dict]) -> None:
    inverted: dict[str, dict[int,int]] = defaultdict(lambda: defaultdict(int))
    for i, d in enumerate(docs):
        try:
            text = (ROOT / "site" / d["path"]).read_text("utf-8", errors="ignore")
        except Exception:
            continue
        text = re.sub(r"#+\s*", " ", text)
        text = re.sub(r"\*{1,2}", " ", text)
        for t in tokenize(text):
            inverted[t][i] += 1
    postings = {t: [[di, int(tf)] for di, tf in inv.items()] for t, inv in inverted.items()}
    IDX.mkdir(parents=True, exist_ok=True)
    (IDX / "shard_all.json").write_text(json.dumps({"postings": postings}, ensure_ascii=False), "utf-8")
    (IDX / "route.json").write_text(json.dumps({"mode": "single", "files": ["shard_all.json"]}, ensure_ascii=False), "utf-8")

def main() -> int:
    IDX.mkdir(parents=True, exist_ok=True)
    DST.mkdir(parents=True, exist_ok=True)
    wanted, logs = merge_sources()
    for line in logs: print(line)

    # copy to DST (site/content)
    copied = 0
    for src in wanted:
        rel = (src.parent.name + "/" + src.name) if src.is_file() and src.parent!=src.parents[1] else src.relative_to(src.parents[1]).as_posix()
        # robust rel within source root
        try:
            rel = src.relative_to(SRC1).as_posix()
        except Exception:
            rel = src.relative_to(SRC2).as_posix()
        if copy_if_different(src, DST / rel):
            copied += 1
    print(f"[merge] copied/updated: {copied}")

    # scan site/content as ground truth for index
    files = list_md_files(DST)
    docs = []
    for p in files:
        rel = p.relative_to(DST).as_posix()
        full = p.read_text("utf-8", errors="ignore")
        title = md_title(full) or strip_order_prefix(p.name)
        docs.append({"id": len(docs), "path": "content/" + rel, "title": title})
    (IDX / "docs.json").write_text(json.dumps({"docs": docs}, ensure_ascii=False, indent=2), "utf-8")

    # hierarchical tree
    tree = build_tree(files, DST)
    (IDX / "tree.json").write_text(json.dumps(tree, ensure_ascii=False, indent=2), "utf-8")

    build_index(docs)
    print(f"[done] docs: {len(docs)} -> site/index/docs.json, tree.json, shard_all.json, route.json")
    return 0

if __name__ == "__main__":
    sys.exit(main())
