/* app.js — v0.30*/

// [v0.30 A1_state_model] — 单一状态 & 工具
const State = {
  // page TOC
  toc: { nodes: [], byId: new Map(), rootIds: [], container: null, bound: false },
  // file tree
  tree: { nodes: [], byId: new Map(), rootIds: [], container: null, bound: false }
};

// 小工具
function ancestorsExpanded(nodesById, id){
  let p = nodesById.get(id)?.parentId || null;
  while(p){
    const pn = nodesById.get(p);
    if(!pn || !pn.expanded) return false;
    p = pn.parentId;
  }
  return true;
}
function collapseDescendants(nodesById, id){
  const stack = [id];
  while(stack.length){
    const cur = stack.pop();
    const node = nodesById.get(cur);
    if(!node) continue;
    (node.children || []).forEach(cid=>{
      const cn = nodesById.get(cid);
      if(cn){ cn.expanded = false; stack.push(cid); }
    });
  }
}

function expandAncestors(nodesById, id){
  let p = nodesById.get(id)?.parentId || null;
  while(p){
    const pn = nodesById.get(p);
    if(!pn) break;
    pn.expanded = true;
    p = pn.parentId;
  }
}

let currentDocPath = null;
let currentHeadings = [];
let scrollSpy = null;
let searchHits = [];
let searchIndex = -1;

// 锁定（仅 pagetoc 使用）
let manualActiveId = null;
let lockScrollSpy  = false;

async function fetchJSON(url){
  const r = await fetch(url, { cache:'no-cache' });
  if(!r.ok) throw new Error('HTTP '+r.status+' '+url);
  return await r.json();
}
const qs  = (sel, root=document)=> root.querySelector(sel);
const qsa = (sel, root=document)=> Array.from(root.querySelectorAll(sel));

// [v0.35-isMobile] 统一的移动端判定
function isMobile(){ return window.matchMedia && window.matchMedia('(max-width: 768px)').matches; }

