My Legal DB - v0.234 目录开关安装包（正式版）

变更要点
- 把目录开关按钮从 <aside> 中移出，放到“目录栏与正文栏之间”的中缝（gutter）列。
- 目录收起时仅将第一列宽度设为 0；中缝按钮仍可见并可点击。
- 使用 CSS Grid 实现三列布局：侧栏 | 中缝按钮 | 正文。
- 按钮采用 position: sticky，随页面滚动始终可达；亦可改为 position: fixed 达到“悬浮”效果。

文件清单
- index.html   页面结构（含开关按钮在中缝）
- styles.css   布局与样式
- app.js       目录开关逻辑（独立于侧栏，不随隐藏）

集成步骤
1) 备份你线上版本的 index.html / styles / app.js。
2) 将本包三个文件替换到你的项目根目录（或按你项目结构合并）。
3) 若你已有全局样式/脚本，请把 styles.css 与 app.js 的相关片段合并到你的文件，注意避免重复选择器冲突。
4) 如需“完全悬浮”的按钮，把 styles.css 里的 .toc-toggle 改为：
   position: fixed; left: 4px; top: 64px; z-index: 1000;
5) 你当前的正文过宽影响阅读时，可调整 .content 的 max-width。

可配置变量（styles.css 的 :root）
--sidebar-width: 侧栏宽度
--gutter:        中缝宽度（按钮的列宽）
--header-offset: 顶部栏高度（用于 sticky 对齐）

无障碍（a11y）
- 使用 aria-controls / aria-expanded 同步状态；
- 支持 Enter/Space 键；
- 切换后自动聚焦正文容器，提升键盘与读屏体验。

如需我帮你把这些改动合并进你的现有仓库结构（保留原样式/脚本、自适配你的 DOM），告诉我文件路径即可。
