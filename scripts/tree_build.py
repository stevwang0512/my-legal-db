# scripts/tree_build.py — build /index & /site/index : tree.json + docs.json
from pathlib import Path
import json, re, sys
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
SRC  = ROOT / "content"

# ---------- 读取正文标题（保留旧功能） ----------
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

# ---------- 构建树 & 扁平 docs ----------
def build_tree_and_docs(src: Path):
    level2 = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    flat_docs = []

    for p in src.rglob("*.md"):
        parts = p.relative_to(src).parts

        # docs.json 需要的扁平项
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

        # 三层树的分桶（兼容 L3 直接放 md 或 L4 再放 md）
        if len(parts) == 3:
            L2, L3, _ = parts
            level2[L2][L3]["__files__"].append(p)
        elif len(parts) >= 4:
            L2, L3, L4 = parts[0], parts[1], parts[2]
            level2[L2][L3][L4].append(p)
        else:
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

            # L4 目录
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

    # docs.json 排序
    flat_docs.sort(key=lambda d: order_key(Path(d["path"]).name))
    return tree, flat_docs

def main():
    if not SRC.exists():
        print("[error] content/ not found:", SRC); sys.exit(1)

    tree, docs = build_tree_and_docs(SRC)

    # ← 双写到 /index 与 /site/index
    out_roots = [ROOT / "index", ROOT / "site" / "index"]
    for out_dir in out_roots:
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "tree.json").write_text(json.dumps(tree, ensure_ascii=False, indent=2), "utf-8")
            (out_dir / "docs.json").write_text(json.dumps(docs, ensure_ascii=False, indent=2), "utf-8")
            print("[ok] write:", out_dir)
        except Exception as e:
            print("[skip]", out_dir, e)

if __name__ == "__main__":
    main()