// [v0.35-setVH] 写入可视视口高度变量 --vh（解决底/右整条白块）
function setVH(){
  const vv = window.visualViewport;
  const h = vv && vv.height ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${h}px`);
}

const normalizeHash = ()=>{
  const h = location.hash || '';
  const m = h.match(/#doc=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

const resolveDocURL = (p)=> /^content\//.test(p) ? p : ('content/' + p);

// === [v0.33-Prefix-JS-1] 统一的显示名清洗函数：剥排序前缀（目录/子目录/文件全复用） ===
// 规则：清理开头的 1~4 位数字 + 常见分隔（.-_、空格、中文顿号/括号等），支持多段前缀连写。
// 例：`01-绪论.md` `002_总则` `03）第一章` `04) 第一节` `05 目录` -> 去掉数字前缀与分隔。
function displayName(raw) {
  if (!raw) return '';
  // 去掉扩展名（仅文件名时生效；目录名无影响）
  const noExt = raw.replace(/\.(md|markdown)$/i, '');
  // 连续剥多段排序前缀（最多剥两段，避免误杀正文里的编号）
  let s = noExt.replace(/^\s*\d{1,4}[\.\-_\s、）\)]\s*/u, '');
  s = s.replace(/^\s*\d{1,6}[\.\-_\s、）\)]\s*/u, '');
  return s.trim();
}

function setSidebarCollapsed(collapsed){
  const body = document.body;
  if(collapsed) body.classList.add('sb-collapsed');
  else body.classList.remove('sb-collapsed');
  const btn = qs('#toc-toggle');
  if(btn){
    // === [v0.33-SVG-JS-4] toc-toggle 用 aria-expanded 控制三角方向 ===
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    // 可选：同步无障碍提示
    btn.setAttribute('aria-label', collapsed ? '展开目录' : '收起目录');
    // 不再写 textContent；按钮内已有 <svg class="icon-triangle">
    btn.title = collapsed ? '展开目录' : '收起目录';
  }
}

let sidebarMode = 'filetree';
function setSidebarMode(mode){
  sidebarMode = mode;
  const ft = qs('#filetree'), pt = qs('#page-toc'), title = qs('#toc-title');
  const toggleAllBtn = qs('#toc-expand-all');

  if(mode==='filetree'){
    ft.style.display=''; pt.style.display='none'; title.textContent='法律法规库';

    // 切回文件树：解除锁定、高亮
    lockScrollSpy = false; manualActiveId = null; clearSectionHighlight();
    qsa('#page-toc a.locked').forEach(a => a.classList.remove('locked'));
    qsa('#page-toc a.active').forEach(a => a.classList.remove('active'));

    // 文件树默认全折叠
    toggleAllFiletree(false); // 会自动 sync 并更新按钮文案

  } else {
    ft.style.display='none'; pt.style.display=''; title.textContent='目录';

    // v0.30：默认逐级折叠（只显 H1），点击逐级展开
    // 新版 initializeProgressiveTOC() 已改为：默认态 + sync('toc')
    initializeProgressiveTOC();
    // 不再在这里写按钮文案或使用已删除的全局量（交给 sync()）
  }
}

// === [v0.32-B1-JS] 修正 breadcrumb 逻辑 ===
function renderBreadcrumb(path){
  const bc   = document.querySelector('#breadcrumb');
  if(!bc) return;
  const tips = document.querySelector('#search-tip');  // ✅ 修正选择器
  if (tips && bc.parentElement !== tips) tips.appendChild(bc);
  bc.style.display = 'none'; // 首屏即隐藏，避免多算高度
}

// 文件树渲染 & 全展/全收逻辑
function renderTree(nodes, container){
  return renderDirTree(nodes, container);
}

// 递归用唯一实现，避免再绕转接器
function renderDirTree(nodes, container){
  nodes.forEach(node=>{
    if(node.type==='dir'){
      const wrap   = document.createElement('div');  wrap.className = 'dir';
      const header = document.createElement('div');  header.className = 'header';
      // === [v0.33-SVG-JS-2a] 文件树：仅创建 caret 容器，SVG/可聚焦性统一交给 sync() 决定 ===
      const caret  = document.createElement('span');
      caret.className = 'caret';
      caret.setAttribute('data-state', 'collapsed');
      caret.setAttribute('aria-expanded', 'false');
      caret.style.width = '1em';
      caret.style.display = 'inline-block';
      // 不在这里插入 SVG，也不设置 role/tabindex；sync() 会按是否有子级统一处理
      
      const label  = document.createElement('span');
      label.textContent = (node.display || displayName(node.name));
      label.style.fontWeight = '600';
      const box    = document.createElement('div');  box.className='children'; // ← 不再写 style.display

      header.appendChild(caret); header.appendChild(label);
      wrap.appendChild(header);  wrap.appendChild(box);

      header.addEventListener('click', ()=>{
        // 统一事件在 bindTreeEventsOnce() 中处理，这里留空避免冲突
      });

      renderDirTree(node.children || [], box);
      container.appendChild(wrap);

    } else if(node.type==='file'){
      const a = document.createElement('a');
      a.className = 'file';
      const docPath  = node.path || '';
      a.textContent = (node.display || displayName(node.name));
      const hrefPath = /^content\//.test(docPath) ? docPath : ('content/' + docPath);
      a.href         = '#doc=' + encodeURIComponent(hrefPath);
      a.addEventListener('click', ()=>{ setSidebarMode('pagetoc'); });
      a.dataset.path = hrefPath;
      container.appendChild(a);
    }
  });

  // [A6_patch_renderDirTree] — 仅在最外层 container 完成后建模
  if(container && container.id === 'filetree'){
    State.tree = { nodes: [], byId: new Map(), rootIds: [], container, bound:false };

    let autoId = 1;
    const dirs = Array.from(qsa('#filetree .dir', container));
    const idMap = new Map();

    dirs.forEach(dir=>{
      const id = String(autoId++);
      idMap.set(dir, id);
    });

    dirs.forEach(dir=>{
      const id = idMap.get(dir);
      const parentDir = dir.parentElement?.closest('.dir');
      const parentId = parentDir ? idMap.get(parentDir) : null;
      const header = qs('.header', dir);
      const caret  = header && header.firstChild;

      const hasChildren = !!qs('.children', dir);
      const node = { id, parentId, level: 0, hasChildren, expanded:false, el: dir, children: [] };
      State.tree.nodes.push(node);
      State.tree.byId.set(id, node);
      if(parentId){
        const pn = State.tree.byId.get(parentId);
        pn && pn.children.push(id);
      }else{
        State.tree.rootIds.push(id);
      }
      dir.dataset.nodeId = id;
      if(caret) caret.classList.add('caret');
    });

    // 默认策略：根目录展开
    State.tree.rootIds.forEach(rid=>{
      const rn = State.tree.byId.get(rid);
      if(rn) rn.expanded = true;
    });

    bindTreeEventsOnce();
    sync('tree');
  }
}


async function mountFileTree(){
  const container = qs('#filetree'); container.innerHTML = '';
  try{
    const tree = await fetchJSON('index/tree.json?ts='+Date.now());
    if(Array.isArray(tree) && tree.length){
      renderTree(tree, container);
      // 初始全折叠
      toggleAllFiletree(false);
      return;
    }
    throw new Error('empty tree');
  }catch(e){
    console.warn('tree.json not available, try docs.json', e);
  }
  try{
    const docs = await fetchJSON('index/docs.json?ts='+Date.now());
    const nodes = (docs.docs||[]).map(d=>{
      const p = resolveDocURL(d.path || d.title || '');
      return {type:'file', name:d.title||p.split('/').pop(), title:d.title||p, path:p};
    });
    renderTree([{name:'全部文档', type:'dir', children:nodes}], container);
    toggleAllFiletree(false);
  }catch(e){
    container.innerHTML = '<div style="color:#b91c1c">目录加载失败（tree/docs 均不可用）。</div>';
  }
}

const slugify = (t)=> t.trim().replace(/\s+/g,'-')
  .replace(/[。.．、,，；;：:（）()\[\]《》<>\/？?!—\-]+/g,'-')
  .replace(/-+/g,'-').replace(/^-|-$/g,'');

// 正文段高亮（标题到下一标题前）
function clearSectionHighlight() {
  qsa('.section-highlight', qs('#viewer'))
    .forEach(el => el.classList.remove('section-highlight'));
}

function applyManualHighlight(id){
  // 先清掉旧高亮
  clearSectionHighlight();

  // v0.31 目录侧高亮：支持多匹配 + 整行高亮
  // 1) 先清掉目录里旧的 active/locked（含 a 与 .toc-line）
  qsa('#page-toc a.active, #page-toc a.locked').forEach(a=>{
    a.classList.remove('active','locked');
  });
  qsa('#page-toc .toc-line.active, #page-toc .toc-line.locked').forEach(row=>{
    row.classList.remove('active','locked');
  });

  // 2) 为所有匹配的链接及其所在行加高亮（新版本 id 已唯一；旧数据若仍有重复，这里也能全覆盖）
  const links = qsa(`#page-toc a[href="#${CSS.escape(id)}"]`);
  links.forEach(link=>{
    link.classList.add('active','locked');
    const row = link.closest('.toc-line');
    if(row) row.classList.add('active','locked');
  });

  // 找标题，并优先高亮其所在的 .md-section 容器（标题→下一标题的整段）
  const start = document.getElementById(id);
  if(!start) return;

  const sec = start.closest('.md-section');
  if(sec){
    sec.classList.add('section-highlight');
  }else{
    // 兜底：万一没包成功，用“从标题到下一标题前”的老逻辑
    start.classList.add('section-highlight');
    let el = start.nextElementSibling;
    while (el && !/^H[1-6]$/.test(el.tagName)) {
      el.classList.add('section-highlight');
      el = el.nextElementSibling;
    }
  }
}

