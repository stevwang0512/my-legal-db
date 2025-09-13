# My Legal DB — Long-term Structure Patch

## 目录结构（长期）
```
content/                # 源：所有 Markdown（可多级目录）
scripts/                # 构建：build_site.py（复制 + 清单 + 索引）
site/                   # 产物：用于部署（assets、index、content 副本）
  ├─ assets/            # JS/CSS（包含 app.js、marked.min.js）
  ├─ content/           # 构建时自动同步生成
  └─ index/             # docs.json / shard_all.json / route.json
.github/workflows/      # GitHub Actions（自动构建 & 部署到 gh-pages）
```

## 使用
### 本地构建 + 手动部署（保持 Pages 发布 site/ 目录）
1. 将 Markdown 放在仓库根 `content/`
2. 运行：`python scripts/build_site.py`
3. 提交：`git add site scripts && git commit -m "build: sync content & index"`
4. 推送：`git push`

### 自动部署（推荐，发布到 gh-pages 分支）
1. 将本仓库的 Pages 设置为 **部署 gh-pages 分支**
2. 直接向 main 推送，GitHub Actions 会自动：构建 → 发布到 gh-pages

## 前端
- `site/assets/app.js` 已修复侧栏折叠脚本（单一来源、状态持久化）
- 文档清单：`site/index/docs.json`
- 索引路由：`site/index/route.json`
- 全量倒排索引：`site/index/shard_all.json`（后续可改为分片）
- 加载文档：`fetch('content/{path}.md')`（来自构建期同步的 `site/content/`）
