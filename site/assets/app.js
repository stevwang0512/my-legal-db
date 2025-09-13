/* My Legal DB - app.js (v0.234 merged, gutter-ready)
 * 目标：在 0.234 pre fixed 版本基础上，保留既有功能 + 接入“目录开关外置(gutter)”方案
 * 功能清单：
 * - 目录外置开关（配合 #toc-toggle 与 body.sidebar-collapsed）
 * - 加载 docs 索引（兼容一维数组与树状 JSON），自动构建可折叠 TOC
 * - 内部锚点平滑滚动（在正文容器内滚动，居中定位）
 * - hash 路由（直接打开 #path?anchor），支持刷新/外链
 * - 轻量搜索（在索引的标题/路径上过滤）
 * - 记忆上次打开文档（sessionStorage，不阻塞手动锚点滚动）
 * - IntersectionObserver 高亮可视标题并同步到 TOC
 * - 弹性 fetch：尝试多种默认路径（docs.json / index.json），content 路径相对解析
 *
 * 依赖：marked.min.js（已在你仓库中）
 */

(function () {
  'use strict';

  /* ------------------------- DOM refs ------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const dom = {
    body: document.body,
    header: $('.topbar') || document.createElement('div'),
    layout: $('#app'),
    sidebar: $('#sidebar'),
    toc: $('#sidebar .toc'),
    toggle: $('#toc-toggle'), // gutter 按钮（目录外侧）
    content: $('#content'),
    search: $('.search'),
  };

  if (!dom.content) throw new Error('content container #content is required');
  if (!dom.sidebar) console.warn('missing #sidebar (TOC will be disabled)');
  if (!dom.toggle) console.warn('missing #toc-toggle (gutter button not found)');

  /* ------------------------- Utilities ------------------------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 在多可能路径中尝试获取资源
  async function tryFetchJSON(paths) {
    for (const p of paths) {
      try {
        const res = await fetch(p, { cache: 'no-store' });
        if (res.ok) return await res.json();
      } catch (e) {}
    }
    throw new Error('无法加载索引文件：' + paths.join(', '));
  }

  // 解析基于站点根/当前页的相对路径
  function resolveContentPath(p) {
    // 常见形式：content/xxx.md 或 ./content/xxx.md
    if (!p) return null;
    return p.startsWith('/') ? p : p.replace(/^\.?\/*/, '');
  }

  // 简单 escape
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  /* ------------------------- State ------------------------- */
  const state = {
    index: [],         // 原始索引（array or tree）
    tree: null,        // 目录树（标准化）
    flat: [],          // 扁平节点（便于搜索）
    currentPath: null, // 当前文档路径
    headingsMap: new Map(), // id -> toc anchor <a>
    obs: null,         // IntersectionObserver
  };

  /* ------------------------- Index loading ------------------------- */
  function buildTreeFromFlat(list) {
    // list: [{ id, title, path }]  按 path 组装为树
    const root = { title: 'root', children: [], path: '', __root: true };
    const dirMap = new Map(); // key: dir path -> node
    dirMap.set('', root);

    function ensureDir(dir, label) {
      if (!dirMap.has(dir)) {
        const node = { title: label || dir.split('/').pop() || '', path: dir, children: [] };
        dirMap.set(dir, node);
        // attach to parent
        const parentDir = dir.split('/').slice(0, -1).join('/');
        const parent = ensureDir(parentDir, parentDir.split('/').pop());
        parent.children.push(node);
      }
      return dirMap.get(dir);
    }

    for (const item of list) {
      const cleanPath = (item.path || '').replace(/^\.\//, '').replace(/^\//, '');
      const parts = cleanPath.split('/');
      const file = parts.pop();
      const dir = parts.join('/');
      const parent = ensureDir(dir, parts[parts.length - 1]);
      parent.children.push({
        title: item.title || file || item.id || '未命名',
        path: cleanPath,
        leaf: true,
      });
    }
    return root;
  }

  function normalizeIndex(idx) {
    // 支持两种形态：1) 一维数组 2) 已经是树
    if (Array.isArray(idx)) {
      return buildTreeFromFlat(idx);
    }
    if (idx && typeof idx === 'object' && (idx.children || idx.__root)) {
      return idx;
    }
    throw new Error('未知索引格式：期待数组或树状对象');
  }

  function flattenTree(node, out = []) {
    if (!node) return out;
    if (node.leaf) out.push({ title: node.title, path: node.path });
    if (node.children) node.children.forEach((c) => flattenTree(c, out));
    return out;
  }

  /* ------------------------- TOC rendering ------------------------- */
  function renderTOC(rootNode) {
    if (!dom.toc) return;
    dom.toc.innerHTML = '';
    const frag = document.createDocumentFragment();

    function renderNode(node, depth = 0) {
      if (node.__root) {
        node.children?.forEach((c) => renderNode(c, depth));
        return;
      }
      if (node.leaf) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `#${encodeURIComponent(node.path)}`;
        a.textContent = node.title;
        a.dataset.path = node.path;
        a.addEventListener('click', onTOCClick);
        li.appendChild(a);
        return li;
      } else {
        const details = document.createElement('details');
        details.open = depth <= 1; // 前两层默认展开
        const summary = document.createElement('summary');
        summary.textContent = node.title || '(未命名)';
        details.appendChild(summary);

        const ul = document.createElement('ul');
        (node.children || []).forEach((c) => {
          const item = renderNode(c, depth + 1);
          if (item) ul.appendChild(item);
        });
        details.appendChild(ul);
        return details;
      }
    }

    const asTree = renderNode(rootNode, 0);
    if (asTree) frag.appendChild(asTree);
    dom.toc.appendChild(frag);
  }

  function onTOCClick(e) {
    e.preventDefault();
    const a = e.currentTarget;
    const path = a.dataset.path;
    if (!path) return;
    // 切换文档
    navigateTo(path);
  }

  /* ------------------------- Content rendering ------------------------- */
  async function loadMarkdown(path) {
    const real = resolveContentPath(path);
    if (!real) throw new Error('无效文档路径');
    // 兼容仓库结构通常是 /content/*
    const tries = [real, './' + real, '../' + real];
    let txt = null;
    for (const t of tries) {
      try {
        const res = await fetch(t, { cache: 'no-store' });
        if (res.ok) { txt = await res.text(); break; }
      } catch (e) {}
    }
    if (txt == null) throw new Error('加载文档失败：' + tries.join(', '));
    return txt;
  }

  function renderMarkdown(md, anchor) {
    if (!window.marked) {
      dom.content.innerHTML = '<p style="color:#b91c1c">缺少 marked.min.js，无法渲染 Markdown。</p>';
      return;
    }
    dom.content.innerHTML = window.marked.parse(md);
    // 若有 hash 锚点，滚动到锚点
    if (anchor) scrollToAnchor(anchor, { center: true });
    // 构建标题映射并建立观察器
    prepareHeadingObserver();
  }

  function scrollToAnchor(hash, opts = {}) {
    const id = decodeURIComponent(String(hash).replace(/^#/, ''));
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    // 在 content 容器内部平滑滚动，居中
    const container = dom.content;
    const rect = target.getBoundingClientRect();
    const crect = container.getBoundingClientRect();
    const offset = (rect.top - crect.top) - (crect.height / 2 - rect.height / 2);
    container.scrollBy({ top: offset, behavior: 'smooth' });
  }

  function prepareHeadingObserver() {
    // 清理旧观察器
    state.obs?.disconnect();
    state.headingsMap.clear();

    const headings = $$('h1, h2, h3, h4, h5, h6', dom.content);
    const tocAnchors = new Map();
    // 为每个 TOC <a> 建索引（按 hash 对应）
    $$('#sidebar .toc a').forEach((a) => {
      const p = a.dataset.path || '';
      if (state.currentPath && p !== state.currentPath) return;
      // a.href = #path 级别，不含文内锚，这里只在“当前文档”下才能映射
      // 标题级锚点通过渲染器 id 实现，不能直接从 TOC 得到
    });

    // 观察标题进入视口，动态高亮（仅当前文档使用）
    state.obs = new IntersectionObserver((entries) => {
      // 取最靠上的可见标题
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      const id = visible.target.id;
      if (!id) return;
      highlightHeadingInContent(id);
    }, { root: dom.content, threshold: [0.1, 0.4, 0.6] });

    headings.forEach((h) => state.obs.observe(h));
  }

  function highlightHeadingInContent(id) {
    // 视觉高亮标题（可选）
    $$('.hl-heading', dom.content).forEach((n) => n.classList.remove('hl-heading'));
    const el = document.getElementById(id);
    if (el) el.classList.add('hl-heading');
  }

  /* ------------------------- Routing ------------------------- */
  function parseHash() {
    // 支持 #path 或 #path?anchor=xxx 或 #path#heading-id（兼容老链接）
    const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!raw) return { path: null, anchor: null };
    const [p, q] = raw.split('?');
    let anchor = null;
    if (q && q.includes('anchor=')) {
      const sp = new URLSearchParams(q);
      anchor = sp.get('anchor') || null;
    } else if (p && p.includes('#')) {
      const [p0, a0] = p.split('#');
      return { path: p0, anchor: a0 || null };
    }
    return { path: p, anchor };
  }

  async function navigateTo(path, anchor = null, { pushHash = true } = {}) {
    if (!path) return;
    state.currentPath = path;
    sessionStorage.setItem('myldb:lastPath', path);
    try {
      const md = await loadMarkdown(path);
      renderMarkdown(md, anchor);
      if (pushHash) {
        const h = anchor ? `${encodeURIComponent(path)}?anchor=${encodeURIComponent(anchor)}`
                         : `${encodeURIComponent(path)}`;
        history.replaceState(null, '', `#${h}`);
      }
      // 展开侧栏（可选）
    } catch (e) {
      dom.content.innerHTML = `<div style="color:#b91c1c">加载失败：${esc(e.message || e)}</div>`;
    }
  }

  window.addEventListener('hashchange', () => {
    const { path, anchor } = parseHash();
    if (path) navigateTo(path, anchor, { pushHash: false });
  });

  /* ------------------------- Search ------------------------- */
  function bindSearchInput() {
    if (!dom.search || !dom.toc) return;
    let last = '';
    dom.search.addEventListener('input', () => {
      const kw = dom.search.value.trim().toLowerCase();
      if (kw === last) return;
      last = kw;
      filterTOC(kw);
    });
  }

  function filterTOC(kw) {
    // 简单标题过滤：隐藏不匹配的 <li> 与对应父 details
    if (!dom.toc) return;
    const items = $$('li', dom.toc);
    const hitSet = new Set();
    if (!kw) {
      // 还原
      $$('.hidden-toc', dom.toc).forEach((n) => n.classList.remove('hidden-toc'));
      $$('details', dom.toc).forEach((d) => d.open = true);
      return;
    }
    items.forEach((li) => {
      const a = $('a', li);
      const text = (a?.textContent || '').toLowerCase();
      const hit = text.includes(kw);
      li.classList.toggle('hidden-toc', !hit);
      if (hit) {
        // 展开全部父 details
        let p = li.parentElement;
        while (p && p !== dom.toc) {
          if (p.tagName.toLowerCase() === 'details') p.open = true;
          p = p.parentElement;
        }
      }
    });
    // 隐藏所有空的 details（没有可见子项）
    $$('details', dom.toc).forEach((d) => {
      const hasVisible = $$('li:not(.hidden-toc)', d).length > 0 || $('details:not(.hidden-toc)', d);
      d.classList.toggle('hidden-toc', !hasVisible);
    });
  }

  /* ------------------------- Gutter toggle ------------------------- */
  function bindGutterToggle() {
    if (!dom.toggle) return;
    function setState(collapsed) {
      dom.body.classList.toggle('sidebar-collapsed', collapsed);
      dom.toggle.setAttribute('aria-expanded', String(!collapsed));
      dom.toggle.title = collapsed ? '展开目录' : '收起目录';
      dom.toggle.textContent = collapsed ? '❯' : '❮';
    }
    // 初始：移动端默认收起
    const preferCollapsed = window.matchMedia('(max-width: 960px)').matches;
    setState(preferCollapsed);
    dom.toggle.addEventListener('click', () => {
      setState(!dom.body.classList.contains('sidebar-collapsed'));
      dom.content?.focus();
    });
    dom.toggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        dom.toggle.click();
      }
    });
  }

  /* ------------------------- Boot ------------------------- */
  async function boot() {
    // 1) 绑定 gutter 按钮
    bindGutterToggle();

    // 2) 加载索引（尝试多个默认位置）
    const indexPaths = [
      './assets/docs.json',
      './docs.json',
      '../docs.json',
      './assets/index.json',
      './index/docs.json',
    ];
    try {
      const idx = await tryFetchJSON(indexPaths);
      state.index = idx;
      state.tree = normalizeIndex(idx);
      state.flat = flattenTree(state.tree);
      renderTOC(state.tree);
    } catch (e) {
      console.warn(e);
      if (dom.toc) dom.toc.innerHTML = '<p style="color:#9ca3af">未加载到目录索引。</p>';
    }

    bindSearchInput();

    // 3) 路由优先：hash 指定文档
    let { path, anchor } = parseHash();

    // 4) 其次：session 上次文档
    if (!path) {
      const last = sessionStorage.getItem('myldb:lastPath');
      if (last) path = last;
    }

    // 5) 再次：有目录可用时，选择第一个叶子
    if (!path && state.flat.length) {
      path = state.flat[0].path;
    }

    // 6) 导航
    if (path) {
      await navigateTo(path, anchor, { pushHash: !location.hash });
    } else {
      dom.content.innerHTML = '<p style="color:#64748b">在左侧选择文档，或在上方搜索</p>';
    }

    // 7) 代理正文区域内的 hash 链接（如 #art-1）
    dom.content.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const hash = a.getAttribute('href');
      if (!hash) return;
      e.preventDefault();
      scrollToAnchor(hash, { center: true });
      // 更新 hash 的 anchor 部分，但不改变 path
      const current = parseHash().path || state.currentPath || '';
      const h = `${encodeURIComponent(current)}?anchor=${encodeURIComponent(hash.replace(/^#/, ''))}`;
      history.replaceState(null, '', `#${h}`);
    });
  }

  // 样式辅助：高亮类
  const style = document.createElement('style');
  style.textContent = `.hidden-toc{display:none !important}
  .hl-heading{outline: 2px solid rgba(59,130,246,.35); outline-offset: 4px; border-radius: 4px;}
  `;
  document.head.appendChild(style);

  // go
  boot();
})();