// [v0.30 A2_model_build_toc] — 扫描 #page-toc .toc-row 构建树模型
function buildTocModelFromDOM(){
  const container = qs('#page-toc');
  State.toc = { nodes: [], byId: new Map(), rootIds: [], container, bound:false };

  const rows = Array.from(qsa('#page-toc .toc-row', container));
  const stack = []; // 存最近一级的节点 id 栈：[{id,level}]
  let autoId = 1;

  rows.forEach(row=>{
    const a = row.querySelector('a');
    const lvl = Number(a?.dataset.level || '1');
    const hasChildren = !!row.querySelector('.toc-fold') && !row.querySelector('.toc-fold').classList.contains('leaf');
    const id = String(autoId++);

    // 建立父链：回溯到 < lvl 的最近祖先
    while(stack.length && stack[stack.length-1].level >= lvl) stack.pop();
    const parentId = stack.length ? stack[stack.length-1].id : null;

    const node = { id, parentId, level: lvl, hasChildren, expanded: false, el: row, children: [] };
    State.toc.nodes.push(node);
    State.toc.byId.set(id, node);
    if(parentId){
      const parent = State.toc.byId.get(parentId);
      parent && parent.children.push(id);
    }else{
      State.toc.rootIds.push(id);
    }
    stack.push({ id, level:lvl });
  });
  // v0.30: 为每个节点计算“逻辑深度”（仅相对实际父级 +1）
  const computeDepth = (id, d) => {
    const node = State.toc.byId.get(id);
    if (!node) return;
    node.depth = d;
    (node.children || []).forEach(cid => computeDepth(cid, d + 1));
  };
  State.toc.rootIds.forEach(rid => computeDepth(rid, 0));
}

/* =========================
 * [v0.34-Renderer-API-1]
 * 统一渲染接口骨架：为后续从 flat(A′) → tree(C) 迁移留好“关节”
 * ========================= */

/** 安装/获取 Page TOC 容器 */
function mountTOC(container){
  State.toc.container = container || qs('#page-toc');
  return State.toc.container;
}

/** 卸载但保留容器引用（清空 DOM 与模型） */
function unmountTOC(){
  if (State.toc.container) State.toc.container.innerHTML = '';
  State.toc = { nodes: [], byId: new Map(), rootIds: [], container: State.toc.container, bound:false };
}

/** 统一渲染器入口：mode='flat' | 'tree'
 *  目前 flat 直接复用现有 buildPageTOC()
 *  将来 tree 模式在这里切换为“真实嵌套 DOM 渲染器”
 */
function renderTOC(mode='flat'){
  mountTOC(State.toc.container || qs('#page-toc'));
  if (mode === 'flat'){
    // 现阶段：走 A′（平铺 + .toc-indent）
    buildPageTOC();
  }else{
    // 预留：将来切 C 时替换为树渲染器
    // buildPageTOC_TreeMode();
    buildPageTOC(); // 占位：保持行为一致
  }
}

/** 统一拿到“行元素”的方式：滚动定位/高亮都走这个 API，降低对具体结构的耦合 */
function getLineElById(id){
  const n = State.toc.byId.get(String(id));
  return n?.el?.querySelector('.toc-line') || n?.el || null;
}

