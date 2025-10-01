# scripts/tree_build.py — build site/index/tree.json from content/
from pathlib import Path
import json, re, sys

ROOT = Path(__file__).resolve().parents[1]
SRC  = ROOT / "content"
OUT  = ROOT / "site" / "index" / "tree.json"

# -------- 兼容你现有功能：读取正文标题 --------
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

# -------- 新增：统一“排序 + 剥前缀”能力（目录与 md 文件都适用） --------
ORDER_RE = re.compile(r"^(?P<num>\d+)[\s._-]+")  # 01_ / 01- / 01. / 01 空格 都可

def strip_prefix(name: str) -> str:
    """去掉用于排序的数字前缀（不动真实文件名，仅用于 display）"""
    m = ORDER_RE.match(name)
    return name[m.end():] if m else name

def order_key(name: str):
    """
    排序键：
    - 有数字前缀的：按数字升序，再按剥前缀后的不区分大小写名。
    - 无数字前缀的：排在后面，按名称字母序。
    """
    m = ORDER_RE.match(name)
    if m:
        return (0, int(m.group("num")), strip_prefix(name).lower())
    return (1, name.lower())

# -------- 保留你原来的分桶与树形结构，但在“添加 children / 文件”处引入排序与 display --------
def build_tree_safe(src: Path):
    """
    允许：
    - L2/L3/L4 目录；
    - .md 既可以直接在 L3 下，也可以在 L4 下。
    产出三层树给前端。
    """
    from collections import defaultdict
    level2 = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))

    # 扫描所有 md
    for p in src.rglob('*.md'):
        parts = p.relative_to(src).parts
        if len(parts) == 3:
            L2, L3, _ = parts
            level2[L2][L3]['__files__'].append(p)
        elif len(parts) >= 4:
            L2, L3, L4 = parts[0], parts[1], parts[2]
            level2[L2][L3][L4].append(p)
        else:
            print('[warn] skip shallow md:', p)
            continue

    tree = []

    # L2 目录（带排序 + display）
    for name2 in sorted(level2.keys(), key=order_key):
        n2 = {
            'name': name2,
            'display': strip_prefix(name2),   # ★ 新增：前端优先用 display
            'type': 'dir',
            'children': []
        }

        # L3 目录（带排序 + display）
        for name3 in sorted(level2[name2].keys(), key=order_key):
            n3 = {
                'name': name3,
                'display': strip_prefix(name3),
                'type': 'dir',
                'children': []
            }
            bucket = level2[name2][name3]

            # L3 直挂文件（按文件名前缀排序；display 去前缀）
            files_lvl3 = bucket.get('__files__', [])
            if files_lvl3:
                for f in sorted(files_lvl3, key=lambda x: order_key(x.name)):
                    rel   = f.relative_to(src).as_posix()
                    raw   = read_text(f)
                    title = first_heading_title(strip_front_matter(raw), f.name)
                    n3['children'].append({
                        'name': f.name,                          # 原始文件名（保留）
                        'display': strip_prefix(f.stem),         # ★ 新增：用于展示（去前缀、去 .md）
                        'type': 'file',
                        'path': 'content/' + rel,                # 前端 a.href = "#doc=" + 这个路径
                        'title': title                           # 保留旧功能：首标题
                    })

            # L4 目录（带排序 + display），其下再放文件
            for name4 in sorted((k for k in bucket.keys() if k != '__files__'), key=order_key):
                files = bucket[name4]
                if not files:
                    continue
                n4 = {
                    'name': name4,
                    'display': strip_prefix(name4),
                    'type': 'dir',
                    'children': []
                }
                for f in sorted(files, key=lambda x: order_key(x.name)):
                    rel   = f.relative_to(src).as_posix()
                    raw   = read_text(f)
                    title = first_heading_title(strip_front_matter(raw), f.name)
                    n4['children'].append({
                        'name': f.name,
                        'display': strip_prefix(f.stem),         # ★ 新增
                        'type': 'file',
                        'path': 'content/' + rel,
                        'title': title
                    })
                n3['children'].append(n4)

            n2['children'].append(n3)

        tree.append(n2)
    return tree

def main():
    if not SRC.exists():
        print('[error] content dir not found:', SRC)
        sys.exit(1)
    tree = build_tree_safe(SRC)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(tree, ensure_ascii=False, indent=2), 'utf-8')
    print('[ok] tree.json written ->', OUT)

if __name__ == '__main__':
    main()
