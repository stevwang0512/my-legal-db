// ========== 侧栏整体折叠（保持不变） ==========
const SB_KEY = 'sidebar-collapsed';
function applySidebarState(){
  const collapsed = localStorage.getItem(SB_KEY) === '1';
  document.body.classList.toggle('sb-collapsed', collapsed);
  const btn = document.getElementById('sidebarToggle');
  if(btn) btn.textContent = (collapsed ? '▶ 展开侧栏' : '☰ 侧栏');
}
function initSidebarToggle(){
  const btn = document.getElementById('sidebarToggle');
  if(!btn) return;
  btn.onclick = ()=>{
    const collapsed = !(localStorage.getItem(SB_KEY) === '1');
    localStorage.setItem(SB_KEY, collapsed ? '1' : '0');
    applySidebarState();
  };
}
applySidebarState();

// ========== 文档清单 / 渲染 / 目录折叠（保持不变） ==========
async function loadDocs(){
  // 读 docs.json（注意：升级后清单文件改为 docs.json）
  const res = await fetch('index/docs.json?ts=' + Date.now());
  const m = await res.json();
  const ul = document.getElementById('doclist');
  ul.innerHTML = '';

  for(const doc of m.docs){
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href='#'; a.textContent = doc.title || doc.id;
    a.addEventListener('click', async (e)=>{
      e.preventDefault();
      try{
        const resp = await fetch('content/'+doc.path);
        if(!resp.ok) throw new Error('not found');
        const md = await resp.text();
        renderMarkdown(md, doc.path);
        window.history.replaceState(null,'', '#doc='+encodeURIComponent(doc.path));
      }catch(err){
        alert('该文档已不存在（可能刚被删除）。我已刷新目录。');
        await loadDocs();
      }
    });
    li.appendChild(a); ul.appendChild(li);
  }
  window.__DOCS__ = m.docs;

  const match = location.hash.match(/#doc=([^&]+)/);
  if(match){
    const path = decodeURIComponent(match[1]);
    try{
      const md = await fetch('content/'+path).then(r=>r.text());
      renderMarkdown(md, path);
    }catch(err){
      console.warn('文档已不存在:', path);
    }
  }
  initSidebarToggle();
}

function stripFrontMatter(md){
  const m = md.match(/^---[\s\S]*?---\n?/); return m ? md.slice(m[0].length) : md;
}
function slugify(text){
  return text.trim().toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fa5]+/gu,'-')
    .replace(/^-+|-+$/g,'');
}
function renderMarkdown(md, docPath){
  const body = stripFrontMatter(md);
  const html = window.marked.parse(body);
  const viewer = document.getElementById('viewer');
  viewer.innerHTML = html;

  const hs = Array.from(viewer.querySelectorAll('h1, h2, h3'));
  const idCount = {};
  hs.forEach(h=>{
    let base = slugify(h.textContent) || 'sec';
    if(idCount[base]) idCount[base]++; else idCount[base]=1;
    const id = idCount[base]>1 ? `${base}-${idCount[base]}` : base;
    h.id = id;
  });
  buildDocTOC(hs, docPath);

  const io = new IntersectionObserver((entries)=>{
    entries.forEach(en=>{ if(en.isIntersecting) setActiveTOC(en.target.id); });
  }, { rootMargin:'0px 0px -70% 0px', threshold:[0,1] });
  hs.forEach(h=>io.observe(h));

  if(location.hash && !location.hash.startsWith('#doc=')){
    const id = location.hash.slice(1);
    const el = document.getElementById(id);
    if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
  }
}
function buildDocTOC(headings, docPath){
  const ul = document.getElementById('doclist');
  ul.innerHTML = '';
  const stateKey = 'toc-state:' + (docPath || 'default');
  let saved = {};
  try{ saved = JSON.parse(localStorage.getItem(stateKey) || '{}'); }catch(e){}
  const groups = []; let current = null;
  headings.forEach(h=>{
    const level = parseInt(h.tagName.substring(1), 10);
    if(level===1){ current = { title: h.textContent, id: h.id, open: true, children: [] }; groups.push(current); }
    else{ if(!current){ current = { title: '内容', id: 'content', open: true, children: [] }; groups.push(current); }
          current.children.push({ text: h.textContent, id: h.id, level }); }
  });
  groups.forEach((g)=>{
    const d = document.createElement('details');
    const openSaved = saved[g.id];
    d.open = typeof openSaved === 'boolean' ? openSaved : true;
    const sum = document.createElement('summary');
    const caret = document.createElement('span'); caret.className='caret'; caret.textContent='▸';
    const title = document.createElement('span'); title.textContent = g.title;
    sum.appendChild(caret); sum.appendChild(title);
    d.appendChild(sum);
    const children = document.createElement('div'); children.className='children';
    g.children.forEach(c=>{
      const li = document.createElement('div');
      li.style.marginLeft = (c.level===2? '0px':'12px');
      const a = document.createElement('a'); a.textContent = c.text; a.href = `#${c.id}`;
      a.addEventListener('click', (e)=>{
        e.preventDefault();
        document.getElementById(c.id).scrollIntoView({behavior:'smooth', block:'start'});
        setActiveTOC(c.id);
        history.replaceState(null,'',`#${c.id}`);
      });
      li.appendChild(a); children.appendChild(li);
    });
    d.appendChild(children);
    d.addEventListener('toggle', ()=>{
      saved[g.id] = d.open;
      localStorage.setItem(stateKey, JSON.stringify(saved));
    });
    const liWrap = document.createElement('li'); liWrap.appendChild(d); ul.appendChild(liWrap);
  });
  const btn = document.getElementById('toggleAll');
  btn.textContent = areAllOpen(ul) ? '收起全部' : '展开全部';
  btn.onclick = ()=>{
    const allOpen = areAllOpen(ul);
    ul.querySelectorAll('details').forEach(det=>det.open = !allOpen);
    const all = {};
    ul.querySelectorAll('details').forEach(det=>{
      const firstLink = det.querySelector('a');
      const groupId = firstLink ? firstLink.getAttribute('href').slice(1).split('-')[0] : Math.random().toString(36).slice(2);
      all[groupId] = det.open;
    });
    localStorage.setItem(stateKey, JSON.stringify(all));
    btn.textContent = areAllOpen(ul) ? '收起全部' : '展开全部';
  };
  const firstLink = ul.querySelector('a'); if(firstLink) firstLink.classList.add('active');
}
function areAllOpen(container){ const arr = Array.from(container.querySelectorAll('details')); return arr.length>0 && arr.every(d=>d.open); }
function setActiveTOC(id){
  document.querySelectorAll('#toc a').forEach(a=>a.classList.remove('active'));
  const link = document.querySelector(`#toc a[href="#${CSS.escape(id)}"]`);
  if(link){ link.classList.add('active'); link.scrollIntoView({block:'nearest'}); }
}

