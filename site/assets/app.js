/* app.js — v0.235.1 hotfix */

let currentDocPath = null;
let currentHeadings = [];
let scrollSpy = null;
let searchHits = [];
let searchIndex = -1;

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

// 路径兜底：没有 content/ 前缀就补齐
const resolveDocURL = (p)=> /^content\//.test(p) ? p : ('content/' + p);

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
  if(mode==='filetree'){ ft.style.display=''; pt.style.display='none'; title.textContent='文档/目录'; }
  else { ft.style.display='none'; pt.style.display=''; title.textContent='本页目录'; }
}

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

function renderTree(nodes, container){
  nodes.forEach(node=>{
    if(node.type==='dir'){
      const wrap = document.createElement('div'); wrap.className='dir';
      const header = document.createElement('div'); header.className='header';
      const caret = document.createElement('span'); caret.textContent='▾'; caret.style.width='1em'; caret.style.display='inline-block';
      const label = document.createElement('span'); label.textContent=node.name; label.style.fontWeight='600';
      const box = document.createElement('div'); box.className='children';
      header.appendChild(caret); header.appendChild(label);
      wrap.appendChild(header); wrap.appendChild(box);
      let open = true;
      header.addEventListener('click', ()=>{ open=!open; box.style.display=open?'':'none'; caret.textContent=open?'▾':'▸'; });
      renderTree(node.children||[], box);
      container.appendChild(wrap);
    }else if(node.type==='file'){
      const a = document.createElement('a');
      a.className='file';
      const docPath = node.path || '';
      a.textContent = (node.title || node.name || '').replace(/\.md$/i,'');
      const hrefPath = resolveDocURL(docPath);
      a.href = '#doc=' + encodeURIComponent(hrefPath);
      container.appendChild(a);
    }
  });
}

async function mountFileTree(){
  const container = qs('#filetree'); container.innerHTML = '';
  try{
    const tree = await fetchJSON('index/tree.json?ts='+Date.now());
    if(Array.isArray(tree) && tree.length){ renderTree(tree, container); return; }
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
  }catch(e){
    container.innerHTML = '<div style="color:#b91c1c">目录加载失败（tree/docs 均不可用）。</div>';
  }
}

const slugify = (t)=> t.trim().replace(/\s+/g,'-')
  .replace(/[。.．、,，；;：:（）()\[\]《》<>\/？?!—\-]+/g,'-')
  .replace(/-+/g,'-').replace(/^-|-$/g,'');

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
    a.style.marginLeft = Math.max(0,lvl-1)*10+'px';
    a.addEventListener('click', e=>{
      e.preventDefault();
      document.getElementById(h.id).scrollIntoView({behavior:'smooth', block:'start'});
      history.replaceState(null,'','#'+h.id);
    });
    frag.appendChild(a);
  });
  pt.appendChild(frag);
  setSidebarMode('pagetoc');
  mountScrollSpy();
}

function mountScrollSpy(){
  if(scrollSpy) scrollSpy.disconnect();
  const links = qsa('#page-toc a');
  const map = new Map(links.map(a=>[a.getAttribute('href').slice(1), a]));
  scrollSpy = new IntersectionObserver(entries=>{
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

async function renderDocument(path){
  currentDocPath = path;
  const url = resolveDocURL(path);
  const raw = await fetch(url).then(r=>r.text());
  const html = marked.parse(raw);
  qs('#viewer').innerHTML = html;
  renderBreadcrumb(path);
  buildPageTOC();
  clearSearch();
}

// 全文搜索：当前文档、多命中 + 上下跳转
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
  setSidebarCollapsed(false); // 默认展开，不做记忆

  qs('#toc-mode').addEventListener('click', ()=>{
    setSidebarMode(sidebarMode==='filetree'?'pagetoc':'filetree');
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