// [v.030 A3_sync_renderer] — 统一渲染
function sync(scope){
  const S = scope==='tree' ? State.tree : State.toc;
  if(!S.container) return;

  // 1) 可见性 + 箭头
  S.nodes.forEach(node=>{
    const shouldShow = !node.parentId 
     || (S.byId.get(node.parentId)?.expanded && ancestorsExpanded(S.byId, node.parentId));
    const isVisible  = shouldShow;
    if(node.el){
      node.el.hidden = !isVisible;

      // [v0.34-C2-CSS-fix-1] 缩进只作用于内容容器（解耦高亮与缩进）
      const indentEl = node.el.querySelector('.toc-indent') || node.el.querySelector('.toc-line');
      if (indentEl && typeof node.depth === 'number') {
        indentEl.style.paddingLeft = (node.depth * 2) + 'ch';
      }

      // File Tree：控制子容器显隐（隐藏时一并藏掉子目录和文件）
      if(scope==='tree'){
        const box = node.el.querySelector('.children');
        if(box) box.hidden = !node.expanded;
      }

      // === [v0.33-SVG-JS-3] caret 渲染：用 data-state / aria-expanded 驱动 SVG 旋转；按 hasChildren 插拔 SVG 与可聚焦性 ===
      const caret = node.el.querySelector('.toc-fold') || node.el.querySelector('.caret');
      if (caret) {
        const expanded = !!node.expanded;
        const hasChildren = !!node.hasChildren;

        // 统一写入状态属性（CSS 依据 data-state 旋转 chevron）
        caret.setAttribute('data-state', expanded ? 'expanded' : 'collapsed');
        caret.setAttribute('aria-expanded', expanded ? 'true' : 'false');

        if (hasChildren) {
          // 有子级：确保存在 chevron SVG；可见且可操作（保持命中在 span 上，SVG 不接收事件）
          if (!caret.querySelector('svg')) {
            caret.innerHTML = '<svg class="icon icon-chev" aria-hidden="true"><use href="#icon-chev"></use></svg>';
          }
          caret.classList.remove('leaf');
          caret.setAttribute('aria-hidden', 'false');
          caret.setAttribute('role', 'button');
          caret.setAttribute('tabindex', '0');
        } else {
          // 叶子：不显示图标，不可聚焦；仍保留固定宽度的命中占位（由 CSS/行内样式保证）
          caret.innerHTML = '';
          caret.classList.add('leaf');
          caret.setAttribute('aria-hidden', 'true');
          caret.removeAttribute('role');
          caret.setAttribute('tabindex', '-1');
        }
      }
    }
  });

  // 2) “展开/收起全部”按钮文案（你的页面 id：#toc-expand-all）
  const btn = qs('#toc-expand-all');
  if(btn){
    const allExpandable = S.nodes.filter(n=>n.hasChildren);
    const allOpen = allExpandable.length>0 && allExpandable.every(n=>n.expanded);
    btn.textContent = allOpen ? '收起全部' : '展开全部';
  }
}

// [v0.30 A4_event_handlers] — 事件委托 & 基本操作
// v0.30 fix: 始终保持 #page-toc 上只有一个 click 监听
let _onTocClick = null;
function bindTocEventsOnce(){
  if(!State.toc.container) return;

  // 若已有旧监听，先移除
  if(_onTocClick){
    try{ State.toc.container.removeEventListener('click', _onTocClick); }catch(_){}
  }

  _onTocClick = (ev)=>{
    const fold = ev.target.closest('.toc-fold');
    const link = ev.target.closest('a');
    if(fold){
      const row = fold.closest('.toc-row');
      const id  = row && row.dataset.nodeId;
      if(id && State.toc.byId.has(id)){
        const node = State.toc.byId.get(id);
        node.expanded = !node.expanded;
        // 折叠时递归关闭后代
        if(!node.expanded){
          (node.children||[]).forEach(function collapse(id2){
            const n2 = State.toc.byId.get(id2);
            if(n2){ n2.expanded = false; (n2.children||[]).forEach(collapse); }
          });
        }
        sync('toc');
      }
      return;
    }
    if(link){
      // 维持你原有“滚动 + 高亮锁定”的行为
      const href = link.getAttribute('href') || '';
      const id   = href.startsWith('#') ? href.slice(1) : href;
      const target = document.getElementById(id);
      if(target){
        try{ target.scrollIntoView({behavior:'smooth', block:'start'}); }catch(_){ target.scrollIntoView(); }
        history.replaceState(null, '', '#'+id);
        manualActiveId = id;
        lockScrollSpy  = true;
        if(typeof applyManualHighlight==='function') applyManualHighlight(manualActiveId);
      }
    }
  };

  State.toc.container.addEventListener('click', _onTocClick);
  State.toc.bound = true; // 兼容旧判断，不再依赖它避免重复
}