// ========== 真·全文搜索：加载倒排索引、评分、摘要 ==========
let __INDEX__ = null; // {postings: { token: [[doc_id, tf], ...] }}
async function ensureIndex(){
  if(__INDEX__) return __INDEX__;
  const route = await fetch('index/route.json?ts='+Date.now()).then(r=>r.json());
  // 当前模式：单文件索引
  const file = (route.files && route.files[0]) || 'shard_all.json';
  __INDEX__ = await fetch('index/'+file+'?ts='+Date.now()).then(r=>r.json());
  // 同时加载 docs.json，便于映射 doc_id -> (title, path)
  if(!window.__DOCS__){
    const d = await fetch('index/docs.json?ts='+Date.now()).then(r=>r.json());
    window.__DOCS__ = d.docs;
  }
  return __INDEX__;
}

function tokenizeQuery(q){
  q = q.trim();
  if(!q) return [];
  // 简易策略：保留原词；同时补充按字符切分的 2-gram（提升中文召回）
  const toks = new Set([q]);
  const chars = Array.from(q);
  for(let i=0;i<chars.length-1;i++){
    toks.add(chars[i]+chars[i+1]);
  }
  return Array.from(toks).filter(s=>s.length>0);
}

function docMetaById(id){
  return (window.__DOCS__ || []).find(d=>d.id===id);
}

