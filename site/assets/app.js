/* app.js — v0.236 formal */

let currentDocPath = null;
let currentHeadings = [];
let scrollSpy = null;
let searchHits = [];
let searchIndex = -1;

// 锁定（仅 pagetoc 使用）
let manualActiveId = null;
let lockScrollSpy  = false;

// 展开/收起全部的状态
let filetreeExpandedAll = false;   // 文件树默认全折叠
let pagetocExpandedAll  = true;    // 本页目录默认全展开

/* [A1] v0.28 引入统一折叠图标 caret icons (SVG) */ 
function svgCaret(dir='right'){
  return dir==='down'
    ? '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 7l5 6 5-6" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M7 5l6 5-6 5" fill="currentColor"/></svg>';
}

/* v0.28 caret with SVG (down/right arrow) */
function setCaret(el, expanded){
  el.dataset.state = expanded ? 'expanded' : 'collapsed';
  el.innerHTML = expanded
    // ▼ down
    ? '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 9l6 6 6-6"/></svg>'
    // ▶ right
    : '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9 6l6 6-6 6"/></svg>';
}

async function fetchJSON(url){
  try{
    const r = await fetch(url, { cache:'no-cache' });
    if(!r.ok) throw new Error('HTTP '+r.status+' '+url);
    return await r.json();
  }catch(err){
    console.warn('[fetchJSON] failed:', url, err);
    return null; // 继续让上层 fallback
  }
}

const qs  = (sel, root=document)=> root.querySelector(sel);
const qsa = (sel, root=document)=> Array.from(root.querySelectorAll(sel));