function bindTreeEventsOnce(){
  if(State.tree.bound || !State.tree.container) return;
  State.tree.bound = true;
  State.tree.container.addEventListener('click', (ev)=>{
    const header = ev.target.closest('.header');
    if(header){
      const dir = header.closest('.dir');
      const id  = dir && dir.dataset.nodeId;
      if(!id) return;
      const node = State.tree.byId.get(id);
      if(!node) return;
      if(node.expanded){
        node.expanded = false;
        collapseDescendants(State.tree.byId, id);
      }else{
        node.expanded = true;
      }
      sync('tree');
    }
  });
}

// 批量操作（复用旧函数名以兼容）
function toggleAllPageTOC(expand){
  State.toc.nodes.forEach(n=>{ if(n.hasChildren) n.expanded = !!expand; });
  sync('toc');
}
function toggleAllFiletree(open){
  State.tree.nodes.forEach(n=>{ if(n.hasChildren) n.expanded = !!open; });
  sync('tree');
}

// v0.30 updates 本页目录渲染 & 展开/收起
function buildPageTOC(){
  const viewer   = qs('#viewer');
  const headings = Array.from(qsa('h1,h2,h3,h4,h5,h6', viewer));
  currentHeadings = headings;  // 保持 scrollSpy 观察目标一致
  const pt = qs('#page-toc'); 
  pt.innerHTML = '';

  if(!headings.length){
    pt.innerHTML = '<div class="toc-section-title">本页无标题</div>';
    // 清空模型，保持一致性
    State.toc = { nodes: [], byId: new Map(), rootIds: [], container: pt, bound:false };
    sync('toc');
    return;
  }

  // v0.31: 全局去重集合，保证每个 heading id 唯一
  const usedIds = new Set();

  // —— 生成“本页目录”行（避免旧逻辑残留：只构建 DOM，不操控显示状态）——
  const frag = document.createDocumentFragment();

  // 预生成 level 数组，便于判断是否有子级（nextLevel > level 即视为有子级）
  const levels = headings.map(h => parseInt(h.tagName.slice(1), 10));

  headings.forEach((h, i) => {
    const lvl = levels[i];
    // v0.31: 基于现有 id 或文本 slugify，再保证全局唯一
    let base = (h.id && h.id.trim()) ? h.id.trim() : slugify(h.textContent || ('h'+lvl));
    let unique = base;
    if (usedIds.has(unique)) {
      let k = 2;
      while (usedIds.has(`${base}-${k}`)) k++;
      unique = `${base}-${k}`;
    }
    h.id = unique;
    usedIds.add(unique);

    const row  = document.createElement('div');
    row.className = 'toc-row';
    // data-nodeId 暂且留空，建模后统一回填
    // row.dataset.nodeId = 'X';

    // === [v0.33-SVG-JS-1a] 创建 fold：先不插 SVG，也不设 role/tabindex，按需在 hasChildren 分支里赋予 ===
    const fold = document.createElement('span');
    fold.className = 'toc-fold';
    fold.setAttribute('data-state', 'collapsed'); // 初始为收起态
    fold.setAttribute('aria-expanded', 'false');

    // 命中区域与可点击视觉保持不变（命中在 span 上；svg 只作展示）
    fold.style.display = 'inline-block';
    fold.style.width = '1em';
    fold.style.textAlign = 'center';
    fold.style.cursor = 'pointer';
    // 此处不插 svg，不设 role/tabindex；在 hasChildren 分支中再决定;

    // 是否有子级：看下一项的层级是否更深（或往后找到第一条更深层的标题）
    let hasChildren = false;
    for(let k=i+1;k<headings.length;k++){
      if(levels[k] > lvl){ hasChildren = true; break; }
      if(levels[k] <= lvl){ break; }
    }

    // === [v0.33-SVG-JS-1b] 有子级才插入 SVG/可聚焦；无子级为 leaf，移除可聚焦 ===
    if (hasChildren) {
      // 插入 chevron svg（展示），设置可达性（可操作）
      fold.innerHTML = '<svg class="icon icon-chev" aria-hidden="true"><use href="#icon-chev"></use></svg>';
      fold.setAttribute('aria-hidden', 'false');
      fold.setAttribute('role', 'button');
      fold.setAttribute('tabindex', '0');
    } else {
      // 叶子：不插 svg；不可聚焦；视觉位仍保留（前面固定了宽度）
      fold.classList.add('leaf');
      fold.setAttribute('aria-hidden', 'true');
      fold.removeAttribute('role');
      fold.setAttribute('tabindex', '-1');
    }

    // v0.30: 使用逻辑深度，每级缩进 1ch
    const a = document.createElement('a');
    a.textContent  = h.textContent || ('标题 ' + (i+1));
    a.href         = '#' + h.id;
    a.dataset.level= String(lvl);



    // 点击行为（仅做“滚动 + 高亮锁定”，不改展开状态；展开由委托统一处理）
    a.addEventListener('click', (e)=>{
      // 原样保留：滚动到正文标题、锁定高亮
      const target = viewer.querySelector('#'+CSS.escape(h.id));
      if(target){
        e.preventDefault();
        try{ target.scrollIntoView({ behavior:'smooth', block:'start' }); }catch(_) { target.scrollIntoView(); }
        // 更新地址但不触发 hashchange 渲染
        history.replaceState(null, '', '#'+h.id);
        // ScrollSpy 锁定与段落高亮（保留原功能）
        manualActiveId = h.id;
        lockScrollSpy  = true;
        if(typeof applyManualHighlight === 'function'){
          applyManualHighlight(manualActiveId);
        }
        // 注意：展开祖先在委托里处理（见 bindTocEventsOnce）
      }
    });

    // [v0.34-C2-CSS-fix-1] 行内容拼装（解耦高亮与缩进）
    const line = document.createElement('div');
    line.className = 'toc-line';

    const indentBox = document.createElement('div');
    indentBox.className = 'toc-indent';
    indentBox.appendChild(fold);
    indentBox.appendChild(a);

    line.appendChild(indentBox);
    row.appendChild(line);
    frag.appendChild(row);
  });

  pt.appendChild(frag);

  // —— 构建模型 + 默认展开策略 + 事件委托 + 首次渲染（核心）——
  buildTocModelFromDOM();

  // 回填 data-nodeId（供 toggleTocSection 兼容旧调用等使用）
  State.toc.nodes.forEach(n=>{
    if(n.el) n.el.dataset.nodeId = n.id;
  });

  // v0.30: 首次进入仅显示 H1（根不展开）
  State.toc.rootIds.forEach(rid=>{
    const rn = State.toc.byId.get(rid);
    if(rn) rn.expanded = false;
  });

  bindTocEventsOnce();
  sync('toc');
  mountScrollSpy();   // ← 添加这一行，恢复滚动联动高亮
}