async function fetchSnippet(docPath, query){
  // 拉取文档原文，定位 query 第一次出现，截取前后 60 字
  try{
    const md = await fetch('content/'+docPath+'?ts='+Date.now()).then(r=>r.text());
    const body = stripFrontMatter(md);
    const i = body.indexOf(query);
    if(i>=0){
      const start = Math.max(0, i-60);
      const end = Math.min(body.length, i+query.length+60);
      let snip = body.slice(start, end).replace(/\n/g,' ');
      return snip;
    }
    // fallback：取开头一段
    return body.slice(0, 120).replace(/\n/g,' ');
  }catch(e){
    return '(无法读取文档内容)';
  }
}

async function search(query){
  const q = query.trim();
  const box = document.getElementById('results');
  if(q.length===0){ box.innerHTML=''; return; }

  const idx = await ensureIndex();
  const tokens = tokenizeQuery(q);

  // 召回：合并这些 token 的倒排列表
  const scores = new Map(); // doc_id -> score
  const hitTokens = new Map(); // doc_id -> Set(tokens)
  for(const t of tokens){
    const pl = idx.postings[t];
    if(!pl) continue;
    for(const [doc_id, tf] of pl){
      const prev = scores.get(doc_id)||0;
      scores.set(doc_id, prev + Math.log(1+tf)); // 简单 tf 打分
      if(!hitTokens.has(doc_id)) hitTokens.set(doc_id, new Set());
      hitTokens.get(doc_id).add(t);
    }
  }

  // 排序（得分高在前）
  const ranked = Array.from(scores.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 20);

  // 渲染结果：标题 + 摘要；点击打开文档
  box.innerHTML = '<h3>搜索结果</h3>';
  if(ranked.length===0){
    box.innerHTML += '<div>未找到匹配结果</div>'; 
    return;
  }

  // 生成列表（并异步补充摘要）
  for(const [doc_id, score] of ranked){
    const meta = docMetaById(doc_id);
    if(!meta) continue;
    const div = document.createElement('div'); div.className='item';
    const title = meta.title || meta.path;
    div.innerHTML = `<div><strong>${title}</strong></div><div class="snippet">（载入摘要中…）</div>`;
    div.addEventListener('click', async ()=>{
      const md = await fetch('content/'+meta.path).then(r=>r.text());
      renderMarkdown(md, meta.path);
      window.history.replaceState(null,'', '#doc='+encodeURIComponent(meta.path));
    });
    box.appendChild(div);

    // 异步加载摘要（基于原文检索）
    fetchSnippet(meta.path, q).then(snip=>{
      const sn = div.querySelector('.snippet');
      if(sn) sn.innerHTML = highlight(snip, tokens);
    });
  }
}

function escapeHtml(s){ return s.replace(/[&<>"]/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m])); }
function highlight(text, tokens){
  if(!text) return '';
  let safe = escapeHtml(text);
  // 简单高亮：把 query tokens 包一层 <mark>
  tokens.sort((a,b)=>b.length-a.length).forEach(t=>{
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'g');
    safe = safe.replace(re, '<mark>$&</mark>');
  });
  return safe;
}

// 输入框绑定
document.getElementById('q').addEventListener('input', e=>{
  const q = e.target.value.trim();
  if(q.length===0){ document.getElementById('results').innerHTML=''; return; }
  search(q);
});

// 入口
loadDocs();
