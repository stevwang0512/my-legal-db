async function loadDocs(){
  const res = await fetch('index/manifest.json');
  const m = await res.json();
  const ul = document.getElementById('doclist');
  ul.innerHTML = '';
  // 初始：展示仓库中的文档列表（点开后左侧会替换为“本页目录”）
  for(const doc of m.docs){
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href='#'; a.textContent = doc.title || doc.id;
    a.addEventListener('click', async (e)=>{
      e.preventDefault();
      const md = await fetch('content/'+doc.path).then(r=>r.text());
      renderMarkdown(md);
      window.history.replaceState(null,'', '#doc='+encodeURIComponent(doc.path));
    });
    li.appendChild(a); ul.appendChild(li);
  }
  window.__MANIFEST__ = m;

  // 如果地址栏已有 doc hash，自动打开
  const match = location.hash.match(/#doc=([^&]+)/);
  if(match){
    const path = decodeURIComponent(match[1]);
    const md = await fetch('content/'+path).then(r=>r.text());
    renderMarkdown(md);
  }
}

function stripFrontMatter(md){
  const m = md.match(/^---[\s\S]*?---\n?/); return m ? md.slice(m[0].length) : md;
}
function slugify(text){
  return text.trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fa5]+/gu,'-')
    .replace(/^-+|-+$/g,'');
}

function renderMarkdown(md){
  const body = stripFrontMatter(md);
  const html = window.marked.parse(body);
  const viewer = document.getElementById('viewer');
  viewer.innerHTML = html;

  // 给 h1/h2/h3 加 ID
  const hs = Array.from(viewer.querySelectorAll('h1, h2, h3'));
  const idCount = {};
  hs.forEach(h=>{
    let base = slugify(h.textContent);
    if(!base) base = 'sec';
    if(idCount[base]) idCount[base]++; else idCount[base]=1;
    const id = idCount[base]>1 ? `${base}-${idCount[base]}` : base;
    h.id = id;
  });

  // 构建左侧：当前文档的“可点击目录”
  buildDocTOC(hs);

  // 滚动联动高亮（进入视口就高亮）
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(en=>{ if(en.isIntersecting) setActiveTOC(en.target.id); });
  }, { rootMargin:'0px 0px -70% 0px', threshold:[0,1] });
  hs.forEach(h=>io.observe(h));

  // 如果地址栏有锚点，滚动到位
  if(location.hash && !location.hash.startsWith('#doc=')){
    const id = location.hash.slice(1);
    const el = document.getElementById(id);
    if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
  }
}

function buildDocTOC(headings){
  const ul = document.getElementById('doclist');
  ul.innerHTML = ''; // 左侧切换为“本页目录”
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
  // 默认激活第一项
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

// —— 下面保留“占位搜索”，验证链路；后面换成真·全文索引 —— //
async function search(query){
  const res = await fetch('index/route.json').then(r=>r.json());
  const shards = res.shards || ['shard_00.json'];
  const hits = [];
  for(const s of shards){
    const data = await fetch('index/'+s).then(r=>r.json());
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
      const md = await fetch('content/'+h.path).then(r=>r.text());
      renderMarkdown(md);
      window.history.replaceState(null,'', '#doc='+encodeURIComponent(h.path));
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