// [v0.30 A7_remove_conflicts] New toggleTocSection — 仅为兼容旧调用入口
function toggleTocSection(a, row){
  // 兼容：通过 row.dataset.nodeId 定位节点
  const id = row && row.dataset.nodeId;
  if(!id) return;
  const node = State.toc.byId.get(id);
  if(!node) return;
  if(node.expanded){
    node.expanded = false;
    collapseDescendants(State.toc.byId, id);
  }else{
    node.expanded = true;
  }
  sync('toc');
}

// [0.30 A7_remove_conflicts] New initializeProgressiveTOC — 改为默认策略 + sync
function initializeProgressiveTOC(){
  // 重置：全部折叠
  State.toc.nodes.forEach(n=> n.expanded = false);
  // v0.30: 默认根不展开（只显示 H1）
  State.toc.rootIds.forEach(rid=>{
    const rn = State.toc.byId.get(rid);
    if(rn) rn.expanded = false;
  });
  sync('toc');
}

function mountScrollSpy(){
  if(scrollSpy) scrollSpy.disconnect();
  const links = qsa('#page-toc a');
  const map = new Map(links.map(a=>[a.getAttribute('href').slice(1), a]));
  scrollSpy = new IntersectionObserver(entries=>{
    if (lockScrollSpy) return;
    entries.forEach(en=>{
      if(en.isIntersecting){
        const id = en.target.id;
        // === [v0.32-A] 同步 .toc-line 的 active（最小增量，不改其余逻辑） ===
          links.forEach(a=>{
            a.classList.remove('active');
            const line = a.closest('.toc-line');
            if (line) line.classList.remove('active');
          });
          const act = map.get(id);
          if (act) {
            act.classList.add('active');
            const line = act.closest('.toc-line');
            if (line) line.classList.add('active');
          }
      }
    });
  }, { root: qs('section'), threshold: 0.1 });
  currentHeadings.forEach(h=>scrollSpy.observe(h));
}

// 将 #viewer 中的 H1~H6 及其到下一标题之间的内容包成 .md-section
function wrapMarkdownSections(){
  const viewer = qs('#viewer');
  const nodes  = Array.from(viewer.childNodes); // 用静态快照，避免 live 集合修改造成混乱
  const frag   = document.createDocumentFragment();
  let section  = null;

  nodes.forEach(node=>{
    if(node.nodeType===1 && /^H[1-6]$/.test(node.tagName)){
      // 开启新 section 容器
      section = document.createElement('div');
      section.className = 'md-section';
      section.appendChild(node);
      frag.appendChild(section);
    }else{
      if(section){ section.appendChild(node); }
      else{ frag.appendChild(node); }
    }
  });

  viewer.innerHTML = '';
  viewer.appendChild(frag);
}

async function renderDocument(path){
  currentDocPath = path;
  const url = resolveDocURL(path);
  const raw = await fetch(url).then(r=>r.text());
  const html = marked.parse(raw);
  qs('#viewer').innerHTML = html;
  wrapMarkdownSections();
  renderBreadcrumb(path);
  buildPageTOC();
  mountScrollSpy();   // 防止首次加载时未挂载观察器
  clearSearch();
  markActiveFile(path);          // 锁定左侧点击的文件

  lockScrollSpy  = false;
  manualActiveId = null;
}

