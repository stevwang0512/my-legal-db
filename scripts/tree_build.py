# scripts/tree_build.py
from pathlib import Path
import json, re, sys

ROOT = Path(__file__).resolve().parents[1]
SRC  = ROOT / "content"
OUT  = ROOT / "site" / "index" / "tree.json"

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

def build_tree_safe(src: Path):
  """
  Allow:
    A) content/<L2>/<L3>/<file.md>         (3rd level file)
    B) content/<L2>/<L3>/<L4>/<file.md>    (4th level file)
  Render as L2 -> L3 -> L4(or "（该级文件）") -> file
  """
  from collections import defaultdict
  level2 = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
  for p in src.rglob("*.md"):
    parts = p.relative_to(src).parts
    if len(parts) == 3:
      L2, L3, _ = parts
      level2[L2][L3]["__files__"].append(p)
    elif len(parts) >= 4:
      L2, L3, L4 = parts[0], parts[1], parts[2]
      level2[L2][L3][L4].append(p)
    else:
      print(f"[warn] skip shallow md: {p}")
      continue

  tree = []
  for name2 in sorted(level2.keys()):
    n2 = {"name": name2, "type": "dir", "children": []}
    for name3 in sorted(level2[name2].keys()):
      n3 = {"name": name3, "type": "dir", "children": []}
      bucket = level2[name2][name3]

      files_lvl3 = bucket.get("__files__", [])
      if files_lvl3:
        group = {"name": "（该级文件）", "type": "dir", "children": []}
        for f in sorted(files_lvl3, key=lambda x: x.name):
          rel = f.relative_to(src).as_posix()
          raw = read_text(f)
          title = first_heading_title(strip_front_matter(raw), f.name)
          group["children"].append({
            "name": f.name, "type": "file", "path": rel, "title": title
          })
        n3["children"].append(group)

      for name4 in sorted(k for k in bucket.keys() if k != "__files__"):
        files = bucket[name4]
        if not files: 
          continue
        n4 = {"name": name4, "type": "dir", "children": []}
        for f in sorted(files, key=lambda x: x.name):
          rel = f.relative_to(src).as_posix()
          raw = read_text(f)
          title = first_heading_title(strip_front_matter(raw), f.name)
          n4["children"].append({
            "name": f.name, "type": "file", "path": rel, "title": title
          })
        n3["children"].append(n4)

      n2["children"].append(n3)
    tree.append(n2)
  return tree

def main():
  if not SRC.exists():
    print(f"[error] content dir not found: {SRC}")
    sys.exit(1)
  tree = build_tree_safe(SRC)
  OUT.parent.mkdir(parents=True, exist_ok=True)
  OUT.write_text(json.dumps(tree, ensure_ascii=False, indent=2), "utf-8")
  print(f"[ok] tree.json written -> {OUT}")

if __name__ == "__main__":
  main()
