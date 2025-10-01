/* app.js — v0.28-stable (clean rebuild)
 * Goals:
 * - Stable file tree even when index/tree.json missing (fallback to index/docs.json)
 * - Consistent path handling (always "content/..." on disk & in URLs)
 * - Robust page TOC: default show H1 and only immediate children; reliable folding, esp. near tail levels
 * - Smooth scroll + scroll spy that can be temporarily locked when user clicks TOC
 * - Sidebar gutter drag with width persistence
 * - Mobile (<=768px) compact mode for page TOC
 */

// ---------- tiny DOM helpers ----------
const qs  = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

let state = {
  currentDocPath: null,
  headings: [],
  scrollSpy: null,
  manualActiveId: null,
  lockScrollSpy: false,
  filetreeExpandedAll: false,
  pagetocExpandedAll: true,
};

// ---------- URL & fetch helpers ----------
const resolveDocURL = (p)=> /^content\//.test(p) ? p : ('content/' + p);
const stripOrderPrefix = (s)=> s.replace(/^\d+[-_. ]+/, '');

async function fetchJSON(url){
  const r = await fetch(url, {cache: 'no-cache'});
  if(!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

function normalizeHash(){
  const m = (location.hash||'').match(/#doc=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ---------- sidebar & layout ----------
function setSidebarCollapsed(collapsed){
  document.body.classList.toggle('sb-collapsed', !!collapsed);
  const btn = qs('#toc-toggle');
  if(btn) btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
}

function bindLayout(){
  const btn = qs('#toc-toggle');
  if(btn){
    btn.addEventListener('click', ()=>{
      const now = document.body.classList.contains('sb-collapsed');
      setSidebarCollapsed(!now);
    });
  }

  // gutter drag
  const gutter = qs('#gutter');
  const sidebar = qs('#sidebar');
  if(gutter && sidebar){
    const minW = 160, maxW = 560;
    function onMove(e){
      const x = e.clientX;
      const w = Math.max(minW, Math.min(maxW, x));
      sidebar.style.width = `${w}px`;
      localStorage.setItem('tocWidth', String(w));
      e.preventDefault();
    }
    function onUp(){
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    gutter.addEventListener('mousedown', (e)=>{
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
    // restore
    const saved = parseInt(localStorage.getItem('tocWidth')||'', 10);
    if(!isNaN(saved)) sidebar.style.width = `${saved}px`;
  }

  applyMobileTOCMode();
  window.addEventListener('resize', debounce(applyMobileTOCMode, 150));
}

function applyMobileTOCMode(){
  const pt = qs('#page-toc');
  if(!pt) return;
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  pt.classList.toggle('compact', isMobile);
}

function debounce(fn, wait){
  let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); };
}

// ---------- file tree ----------
function renderDirTree(nodes, container){
  nodes.forEach(node=>{
    if(node.type==='dir'){
      const wrap   = document.createElement('div');  wrap.className = 'dir';
      const header = document.createElement('div');  header.className = 'header';
      const caret  = document.createElement('span'); caret.className = 'caret'; caret.textContent = '►';
      const label  = document.createElement('span'); label.className = 'name'; label.textContent = node.name;
      header.appendChild(caret); header.appendChild(label);
      wrap.appendChild(header);
      const childrenBox = document.createElement('div'); childrenBox.className = 'children'; childrenBox.style.display = 'none';
      wrap.appendChild(childrenBox);
      header.addEventListener('click', ()=>{
        const open = childrenBox.style.display === 'none';
        childrenBox.style.display = open ? '' : 'none';
        caret.textContent = open ? '▼' : '►';
      });
      container.appendChild(wrap);
      renderDirTree(node.children||[], childrenBox);
    }else if(node.type==='file'){
      const a = document.createElement('a');
      a.className = 'file';
      a.textContent = node.title || stripOrderPrefix(node.name || '');
      const p = node.path || node.url || node.name;
      const url = resolveDocURL(p);
      a.dataset.path = url;
      a.href = `#doc=${encodeURIComponent(url)}`;
      a.addEventListener('click', (e)=>{
        e.preventDefault();
        location.hash = `#doc=${encodeURIComponent(url)}`;
        renderDocument(url).catch(console.error);
      });
      container.appendChild(a);
    }
  });
}

function toggleAllFiletree(open){
  qsa('#filetree .dir').forEach(dir=>{
    const box = qs('.children', dir);
    const caret = qs('.caret', dir);
    if(box){
      box.style.display = open ? '' : 'none';
      if(caret) caret.textContent = open ? '▼' : '►';
    }
  });
}

async function mountFileTree(){
  const container = qs('#filetree'); container.innerHTML='加载目录…';
  // First try hierarchical tree
  try{
    const tree = await fetchJSON('index/tree.json?ts=' + Date.now());
    container.innerHTML = ''; renderDirTree(tree, container);
    toggleAllFiletree(false); state.filetreeExpandedAll = false;
    return;
  }catch(e){
    console.warn('tree.json not found', e);
  }
  // Fallback to docs list
  try{
    const docs = await fetchJSON('index/docs.json?ts=' + Date.now());
    container.innerHTML='';
    const nodes = (docs.docs||[]).map(d=>{
      const p = resolveDocURL(d.path || d.title || '');
      return {type:'file', title:d.title||p.split('/').pop(), path:p};
    });
    renderDirTree([{type:'dir', name:'全部文档', children:nodes}], container);
    toggleAllFiletree(false); state.filetreeExpandedAll = false;
  }catch(e){
    container.innerHTML = '<div style="color:#b91c1c">目录加载失败（index/tree.json 与 index/docs.json 均不可用）。请先运行 scripts/build_site.py 生成索引。</div>';
  }

  const toggleBtn = qs('#toggle-all');
  if(toggleBtn){
    toggleBtn.addEventListener('click', ()=>{
      const open = !state.filetreeExpandedAll;
      toggleAllFiletree(open);
      state.filetreeExpandedAll = open;
      toggleBtn.textContent = open ? '收起全部' : '展开全部';
    });
  }
}

// ---------- viewer & page toc ----------
function slugify(t){
  return t.trim().replace(/\s+/g,'-')
    .replace(/[。.．、,，；;：:（）()\\[\\]《》<>\\/？?!—\\-]+/g,'-')
    .replace(/-+/g,'-').replace(/^-|-$/g,'');
}

function clearSectionHighlight(){
  qsa('.section-highlight', qs('#viewer')).forEach(el=>el.classList.remove('section-highlight'));
}

function applyManualHighlight(id){
  clearSectionHighlight();
  const target = qs(`#${CSS.escape(id)}`, qs('#viewer'));
  if(!target) return;
  let el = target.nextElementSibling;
  while(el){
    if(/^H[1-6]$/.test(el.tagName)) break;
    el.classList.add('section-highlight');
    el = el.nextElementSibling;
  }
  const link = qs(`#page-toc a[data-id="${id}"]`);
  if(link){
    qsa('#page-toc a.active').forEach(a=>a.classList.remove('active'));
    link.classList.add('active','locked');
    state.manualActiveId = id; state.lockScrollSpy = true;
    setTimeout(()=>{ state.lockScrollSpy=false; qsa('#page-toc a.locked').forEach(a=>a.classList.remove('locked')); }, 800);
  }
}

function buildPageTOC(){
  const viewer = qs('#viewer');
  const headings = qsa('h1,h2,h3,h4,h5,h6', viewer);
  const pt = qs('#page-toc'); pt.innerHTML='';
  if(!headings.length){ pt.textContent='（本页无标题）'; return; }

  // Build flat rows with level and id
  const rows = headings.map((h, i)=>{
    const level = Number(h.tagName.substring(1));
    if(!h.id){ h.id = slugify(h.textContent || ('h'+i)); }
    return {el:h, level, id:h.id, text: h.textContent.trim()};
  });
  state.headings = rows;

  const frag = document.createDocumentFragment();
  rows.forEach((row, idx)=>{
    const wrap = document.createElement('div'); wrap.className = 'toc-row'; wrap.dataset.index = String(idx);

    // determine if has children: next row has higher level
    const next = rows[idx+1]; const hasChild = !!(next && next.level > row.level);
    if(hasChild){
      const fold = document.createElement('span'); fold.className='toc-fold'; fold.textContent='►'; fold.dataset.state='collapsed';
      fold.addEventListener('click', (e)=>{
        e.stopPropagation(); toggleTOCSection(idx);
      });
      wrap.appendChild(fold);
    }else{
      const pad = document.createElement('span'); pad.className='toc-fold pad'; pad.textContent=''; wrap.appendChild(pad);
    }

    const a = document.createElement('a'); a.textContent = row.text; a.href = `#${row.id}`; a.dataset.id = row.id; a.dataset.level = String(row.level);
    a.style.marginLeft = `${(row.level-1)*12}px`;
    a.addEventListener('click', (e)=>{
      e.preventDefault();
      document.getElementById(row.id)?.scrollIntoView({behavior:'smooth', block:'center'});
      applyManualHighlight(row.id);
    });
    wrap.appendChild(a);
    frag.appendChild(wrap);
  });
  pt.appendChild(frag);

  // default: show only h1 and its direct children
  collapsePageTOCToLevel(2);
  state.pagetocExpandedAll = false;

  // Toggle button for page toc
  const btn = qs('#pt-toggle-all');
  if(btn){
    btn.addEventListener('click', ()=>{
      const open = !state.pagetocExpandedAll;
      if(open){ collapsePageTOCToLevel(6); } else { collapsePageTOCToLevel(2); }
      state.pagetocExpandedAll = open;
      btn.textContent = open ? '收起全部' : '展开全部';
    });
  }

  mountScrollSpy();
}

function collapsePageTOCToLevel(L){
  const rows = qsa('#page-toc .toc-row');
  rows.forEach(row=>{
    const a = qs('a', row);
    const level = Number(a?.dataset.level || '1');
    const fold = qs('.toc-fold', row);
    if(level<=L){ row.style.display=''; if(fold) fold.dataset.state='expanded', fold.textContent='▼'; }
    else{ row.style.display='none'; if(fold) fold.dataset.state='collapsed', fold.textContent='►'; }
  });
  // ensure parents of shown items are visible
  for(let i=rows.length-1;i>=0;i--){
    const row = rows[i];
    if(row.style.display===''){
      let lvl = Number(qs('a', row)?.dataset.level||'1');
      for(let j=i-1;j>=0;j--){
        const prev = rows[j];
        const pl = Number(qs('a', prev)?.dataset.level||'1');
        if(pl < lvl){ prev.style.display=''; const f=qs('.toc-fold', prev); if(f){ f.dataset.state='expanded'; f.textContent='▼'; } lvl = pl; }
        if(pl===1) break;
      }
    }
  }
}

function toggleTOCSection(idx){
  const rows = state.headings;
  const baseLvl = rows[idx].level;
  const tocRows = qsa('#page-toc .toc-row');
  // compute end boundary: next item with level <= baseLvl
  let end = tocRows.length;
  for(let i=idx+1;i<rows.length;i++){ if(rows[i].level<=baseLvl){ end=i; break; } }

  const cur = tocRows[idx];
  const caret = qs('.toc-fold', cur);
  const willCollapse = caret && caret.dataset.state==='expanded';
  if(willCollapse){
    // hide all descendants
    for(let i=idx+1;i<end;i++){ tocRows[i].style.display='none'; const c=qs('.toc-fold', tocRows[i]); if(c){ c.dataset.state='collapsed'; c.textContent='►'; } }
    if(caret){ caret.dataset.state='collapsed'; caret.textContent='►'; }
  }else{
    // show only direct children (level = base+1)
    for(let i=idx+1;i<end;i++){
      const level = rows[i].level;
      tocRows[i].style.display = (level===baseLvl+1) ? '' : 'none';
      const c=qs('.toc-fold', tocRows[i]); if(c){ c.dataset.state = (level===baseLvl+1)?'expanded':'collapsed'; c.textContent = (level===baseLvl+1)?'▼':'►'; }
    }
    if(caret){ caret.dataset.state='expanded'; caret.textContent='▼'; }
  }
}

// ---------- scroll spy ----------
function mountScrollSpy(){
  if(state.scrollSpy){ state.scrollSpy.disconnect(); state.scrollSpy=null; }
  const options = { root: qs('#viewer'), rootMargin: '0px 0px -70% 0px', threshold: [0, 1.0] };
  const io = new IntersectionObserver((entries)=>{
    if(state.lockScrollSpy) return;
    for(const entry of entries){
      if(entry.isIntersecting && entry.intersectionRatio>0){
        const id = entry.target.id;
        qsa('#page-toc a.active').forEach(a=>a.classList.remove('active'));
        const link = qs(`#page-toc a[data-id="${CSS.escape(id)}"]`);
        if(link) link.classList.add('active');
      }
    }
  }, options);
  state.headings.forEach(h=> io.observe(document.getElementById(h.id)));
  state.scrollSpy = io;
}

// ---------- render document ----------
async function renderDocument(path){
  const url = resolveDocURL(path);
  state.currentDocPath = url;
  const viewer = qs('#viewer');
  viewer.innerHTML = '加载中…';
  try{
    const raw = await fetch(url, {cache: 'no-cache'}).then(r=>{ if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });
    viewer.innerHTML = marked.parse(raw);
  }catch(e){
    viewer.innerHTML = `<div style="color:#b91c1c">加载失败：${e.message}（${url}）</div>`;
    console.error(e);
    return;
  }
  buildPageTOC();
  markActiveFile(url);
  renderBreadcrumb(url);
}

function markActiveFile(path){
  qsa('#filetree a.file.active').forEach(a=>a.classList.remove('active'));
  const a = qs(`#filetree a.file[data-path="${CSS.escape(path)}"]`);
  if(a) a.classList.add('active');
}

function renderBreadcrumb(path){
  const bc = qs('#breadcrumb'); if(!bc) return;
  bc.innerHTML = '';
  const clean = path.replace(/^content\\//, '');
  const parts = clean.split('/');
  const names = parts.slice(0, -1);
  const file  = parts[parts.length-1];
  const mk = (txt, p)=>{ const a=document.createElement('a'); a.textContent=txt; if(p){ a.href=`#doc=${encodeURIComponent('content/'+p)}`; a.addEventListener('click', (e)=>{ e.preventDefault(); renderDocument('content/'+p); }); } return a; };
  let acc = '';
  names.forEach((n,i)=>{
    acc += (i?'/':'') + n;
    bc.appendChild(mk(stripOrderPrefix(n), acc));
    bc.appendChild(document.createTextNode(' / '));
  });
  bc.appendChild(mk(stripOrderPrefix(file), null));
}

// ---------- init ----------
async function init(){
  bindLayout();
  await mountFileTree();
  const target = normalizeHash();
  if(target) renderDocument(target).catch(console.error);
  window.addEventListener('hashchange', ()=>{
    const t = normalizeHash();
    if(t) renderDocument(t).catch(console.error);
  });
}

document.addEventListener('DOMContentLoaded', init);
