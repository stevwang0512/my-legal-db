// ========== 新增：侧栏整体折叠/展开 ==========
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

// 初始应用一次（确保第一次加载就根据上次状态显示）
applySidebarState();

async function loadDocs(){
  // 防缓存：每次拿最新清单
  const res = await fetch('index/manifest.json?ts=' + Date.now());
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
  window.__MANIFEST__ = m;

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

  // 初始化侧栏开关（放到最后，确保按钮已渲染）
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

  // 给 h1/h2/h3 加 ID
  const hs = Array.from(viewer.querySelectorAll('h1, h2, h3'));
  const idCount = {};
  hs.forEach(h=>{
    let base = slugify(h.textContent) || 'sec';
    if(idCount[base]) idCount[base]++; else idCount[base]=1;
    const id = idCount[base]>1 ? `${base}-${idCount[base]}` : base;
    h.id = id;
  });

  buildDocTOC(hs, docPath);

  // 滚动联动高亮
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(en=>{ if(en.isIntersecting) setActiveTOC(en.target.id); });
  }, { rootMargin:'0px 0px -70% 0px', threshold:[0,1] });
  hs.forEach(h=>io.observe(h));

  // 外部锚点
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

  const groups = []; // {title, id, open, children: [{text,id,level}]}
  let current = null;

  headings.forEach(h=>{
    const level = parseInt(h.tagName.substring(1), 10);
    if(level===1){
      current = { title: h.textContent, id: h.id, open: true, children: [] };
      groups.push(current);
    }else{
      if(!current){
        current = { title: '内容', id: 'content', open: true, children: [] };
        groups.push(current);
      }
      current.children.push({ text: h.textContent, id: h.id, level });
    }
  });

  // 渲染 details 分组
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
      const a = document.createElement('a');
      a.textContent = c.text;
      a.href = `#${c.id}`;
      a.addEventListener('click', (e)=>{
        e.preventDefault();
        document.getElementById(c.id).scrollIntoView({behavior:'smooth', block:'start'});
        setActiveTOC(c.id);
        history.replaceState(null,'',`#${c.id}`);
      });
      li.appendChild(a);
      children.appendChild(li);
    });
    d.appendChild(children);

    // 保存展开状态
    d.addEventListener('toggle', ()=>{
      saved[g.id] = d.open;
      localStorage.setItem(stateKey, JSON.stringify(saved));
    });

    const liWrap = document.createElement('li');
    liWrap.appendChild(d);
    ul.appendChild(liWrap);
  });

  // 展开/收起全部
  const btn = document.getElementById('toggleAll');
  btn.textContent = areAllOpen(ul) ? '收起全部' : '展开全部';
  btn.onclick = ()=>{
    const allOpen = areAllOpen(ul);
    ul.querySelectorAll('details').forEach(det=>det.open = !allOpen);
    // 同步保存
    const all = {};
    ul.querySelectorAll('details').forEach(det=>{
      // 取第一个链接的 id 前缀作为 key（简单且稳定）
      const firstLink = det.querySelector('a');
      const groupId = firstLink ? firstLink.getAttribute('href').slice(1).split('-')[0] : Math.random().toString(36).slice(2);
      all[groupId] = det.open;
    });
    localStorage.setItem(stateKey, JSON.stringify(all));
    btn.textContent = areAllOpen(ul) ? '收起全部' : '展开全部';
  };

  // 默认高亮第一条
  const firstLink = ul.querySelector('a');
  if(firstLink) firstLink.classList.add('active');
}

function areAllOpen(container){
  const arr = Array.from(container.querySelectorAll('details'));
  return arr.length>0 && arr.every(d=>d.open);
}

function setActiveTOC(id){
  document.querySelectorAll('#toc a').forEach(a=>a.classList.remove('active'));
  const link = document.querySelector(`#toc a[href="#${CSS.escape(id)}"]`);
  if(link){
    link.classList.add('active');
    link.scrollIntoView({block:'nearest'});
  }
}

// —— 保留占位搜索，后续换真·全文索引 —— //
async function search(query){
  const res = await fetch('index/route.json?ts=' + Date.now()).then(r=>r.json());
  const shards = res.shards || ['shard_00.json'];
  const hits = [];
  for(const s of shards){
    const data = await fetch('index/'+s+'?ts='+Date.now()).then(r=>r.json());
    const stub = new Function('q', 'return ('+data.search+')(q)');
    for(const h of stub(query)){
      hits.push(h);
      if(hits.length>200) break;
    }
    if(hits.length>200) break;
  }
  const box = document.getElementById('results');
  box.innerHTML = '<h3>搜索结果</h3>';
  for(const h of hits){
    const div = document.createElement('div'); div.className='item';
    div.textContent = h.title+' —— '+h.snippet;
    div.addEventListener('click', async ()=>{
      try{
        const md = await fetch('content/'+h.path).then(r=>r.text());
        renderMarkdown(md, h.path);
        window.history.replaceState(null,'', '#doc='+encodeURIComponent(h.path));
      }catch(err){
        alert('搜索结果对应的文档不存在，清单已刷新');
        await loadDocs();
      }
    });
    box.appendChild(div);
  }
}
document.getElementById('q').addEventListener('input', e=>{
  const q = e.target.value.trim();
  if(q.length===0){ document.getElementById('results').innerHTML=''; return; }
  search(e.target.value.trim());
});

loadDocs();