const normalizeHash = ()=>{
  const h = location.hash || '';
  const m = h.match(/#doc=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

const resolveDocURL = (p)=> /^content\//.test(p) ? p : ('content/' + p);

/* v0.28: try multiple URL candidates until one succeeds (status 200 + valid JSON) */
async function fetchFirstJSON(paths){
  for(const url of paths){
    try{
      const r = await fetch(url, { cache:'no-cache' });
      if(!r.ok) { console.warn('[fetchFirstJSON] HTTP', r.status, url); continue; }
      const j = await r.json();
      console.log('[fetchFirstJSON] hit', url);
      return j;
    }catch(e){
      console.warn('[fetchFirstJSON] fail', url, e);
    }
  }
  return null;
}

function stripOrderPrefix(s){ return s.replace(/^\d+[-_\. ]+/, ''); }

function setSidebarCollapsed(collapsed){
  const body = document.body;
  if(collapsed) body.classList.add('sb-collapsed');
  else body.classList.remove('sb-collapsed');
  const btn = qs('#toc-toggle');
  if(btn){
    btn.textContent = collapsed ? '❯' : '❮';
    btn.title = collapsed ? '展开目录' : '收起目录';
  }
}

let sidebarMode = 'filetree';
function setSidebarMode(mode){
  sidebarMode = mode;
  const ft = qs('#filetree'), pt = qs('#page-toc'), title = qs('#toc-title');
  const toggleAllBtn = qs('#toc-expand-all');

  if(mode==='filetree'){
    ft.style.display=''; pt.style.display='none'; title.textContent='文档/目录';

    // 切回文件树：解除锁定、高亮
    lockScrollSpy = false; manualActiveId = null; clearSectionHighlight();
    qsa('#page-toc a.locked').forEach(a => a.classList.remove('locked'));
    qsa('#page-toc a.active').forEach(a => a.classList.remove('active'));

    // 文件树默认全折叠
    toggleAllFiletree(false);
    filetreeExpandedAll = false;
    toggleAllBtn.textContent = '展开全部';

  } else {
    ft.style.display='none'; pt.style.display=''; title.textContent='本页目录';

    // 本页目录默认全展开
    toggleAllPageTOC(true);
    pagetocExpandedAll = true;
    toggleAllBtn.textContent = '收起全部';
  }
}

// 面包屑
function renderBreadcrumb(path){
  const bc = qs('#breadcrumb'); bc.innerHTML = '';
  if(!path) return;
  const clean = path.replace(/^content\//, '');
  const parts = clean.split('/');
  const names = parts.slice(0, -1);
  const file  = parts[parts.length-1];
  const makeCrumb = (text)=>{
    const a = document.createElement('a');
    a.textContent = text;
    a.href = 'javascript:void(0)';
    a.addEventListener('click', ()=> setSidebarMode('filetree'));
    return a;
  };
  bc.appendChild(makeCrumb('文档库'));
  names.forEach(seg=>{
    const sep = document.createElement('span'); sep.className='crumb-sep'; bc.appendChild(sep);
    bc.appendChild(makeCrumb(seg));
  });
  const sep = document.createElement('span'); sep.className='crumb-sep'; bc.appendChild(sep);
  const name = document.createElement('span'); name.textContent = file.replace(/\.md$/i,'');
  bc.appendChild(name);
}

function renderBreadcrumb(path){
  const bc = document.querySelector('#breadcrumb'); bc.innerHTML = '';
  if(!path) return;
  const clean = path.replace(/^content\//, '');
  const parts = clean.split('/');
  const names = parts.slice(0, -1).map(stripOrderPrefix);
  const file  = stripOrderPrefix(parts[parts.length-1]).replace(/\.md$/i,'');
  // 面包屑去前缀
}

// 文件树渲染 & 全展/全收逻辑
function renderDirTree(nodes, container){
  nodes.forEach(node=>{
    if(node.type === 'dir'){
      const wrap   = document.createElement('div');  wrap.className = 'dir';
      const header = document.createElement('div');  header.className = 'header';

      // v0.28：统一使用 SVG caret（更大、可点），初始折叠
      const caret = makeCaret(false);

      const label = document.createElement('span');
      // ✅ 保留原逻辑：优先用 node.display；否则 stripOrderPrefix(node.name)
      label.textContent = (node.display || stripOrderPrefix(node.name));
      label.style.fontWeight = '600';

      const box   = document.createElement('div');
      box.className = 'children';
      box.style.display = 'none';

      header.prepend(caret);
      header.appendChild(label);
      wrap.appendChild(header);
      wrap.appendChild(box);

      // ✅ 保留原行为：点击目录头 → 只切换本层 box 的显隐
      header.addEventListener('click', ()=>{
        const open = box.style.display !== 'none';
        box.style.display = open ? 'none' : '';
        setCaret(caret, !open);   // 同步小三角方向
      });

      // 递归渲染子节点（✅ 保留原结构）
      renderDirTree(node.children || [], box);
      container.appendChild(wrap);
    }
    else if(node.type === 'file'){
      const a = document.createElement('a');
      a.className = 'file';

      // ✅ 保留原：展示名取 node.display / node.name 去 .md
      const docPath  = node.path || '';
      const baseName = (node.display || node.name || '').replace(/\.md$/i,'');
      a.textContent  = baseName;

      // ✅ 保留原：href 统一成 #doc=content/...
      const hrefPath = /^content\//.test(docPath) ? docPath : ('content/' + docPath);
      a.href = '#doc=' + encodeURIComponent(hrefPath);

      // ✅ 关键：保留 dataset.path，供 markActiveFile 等后续调用使用
      a.dataset.path = hrefPath;

      // ✅ 保留原埋点：点击文件后切换到“本页目录”视图（锁定选中文件）
      a.addEventListener('click', ()=>{ setSidebarMode('pagetoc'); });

      container.appendChild(a);
    }
  });
}

/* v0.28 sync caret for filetree */
function toggleAllFiletree(expand){
  filetreeExpandedAll = !!expand;
  // 每个目录 wrap：:scope 限定只找当前层，避免误选嵌套
  qsa('#filetree .dir').forEach(wrap=>{
    const box   = wrap.querySelector(':scope > .children');
    const caret = wrap.querySelector(':scope > .header .caret');
    if(box)   box.style.display = expand ? '' : 'none';
    if(caret) setCaret(caret, expand);
  });
}

async function mountFileTree(){
  const tree = await fetchFirstJSON([
    'index/tree.json',        'site/index/tree.json',
    '/index/tree.json',       '/site/index/tree.json'
  ]);

  const docs = await fetchFirstJSON([
    'index/docs.json',        'site/index/docs.json',
    '/index/docs.json',       '/site/index/docs.json'
  ]);

  if(tree && Array.isArray(tree)){
    // 用树渲染
    const container = qs('#filetree');
    container.innerHTML = '';
    renderDirTree(tree, container);
    qs('#toc-mode').textContent = '文件树';
    return;
  }

  if(docs && Array.isArray(docs)){
    // 回退到“全部文档”视图
    const container = qs('#filetree');
    container.innerHTML = '';
    renderDirTree([{ type:'dir', name:'全部文档', display:'全部文档', children:docs }], container);
    qs('#toc-mode').textContent = '文件树';
    return;
  }

  // 双失败：显示错误提示（保留你的提示样式）
  const container = qs('#filetree');
  container.innerHTML = '<div class="error">目录加载失败（tree/docs 均不可用）。</div>';
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

  // 同步目录态势：只给当前加 active+locked
  qsa('#page-toc a.active').forEach(a => a.classList.remove('active'));
  qsa('#page-toc a.locked').forEach(a => a.classList.remove('locked'));
  const link = qs(`#page-toc a[href="#${CSS.escape(id)}"]`);
  if(link){ link.classList.add('locked'); link.classList.add('active'); }

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


// 本页目录渲染 & 展开/收起
function buildPageTOC(){
  // 1) 抓取 h1–h6
  const viewer = qs('#viewer') || document;
  const headings = Array.from(qsa('h1,h2,h3,h4,h5,h6', viewer));
  const pt = qs('#page-toc');
  pt.innerHTML = '';

  if(!headings.length){
    pt.innerHTML = '<div class="toc-section-title">本页暂无标题</div>';
    return;
  }

  // 2) 先构造 levels，辅助判断
  const levels = headings.map(h => parseInt(h.tagName.slice(1), 10));
  const frag = document.createDocumentFragment();

  // 3) 使用 stack 生成稳定的 data-id / data-parent / data-level
  const stack = []; let autoId = 0;

  headings.forEach((h, idx)=>{
    if(!h.id){ h.id = (typeof slugify === 'function' ? slugify(h.textContent) : ('h-' + idx)); }
    const lvl = levels[idx];
    // 维护父链：弹出 >= 自身层级的
    while (stack.length && stack[stack.length-1].level >= lvl) stack.pop();
    const parentId = stack.length ? stack[stack.length-1].id : '';

    const row = document.createElement('div');
    row.className = 'toc-row';
    const myId = `toc-${++autoId}`;
    row.dataset.id     = myId;
    row.dataset.parent = parentId;
    row.dataset.level  = String(lvl);

    // 折叠键（放在前或后都可，这里放前）
    const fold = document.createElement('span');
    // 是否有子级：看下一项层级是否更深
    const nextLvl = levels[idx+1] ?? 0;
    const hasChildren = nextLvl > lvl;
    fold.className = 'toc-fold' + (hasChildren ? '' : ' leaf');
    setCaret(fold, hasChildren ? true : false);
    row.appendChild(fold);

    // 标题链接
    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.dataset.level = String(lvl);
    a.textContent = h.textContent || '';
    a.addEventListener('click', (e)=>{
      e.preventDefault();
      document.getElementById(h.id).scrollIntoView({ behavior:'smooth', block:'start' });
      history.replaceState(null, '', '#' + h.id);
      manualActiveId = h.id;
      lockScrollSpy  = true;
      applyManualHighlight(manualActiveId);
    });
    row.appendChild(a);

    // 初始显示：与原逻辑保持一致（默认全展开）
    row.style.display = (pagetocExpandedAll || lvl === 1) ? '' : 'none';

    frag.appendChild(row);
    stack.push({ id: myId, level: lvl });
  });

  pt.appendChild(frag);

  // 4) 绑定委托（只绑定一次）
  bindPageTocDelegation();

  // 5) 重挂滚动监听 + 默认全展开 + 更新按钮文案（保留你原行为）
  mountScrollSpy();
  toggleAllPageTOC(true);
  pagetocExpandedAll = true;
  const btn = qs('#toc-expand-all');
  if(btn) btn.textContent = '收起全部';

  // 6) 允许滚动联动（直到用户点击某条目）
  lockScrollSpy  = false;
  manualActiveId = null;
}

/* v0.28: 只绑定一次的委托 */
let _tocDelegationBound = false;
function bindPageTocDelegation(){
  if(_tocDelegationBound) return;
  _tocDelegationBound = true;

  const cont = qs('#page-toc');
  cont.addEventListener('click', (e)=>{
    const fold = e.target.closest('.toc-fold');
    if(!fold || fold.classList.contains('leaf')) return;
    e.preventDefault(); e.stopPropagation();

    const row = fold.closest('.toc-row');
    const expanding = (fold.dataset.state !== 'expanded');
    toggleTocRow(row, expanding);
  });
}

/* 展开/收起“当前行”的直接子级；收起时递归隐藏后代 */
function toggleTocRow(row, expand){
  const fold = row.querySelector('.toc-fold');
  if(fold) setCaret(fold, !!expand);
  row.setAttribute('aria-expanded', expand ? 'true' : 'false');

  const id = row.dataset.id;
  // 直接子级
  const children = qsa(`#page-toc .toc-row[data-parent="${id}"]`);
  children.forEach(ch => {
    ch.style.display = expand ? '' : 'none';
    if(!expand) collapseTocDescendants(ch);
  });
}

/* 递归隐藏一个行的所有后代，并复位它们的 caret */
function collapseTocDescendants(row){
  const fold = row.querySelector('.toc-fold');
  if(fold && !fold.classList.contains('leaf')) setCaret(fold, false);

  const id = row.dataset.id;
  const kids = qsa(`#page-toc .toc-row[data-parent="${id}"]`);
  kids.forEach(k=>{
    k.style.display = 'none';
    collapseTocDescendants(k);
  });
}

/* 全展开 / 全收起（保留第 1 级） */
function toggleAllPageTOC(expand){
  pagetocExpandedAll = !!expand;
  const rows = qsa('#page-toc .toc-row');
  rows.forEach(row=>{
    const lvl = Number(row.dataset.level || '1');
    // 显示策略
    row.style.display = expand ? '' : (lvl === 1 ? '' : 'none');
    // caret 同步：有子级的才设置
    const fold = row.querySelector('.toc-fold');
    if(fold && !fold.classList.contains('leaf')) setCaret(fold, expand);
    // 标记状态
    row.setAttribute('aria-expanded', expand ? 'true' : (lvl===1 ? 'true' : 'false'));
  });
}

/* 兼容旧调用名（如果其它地方还在调用 toggleTocSection） */
function toggleTocSection(a, row){
  const fold = row.querySelector('.toc-fold');
  const expanding = (fold?.dataset.state !== 'expanded');
  toggleTocRow(row, expanding);
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
        links.forEach(a=>a.classList.remove('active'));
        const act = map.get(id); if(act) act.classList.add('active');
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

/* [E5] v0.28 mobile drawer behavior */
function bindDrawerUI(){
  const mm = window.matchMedia('(max-width: 768px)');
  const scrim = qs('#drawer-scrim');
  const btn = qs('#drawer-btn');
  function close(){ document.body.classList.remove('drawer-open'); scrim?.setAttribute('hidden',''); }
  function open(){ document.body.classList.add('drawer-open'); scrim?.removeAttribute('hidden'); }
  function apply(){ close(); }
  apply(); mm.addEventListener('change', apply);

  btn?.addEventListener('click', ()=> {
    if(document.body.classList.contains('drawer-open')) close(); else open();
  });
  scrim?.addEventListener('click', close);
  window.addEventListener('hashchange', close);
}

// 事件绑定
function bindUI(){
  qs('#toc-toggle').addEventListener('click', ()=>{
    const collapsed = !document.body.classList.contains('sb-collapsed');
    setSidebarCollapsed(collapsed);
  });
  setSidebarCollapsed(false);
  initResizableTOC();


  qs('#toc-mode').addEventListener('click', ()=>{
    setSidebarMode(sidebarMode==='filetree'?'pagetoc':'filetree');
  });

  // 展开/收起全部
  qs('#toc-expand-all').addEventListener('click', ()=>{
    if(sidebarMode==='filetree'){
      filetreeExpandedAll = !filetreeExpandedAll;
      toggleAllFiletree(filetreeExpandedAll);
      qs('#toc-expand-all').textContent = filetreeExpandedAll ? '收起全部' : '展开全部';
    }else{
      pagetocExpandedAll = !pagetocExpandedAll;
      toggleAllPageTOC(pagetocExpandedAll);
      qs('#toc-expand-all').textContent = pagetocExpandedAll ? '收起全部' : '展开全部';
    }
  });

  qs('#q').addEventListener('keydown', e=>{ if(e.key==='Enter') doSearch(); });
  qs('#prev-hit').addEventListener('click', ()=> goToHit(-1));
  qs('#next-hit').addEventListener('click', ()=> goToHit(1));
  bindDrawerUI(); // [E4]
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
async function init(){
  bindUI();
  await mountFileTree();
  const target = normalizeHash();
  if(target) renderDocument(target).catch(console.error);
  window.addEventListener('hashchange', ()=>{
    const t = normalizeHash();
    if(t) renderDocument(t).catch(console.error);
  });
}
document.addEventListener('DOMContentLoaded', init);