function markActiveFile(path){
  // 先移除旧的 active
  qsa('#filetree a.active').forEach(el => el.classList.remove('active'));

  // 在 filetree 中找到匹配的 data-path
  const sel = qs(`#filetree a[data-path="${CSS.escape(path)}"]`);
  if(sel) sel.classList.add('active');
}

// 搜索（保留）
function clearSearch(){
  qsa('mark.search-hit, mark.search-current', qs('#viewer')).forEach(m=>{
    const t = document.createTextNode(m.textContent); m.parentNode.replaceChild(t, m);
  });
  searchHits = []; searchIndex = -1;
  qs('#hit-info').textContent = '0 / 0';
}
function doSearch(){
  const q = qs('#q').value.trim();
  if(!currentDocPath){ alert('请先在左侧选择一个文档。当前仅支持单文档内部的全文搜索。'); return; }
  clearSearch();
  if(!q) return;
  const viewer = qs('#viewer');
  const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT, {
    acceptNode:n=>n.nodeValue.trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT
  });
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
  let node, nodes=[]; while(node=walker.nextNode()) nodes.push(node);
  nodes.forEach(n=>{
    const frag = document.createDocumentFragment(); let last=0; const text=n.nodeValue; let m;
    while((m=re.exec(text))){
      const pre=text.slice(last,m.index); if(pre) frag.appendChild(document.createTextNode(pre));
      const mark=document.createElement('mark'); mark.className='search-hit'; mark.textContent=m[0];
      frag.appendChild(mark); last=m.index+m[0].length;
    }
    if(last===0) return;
    const tail=text.slice(last); if(tail) frag.appendChild(document.createTextNode(tail));
    n.parentNode.replaceChild(frag,n);
  });
  searchHits = qsa('mark.search-hit', viewer);
  if(searchHits.length){ searchIndex=0; goToHit(0); }
  qs('#hit-info').textContent = (searchHits.length?1:0)+' / '+searchHits.length;
}
function goToHit(delta){
  if(!searchHits.length) return;
  if(delta) searchIndex = (searchIndex + delta + searchHits.length) % searchHits.length;
  searchHits.forEach(m=>m.classList.remove('search-current'));
  const cur = searchHits[searchIndex]; cur.classList.add('search-current');
  cur.scrollIntoView({behavior:'smooth', block:'center'});
  qs('#hit-info').textContent = (searchIndex+1)+' / '+searchHits.length;
}

// 小工具：判断当前 scope 下是否“所有可折叠节点都已展开”
function allExpandableOpen(scope){
  const S = scope === 'tree' ? State.tree : State.toc;
  const list = S.nodes.filter(n => n.hasChildren);
  return list.length > 0 && list.every(n => n.expanded);
}

// 事件绑定：只做“触发动作”，状态与文案交给 sync()
function bindUI(){
  // 侧栏折叠/展开
  qs('#toc-toggle')?.addEventListener('click', ()=>{
    const collapsed = !document.body.classList.contains('sb-collapsed');
    setSidebarCollapsed(collapsed);
  });

  // 初始化可调整宽度（仅桌面端启用）
  setSidebarCollapsed(false);
  if(!isMobile()){ initResizableTOC?.(); }

  // [v0.35-search-toggle] 移动端：点击放大镜展开/收起第二行搜索条
  qs('#search-toggle')?.addEventListener('click', ()=>{
    document.body.classList.toggle('search-open');
    updateStickyTop();
  });

  // 切换“文件树 <-> 本页目录”
  qs('#toc-mode')?.addEventListener('click', ()=>{
    setSidebarMode(sidebarMode === 'filetree' ? 'pagetoc' : 'filetree');
    // 注意：setSidebarMode 内部不要再手动改按钮文案，sync() 会处理
  });

  // 展开/收起全部（根据当前模式自动判定）
  qs('#toc-expand-all')?.addEventListener('click', ()=>{
    const tocVisible  = !qs('#page-toc').hidden && qs('#page-toc').offsetParent !== null;
    const treeVisible = !qs('#filetree').hidden && qs('#filetree').offsetParent !== null;

    if (tocVisible){
      const allOpen = allExpandableOpen('toc');
      toggleAllPageTOC(!allOpen);
    } else if (treeVisible){
      const allOpen = allExpandableOpen('tree');
      toggleAllFiletree(!allOpen);
    }
    // 不再在这里改按钮文字，sync() 会根据状态自动更新文案
  });

  // 搜索/命中导航（保留原功能）
  qs('#q')?.addEventListener('keydown', e=>{ if(e.key === 'Enter') doSearch(); });
  qs('#prev-hit')?.addEventListener('click', ()=> goToHit(-1));
  qs('#next-hit')?.addEventListener('click', ()=> goToHit(1));
}

