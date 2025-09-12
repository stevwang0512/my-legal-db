async function loadDocs(){
  // 加时间戳参数避免缓存旧 manifest
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
        renderMarkdown(md);
        window.history.replaceState(null,'', '#doc='+encodeURIComponent(doc.path));
      }catch(err){
        alert('该文档已不存在（可能刚被删除）。我已刷新目录。');
        await loadDocs(); // 重新加载清单，移除残留项
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
      renderMarkdown(md);
    }catch(err){
      console.warn('文档已不存在:', path);
    }
  }
}

function stripFrontMatter(md){
  const m = md.match(/^---[\s\S]*?---\n?/); return m ? md.slice(m[0].length) : md;
}
function slugify(text){
  return text.trim().toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fa5]+/gu,'-')
    .replace(/^-+|-+$/g,'');
}

function renderMarkdown(md){
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

  buildDocTOC(hs);

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

function buildDocTOC(headings){
  const ul = document.getElementById('doclist');
  ul.innerHTML = '';
  let currentGroup = null;
  headings.forEach(h=>{
    const level = parseInt(h.tagName.substring(1), 10);
    if(level===1){
      currentGroup = document.createElement('li');
      currentGroup.innerHTML = `<strong>${h.textContent}</strong>`;
      ul.appendChild(currentGroup);
    }else{
      const li = document.createElement('li');
      li.style.listStyle = 'disc';
      li.style.marginLeft = (level===2? '18px':'28px');
      const a = document.createElement('a');
      a.textContent = h.textContent;
      a.href = `#${h.id}`;
      a.addEventListener('click', (e)=>{
        e.preventDefault();
        document.getElementById(h.id).scrollIntoView({behavior:'smooth', block:'start'});
        setActiveTOC(h.id);
        history.replaceState(null,'',`#${h.id}`);
      });
      li.appendChild(a);
      (currentGroup || ul).appendChild(li);
    }
  });
  const first = ul.querySelector('a');
  if(first) first.classList.add('active');
}

function setActiveTOC(id){
  document.querySelectorAll('#toc a').forEach(a=>a.classList.remove('active'));
  const link = document.querySelector(`#toc a[href="#${CSS.escape(id)}"]`);
  if(link){
    link.classList.add('active');
    link.scrollIntoView({block:'nearest'});
  }
}

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
        renderMarkdown(md);
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
  search(q);
});

loadDocs();
