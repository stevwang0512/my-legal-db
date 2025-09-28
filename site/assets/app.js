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
  return renderDirTree(nodes, container);
}

// 递归用唯一实现，避免再绕转接器
function renderDirTree(nodes, container){
  nodes.forEach(node=>{
    if(node.type==='dir'){
      const wrap   = document.createElement('div');  wrap.className = 'dir';
      const header = document.createElement('div');  header.className = 'header';
      const caret  = document.createElement('span'); caret.textContent='▸'; caret.style.width='1em'; caret.style.display='inline-block';
      const label  = document.createElement('span');
      label.textContent = (node.display || stripOrderPrefix(node.name));  // 目录名：去排序前缀
      label.style.fontWeight = '600';
      const box    = document.createElement('div');  box.className='children'; box.style.display='none';

      header.appendChild(caret); header.appendChild(label);
      wrap.appendChild(header);  wrap.appendChild(box);

      header.addEventListener('click', ()=>{
        const open = box.style.display !== 'none';
        box.style.display = open ? 'none' : '';
        caret.textContent = open ? '▸' : '▾';
      });

      
      renderDirTree(node.children || [], box);
      container.appendChild(wrap);

  } else if(node.type==='file'){
    const a = document.createElement('a');
    a.className = 'file';

    const docPath  = node.path || '';
    const baseName = (node.display || node.name || '').replace(/\.md$/i,''); // ★ 只用文件名（不再兜底 title）
    a.textContent  = baseName;

    const hrefPath = /^content\//.test(docPath) ? docPath : ('content/' + docPath);
    a.href         = '#doc=' + encodeURIComponent(hrefPath);

    // 为左侧“锁定选中文件”埋点
    a.dataset.path = hrefPath;

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
  const viewer  = qs('#viewer');
  const headings = qsa('h1,h2,h3,h4,h5,h6', viewer);
  const pt = qs('#page-toc'); pt.innerHTML = '';
  if(!headings.length){ pt.innerHTML = '<div class="toc-section-title">本页无标题</div>'; return; }

  const frag = document.createDocumentFragment();

  headings.forEach(h=>{
    if(!h.id){ h.id = slugify(h.textContent); }
    const lvl = parseInt(h.tagName.slice(1), 10);

    // 构造目录项：一行容器 + 折叠按钮 + 链接
    const row   = document.createElement('div');
    row.className = 'toc-row';

    const fold  = document.createElement('button');
    fold.type = 'button';
    fold.className = 'toc-fold';
    fold.title = '折叠/展开本节';
    fold.textContent = '▾';                 // 默认展开
    fold.dataset.state = 'expanded';

    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    a.dataset.level = String(lvl);
    a.style.marginLeft = Math.max(0, (lvl-1)*10) + 'px';

    // ① 点击目录项：跳转并锁定（保持你原来的行为）
    a.addEventListener('click', e=>{
      e.preventDefault();
      document.getElementById(h.id).scrollIntoView({behavior:'smooth', block:'start'});
      history.replaceState(null,'','#'+h.id);

      manualActiveId = h.id;
      lockScrollSpy  = true;
      applyManualHighlight(manualActiveId);
    });

    // ② 点击折叠按钮：只折叠/展开子级（不滚动）
    fold.addEventListener('click', e=>{
      e.preventDefault();
      e.stopPropagation();
      toggleTocSection(a, row);  // ★ 新增：见下方 B
    });

    row.appendChild(fold);
    row.appendChild(a);
    frag.appendChild(row);
  });

  pt.appendChild(frag);

  // 挂载滚动监听（保留）
  mountScrollSpy();

  // 切换到 pagetoc 时默认全展开（保留原语义）
  toggleAllPageTOC(true);            // ★ 重写了内部实现，见下方 C
  pagetocExpandedAll = true;
  qs('#toc-expand-all').textContent = '收起全部';

  // 允许滚动联动，直到用户点击条目（保留）
  lockScrollSpy   = false;
  manualActiveId  = null;
}

function toggleTocSection(a, row){
  // 当前级别
  const baseLvl = Number(a.dataset.level || '1');

  // 查找所有 toc 行（保持顺序）
  const rows = Array.from(qsa('#page-toc .toc-row'));
  const selfIndex = rows.indexOf(row);
  if(selfIndex < 0) return;

  const caret = row.querySelector('.toc-fold');
  const willCollapse = caret.dataset.state !== 'collapsed'; // 当前是展开→要折叠
  caret.dataset.state = willCollapse ? 'collapsed' : 'expanded';
  caret.textContent   = willCollapse ? '▸' : '▾';

  // 向后遍历，直到遇到同级或更高等级的标题为止
  for(let i = selfIndex + 1; i < rows.length; i++){
    const a2 = rows[i].querySelector('a');
    const lvl = Number(a2.dataset.level || '1');
    if(lvl <= baseLvl) break;

    rows[i].style.display = willCollapse ? 'none' : '';
    // 如果是展开，且该行自己的按钮是折叠态，则它下面的后代保持隐藏（尊重局部状态）
    if(!willCollapse){
      const caret2 = rows[i].querySelector('.toc-fold');
      if(caret2 && caret2.dataset.state === 'collapsed'){
        // 保持折叠子树隐藏
        // 将其直接后代先隐藏（直到遇到 <= 它级别）
        const subLvl = lvl;
        for(let j = i+1; j < rows.length; j++){
          const a3 = rows[j].querySelector('a');
          const l3 = Number(a3.dataset.level || '1');
          if(l3 <= subLvl) break;
          rows[j].style.display = 'none';
        }
      }
    }
  }
}

function toggleAllPageTOC(expand){
  const rows = qsa('#page-toc .toc-row');
  rows.forEach(row=>{
    row.style.display = '';
    const caret = row.querySelector('.toc-fold');
    if(caret){
      caret.dataset.state = expand ? 'expanded' : 'collapsed';
      caret.textContent   = expand ? '▾' : '▸';
    }
  });

  if(!expand){
    // 全收起：仅保留第 1 级（或你希望的某一级）可见
    rows.forEach(row=>{
      const lvl = Number(row.querySelector('a').dataset.level || '1');
      row.style.display = (lvl === 1) ? '' : 'none';
    });
  }
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