// === [v0.32-E-JS-1] 分离 gutter / toc 的 hover（不依赖 :has） ===
function mountHoverSeparation(){
  const gutter = document.querySelector('#gutter');
  const toggle = document.querySelector('#toc-toggle');
  if (!gutter || !toggle) return;

  // 进入/离开 toc 按钮：只让按钮有 hover，强制关掉 gutter 的 hover
  toggle.addEventListener('pointerenter', () => {
    gutter.classList.remove('gutter-hover');
    toggle.classList.add('toc-hover');      // 若你在 CSS 里做了 .toc-hover 样式，这里会生效
  });
  toggle.addEventListener('pointerleave', () => {
    toggle.classList.remove('toc-hover');
    // 不在这里开启 gutter 悬浮，交给 gutter 的 pointerenter 统一处理
  });

  // 进入/离开 gutter：只有当指针不在 toc 按钮上时才启用 gutter 悬浮
  gutter.addEventListener('pointerenter', () => {
    // 如果此刻按钮正被 hover，则不触发 gutter 悬浮
    if (toggle.matches(':hover')) {
      gutter.classList.remove('gutter-hover');
    } else {
      gutter.classList.add('gutter-hover');
    }
  });
  gutter.addEventListener('pointerleave', () => {
    gutter.classList.remove('gutter-hover');
  });

  // 在 gutter 内部移动过程中，如果进入了按钮区域，也要立即取消 gutter 悬浮
  gutter.addEventListener('pointerover', (ev) => {
    // composedPath 可以覆盖 Shadow DOM/冒泡差异，兼容性良好
    const path = ev.composedPath ? ev.composedPath() : [];
    if (path.includes(toggle)) {
      gutter.classList.remove('gutter-hover');
    }
  });
}

// v0.27 — Resizable sidebar (drag gutter to resize)
function initResizableTOC(){
  const root = document.documentElement;
  const gutter = qs('#gutter');
  const btn = qs('#toc-toggle');
  const MIN_W = 220;
  const MAX_W = 560;
  let startX = 0, startW = 0, resizing = false;

  // apply saved width
  const saved = localStorage.getItem('tocWidth');
  if(saved){
    const val = parseInt(saved,10);
    if(!isNaN(val)) root.style.setProperty('--toc-w', val + 'px');
  }

  function onDown(e){
    // allow clicking toggle button without starting resize
    if(e.target === btn || e.target.closest && e.target.closest('#toc-toggle')) return;
    resizing = true;
    startX = e.clientX;
    const cur = getComputedStyle(root).getPropertyValue('--toc-w').trim();
    startW = parseInt(cur, 10) || 280;
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault();
  }
  function onMove(e){
    if(!resizing) return;
    let w = startW + (e.clientX - startX);
    if(w < MIN_W) w = MIN_W;
    if(w > MAX_W) w = MAX_W;
    root.style.setProperty('--toc-w', w + 'px');
  }
  function onUp(){
    if(!resizing) return;
    resizing = false;
    document.body.classList.remove('resizing');
    const cur = getComputedStyle(root).getPropertyValue('--toc-w').trim();
    const val = parseInt(cur, 10);
    if(!isNaN(val)) localStorage.setItem('tocWidth', String(val));
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }

  gutter.addEventListener('mousedown', onDown);
}

// === [v0.32-B-JS-1] 运行时计算 sticky 顶部（header + #search-tip + #breadcrumb[可选]） ===
function updateStickyTop(){
  const header = qs('header');
  const tip    = qs('#search-tip');
  const crumb  = qs('#breadcrumb');

  let h = 0;
  if (header) h += header.offsetHeight;
  if (tip)    h += tip.offsetHeight;
  if (crumb && crumb.offsetParent !== null) {
    const text = crumb.textContent.trim();
    if (text.length > 0) {
      h += crumb.offsetHeight;
    }
  }

  document.documentElement.style.setProperty('--sticky-top', h + 'px');
}

// === [v0.32-B1B3-JS] 首屏隐藏 breadcrumb + 统一重算 sticky 顶部 ===
async function init(){
  bindUI();
  // === [v0.32-E-JS-1] 分离 gutter / toc hover（移动端跳过）
  if(!isMobile()){ mountHoverSeparation(); }
  
  // [v0.35-vh-init] 首屏与窗口变化：写入 --vh，修复底/右整条白块
  setVH();
  window.addEventListener('resize', setVH);
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', setVH);
  }

  // [v0.35-mobile-default-collapsed] 移动端首屏：目录折叠 + 关闭拖拽已在 bindUI 守护
  if(isMobile()){
    setSidebarCollapsed(true);
  }

  // 首屏：先隐藏 breadcrumb，防止其高度被算入 sticky 顶部
  // （renderBreadcrumb 内已修正为 #search-tip 选择器）
  try { renderBreadcrumb(); } catch (e) { /* 忽略异常以保证首屏不中断 */ }

  // 首屏计算一次；并在窗口尺寸变化时重算
  updateStickyTop();
  window.addEventListener('resize', updateStickyTop);

  await mountFileTree();

  const target = normalizeHash();
  if (target) {
    renderDocument(target)
      .catch(console.error)
      .finally(updateStickyTop); // 渲染完成后再算一次，确保高度精确
  }

  window.addEventListener('hashchange', ()=>{
    const t = normalizeHash();
    if (t) {
      renderDocument(t)
        .catch(console.error)
        .finally(updateStickyTop); // 每次切换文档后也重算
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
