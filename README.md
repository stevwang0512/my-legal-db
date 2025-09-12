# My Legal DB — Starter

这是一个“纯静态 + 预构建索引”的最小可用骨架：

- `content/` 放置你的法条 Markdown（或 txt）。建议 Markdown，并在文首加 YAML 前言（id/title 等）。
- `scripts/build_index.py` 在构建时读取 `content/`，切分为“条”，进行简易分词，生成倒排索引到 `index/`（JSON 分片）。
- `site/` 前端站点（GitHub Pages 部署）。搜索时按需拉取分片，点击结果时再拉原始 Markdown 渲染。
- `.github/workflows/build.yml`：push 时自动运行索引构建，并部署 `site/` 到 GitHub Pages。

## 本地无需运行，直接上传到 GitHub，启用 Pages 即可。
