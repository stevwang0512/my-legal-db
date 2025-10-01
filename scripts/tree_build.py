# scripts/tree_build.py — build site/index/tree.json & site/index/docs.json
from pathlib import Path
import json, re, sys

ROOT = Path(__file__).resolve().parents[1]
SRC  = ROOT / "content"
OUT_DIR = ROOT / "index"          # ← 从 ROOT/"site"/"index" 改到 ROOT/"index"
TREE_OUT = OUT_DIR / "tree.json"
DOCS_OUT = OUT_DIR / "docs.json"

# ---------- 读取正文标题（保留你旧功能） ----------
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

# ---------- 排序 + 剥前缀（目录与 md 统一） ----------
ORDER_RE = re.compile(r"^(?P<num>\d+)[\s._-]+")

def strip_prefix(name: str) -> str:
    m = ORDER_RE.match(name)
    return name[m.end():] if m else name

def order_key(name: str):
    m = ORDER_RE.match(name)
    if m:
        return (0, int(m.group("num")), strip_prefix(name).lower())
    return (1, name.lower())

# ---------- 构建三层树（保留你原先“L3 可放 md / L4 也可放 md”的容忍） ----------
def build_tree_and_docs(src: Path):
    from collections import defaultdict
    level2 = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    flat_docs = []  # 用于 docs.json

    for p in src.rglob("*.md"):
        parts = p.relative_to(src).parts
        # 记录到 flat 列表（docs.json）
        rel = p.relative_to(src).as_posix()
        raw = read_text(p)
        title = first_heading_title(strip_front_matter(raw), p.stem)
        flat_docs.append({
            "type": "file",
            "name": p.name,
            "display": strip_prefix(p.stem),
            "path": f"content/{rel}",
            "title": title
        })

        # 分桶到三层树
        if len(parts) == 3:
            L2, L3, _ = parts
            level2[L2][L3]["__files__"].append(p)
        elif len(parts) >= 4:
            L2, L3, L4 = parts[0], parts[1], parts[2]
            level2[L2][L3][L4].append(p)
        else:
            # 太浅的结构不参与树，但 flat_docs 仍然有记录
            continue

    tree = []
    for name2 in sorted(level2.keys(), key=order_key):
        n2 = {"type":"dir","name":name2,"display":strip_prefix(name2),"children":[]}
        for name3 in sorted(level2[name2].keys(), key=order_key):
            bucket = level2[name2][name3]
            n3 = {"type":"dir","name":name3,"display":strip_prefix(name3),"children":[]}

            files_lvl3 = bucket.get("__files__", [])
            if files_lvl3:
                for f in sorted(files_lvl3, key=lambda x: order_key(x.name)):
                    rel = f.relative_to(src).as_posix()
                    raw = read_text(f)
                    title = first_heading_title(strip_front_matter(raw), f.stem)
                    n3["children"].append({
                        "type":"file",
                        "name": f.name,
                        "display": strip_prefix(f.stem),
                        "path": f"content/{rel}",
                        "title": title
                    })

            for name4 in sorted((k for k in bucket.keys() if k != "__files__"), key=order_key):
                files = bucket[name4]
                if not files: continue
                n4 = {"type":"dir","name":name4,"display":strip_prefix(name4),"children":[]}
                for f in sorted(files, key=lambda x: order_key(x.name)):
                    rel = f.relative_to(src).as_posix()
                    raw = read_text(f)
                    title = first_heading_title(strip_front_matter(raw), f.stem)
                    n4["children"].append({
                        "type":"file",
                        "name": f.name,
                        "display": strip_prefix(f.stem),
                        "path": f"content/{rel}",
                        "title": title
                    })
                n3["children"].append(n4)

            n2["children"].append(n3)
        tree.append(n2)

    # docs.json 也按前缀排序，便于“全部文档”视图
    flat_docs.sort(key=lambda d: order_key(Path(d["path"]).name))
    return tree, flat_docs

def main():
    if not SRC.exists():
        print("[error] content/ not found:", SRC); sys.exit(1)

    tree, docs = build_tree_and_docs(SRC)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    TREE_OUT.write_text(json.dumps(tree, ensure_ascii=False, indent=2), "utf-8")
    DOCS_OUT.write_text(json.dumps(docs, ensure_ascii=False, indent=2), "utf-8")
    print("[ok] write:", TREE_OUT)
    print("[ok] write:", DOCS_OUT)

if __name__ == "__main__":
    main()
