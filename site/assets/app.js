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

async function fetchJSON(url){
  const r = await fetch(url, { cache:'no-cache' });
  if(!r.ok) throw new Error('HTTP '+r.status+' '+url);
  return await r.json();
}
const qs  = (sel, root=document)=> root.querySelector(sel);
const qsa = (sel, root=document)=> Array.from(root.querySelectorAll(sel));

const normalizeHash = ()=>{
  const h = location.hash || '';
  const m = h.match(/#doc=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

const resolveDocURL = (p)=> /^content\//.test(p) ? p : ('content/' + p);

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
function renderTree(nodes, container){
  nodes.forEach(node=>{
    if(node.type==='dir'){
      const wrap = document.createElement('div'); wrap.className='dir';
      const header = document.createElement('div'); header.className='header';
      const caret = document.createElement('span'); caret.textContent='▸'; caret.style.width='1em'; caret.style.display='inline-block';
      const label = document.createElement('span'); label.textContent=(node.display || stripOrderPrefix(node.name)); label.style.fontWeight='600';
      const box = document.createElement('div'); box.className='children';
      box.style.display = 'none'; // 默认折叠

      header.appendChild(caret); header.appendChild(label);
      wrap.appendChild(header); wrap.appendChild(box);

      header.addEventListener('click', ()=>{
        const open = box.style.display !== 'none';
        box.style.display = open ? 'none' : '';
        caret.textContent = open ? '▸' : '▾';
      });

      function renderTree(nodes, container){
  nodes.forEach(node=>{
    if(node.type==='dir'){
      const wrap = document.createElement('div'); wrap.className='dir';
      const header = document.createElement('div'); header.className='header';
      const caret = document.createElement('span'); caret.textContent='▸'; caret.style.width='1em'; caret.style.display='inline-block';
      const label = document.createElement('span');
      label.textContent = (node.display || stripOrderPrefix(node.name));  // ★
      label.style.fontWeight='600';
      const box = document.createElement('div'); box.className='children'; box.style.display='none';

      header.appendChild(caret); header.appendChild(label);
      wrap.appendChild(header); wrap.appendChild(box);

      header.addEventListener('click', ()=>{
        const open = box.style.display !== 'none';
        box.style.display = open ? 'none' : '';
        caret.textContent = open ? '▸' : '▾';
      });

      renderTree(node.children||[], box);
      container.appendChild(wrap);
    }else if(node.type==='file'){
      const a = document.createElement('a');
      a.className='file';
      const docPath = node.path || '';
      const baseName = (node.display || node.title || node.name || '').replace(/\.md$/i,''); // ★
      a.textContent = baseName;
      const hrefPath = /^content\//.test(docPath) ? docPath : ('content/' + docPath);
      a.href = '#doc=' + encodeURIComponent(hrefPath);
      container.appendChild(a);
    }
  });
}

      renderTree(node.children||[], box);
      container.appendChild(wrap);
    }else if(node.type==='file'){
      const a = document.createElement('a');
      a.className='file';
      const docPath = node.path || '';
      a.textContent = (node.name || '').replace(/\.md$/i,'');
      const hrefPath = resolveDocURL(docPath);
      a.href = '#doc=' + encodeURIComponent(hrefPath);
      container.appendChild(a);
    }
  });
}

function toggleAllFiletree(open){
  qsa('#filetree .dir').forEach(dir=>{
    const header = qs('.header', dir);
    const box = qs('.children', dir);
    const caret = header && header.firstChild;
    if(box){
      box.style.display = open ? '' : 'none';
      if(caret) caret.textContent = open ? '▾' : '▸';
    }
  });
}

async function mountFileTree(){
  const container = qs('#filetree'); container.innerHTML = '';
  try{
    const tree = await fetchJSON('index/tree.json?ts='+Date.now());
    if(Array.isArray(tree) && tree.length){
      renderTree(tree, container);
      // 初始全折叠
      toggleAllFiletree(false);
      filetreeExpandedAll = false;
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
    filetreeExpandedAll = false;
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
  const viewer = qs('#viewer');
  const headings = qsa('h1,h2,h3,h4,h5,h6', viewer);
  currentHeadings = headings;
  const pt = qs('#page-toc'); pt.innerHTML='';
  if(!headings.length){ pt.innerHTML='<div class="toc-section-title">本页无标题</div>'; return; }
  const frag = document.createDocumentFragment();
  headings.forEach(h=>{
    if(!h.id){ h.id = slugify(h.textContent); }
    const lvl = parseInt(h.tagName.substring(1),10);
    const a = document.createElement('a');
    a.href = '#'+h.id; a.textContent=h.textContent;
    a.dataset.level = String(lvl);
    a.style.marginLeft = Math.max(0,lvl-1)*10+'px';

    a.addEventListener('click', e=>{
      e.preventDefault();
      document.getElementById(h.id).scrollIntoView({behavior:'smooth', block:'start'});
      history.replaceState(null,'','#'+h.id);

      manualActiveId = h.id;
      lockScrollSpy  = true;
      applyManualHighlight(manualActiveId);
    });

    frag.appendChild(a);
  });
  pt.appendChild(frag);

  mountScrollSpy();

  // 切换到 pagetoc 时默认全展开
  toggleAllPageTOC(true);
  pagetocExpandedAll = true;
  qs('#toc-expand-all').textContent = '收起全部';

  // 允许滚动联动，直到用户点击条目
  lockScrollSpy  = false;
  manualActiveId = null;
}

function toggleAllPageTOC(expanded){
  const links = qsa('#page-toc a');
  links.forEach(a=>{
    const lvl = Number(a.dataset.level || '1');
    a.style.display = expanded ? '' : (lvl===1 ? '' : 'none');
  });
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

  lockScrollSpy  = false;
  manualActiveId = null;
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

// 事件绑定
function bindUI(){
  qs('#toc-toggle').addEventListener('click', ()=>{
    const collapsed = !document.body.classList.contains('sb-collapsed');
    setSidebarCollapsed(collapsed);
  });
  setSidebarCollapsed(false);

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
