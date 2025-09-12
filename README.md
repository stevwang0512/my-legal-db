# My Legal DB — Starter (Fixed)
修复：部署后左侧“文档”为空的问题。现在构建时会：
- 复制 `content/` 到 `site/content/`，
- 生成 `site/index/manifest.json`、`site/index/route.json`、`site/index/shard_00.json`，
- Pages 仅发布 `site/`，前端即可加载到索引与内容。