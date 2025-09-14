/* app.js (v0.24)
 * 改动要点：
 * 1) 文件树支持 display（去数字前缀）展示；不再渲染“（该级文件）”分组
 * 2) 真·搜索栏布局：输入框自适应宽度，命中计数与上下跳按钮靠右
 * 3) 其余功能保持 v0.236 基线：加载 tree.json、渲染文件树、加载 md、页内全文搜索（所有命中、上下跳）
 */
(function(){
  const $ = (sel, root=document)=>root.querySelector(sel);
  const $$ = (sel, root=document)=>Array.from(root.querySelectorAll(sel));

  // —— CSS 注入：搜索栏布局（输入框伸展，计数与上下键靠右） ——
  const css = `
  #searchbar{ display:flex; align-items:center; gap:8px; }
  #q{ flex:1; min-width:140px; }
  #search-tools{ display:flex; align-items:center; gap:6px; margin-left:auto; }
  #hit-info{ font-size:12px; color:#666; }
  /* 左侧树 & 链接样式 */
  #doclist a.file{ display:block; padding:4px 6px; border-radius:4px; text-decoration:none; color:#111; }
  #doclist a.file:hover{ background:#eef5ff; }
  .dir>.header{ cursor:pointer; user-select:none; padding:3px 4px; border-radius:4px; }
  .dir>.header:hover{ background:#f5f7fa; }
  .dir .children{ margin-left:14px; }
  /* 隐藏“该级文件”旧节点防兼容（如果遗留） */
  .doc-files-group{ display:none !important; }
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  // —— 工具函数 ——
  function stripOrderPrefix(s){ return (s||'').replace(/^\d+[-_\. ]+/, ''); }
  function md(url){ return fetch(url).then(r=>{ if(!r.ok) throw new Error(r.status); return r.text(); }); }

  // —— 状态 ——
  let TREE = null;
  let hits = []; let hitIndex = -1;
  let currentDocPath = null;
  const viewer = $('#viewer');

  // —— 左侧：文件树 ——
  function renderTree(nodes, container){
    container.innerHTML = '';
    nodes.forEach(node=>{
      if(node.type==='dir'){
        const wrap = document.createElement('div'); wrap.className='dir';
        const header = document.createElement('div'); header.className='header';
        const caret = document.createElement('span'); caret.textContent='▸'; caret.style.width='1em'; caret.style.display='inline-block';
        const label = document.createElement('span'); label.textContent = (node.display || stripOrderPrefix(node.name));
        header.appendChild(caret); header.appendChild(label);
        const box = document.createElement('div'); box.className='children'; box.style.display='none';
        header.addEventListener('click', ()=>{
          const open = box.style.display !== 'none';
          box.style.display = open ? 'none' : '';
          caret.textContent = open ? '▸' : '▾';
        });
        wrap.appendChild(header); wrap.appendChild(box);
        renderTree(node.children||[], box);
        container.appendChild(wrap);
      }else if(node.type==='file'){
        const a = document.createElement('a'); a.className='file';
        const baseName = (node.display || node.title || node.name || '').replace(/\.md$/i,'');
        a.textContent = baseName;
        const hrefPath = /^content\//.test(node.path||'') ? node.path : ('content/'+(node.path||''));
        a.href = '#doc=' + encodeURIComponent(hrefPath);
        a.addEventListener('click', (e)=>{
          e.preventDefault();
          location.hash = 'doc=' + encodeURIComponent(hrefPath);
        });
        container.appendChild(a);
      }
    });
  }

  // —— 面包屑（可选：去前缀） ——
  function renderBreadcrumb(path){
    const bc = $('#breadcrumb'); if(!bc) return;
    bc.innerHTML = '';
    if(!path) return;
    const clean = path.replace(/^content\//,'');
    const parts = clean.split('/');
    const names = parts.slice(0,-1).map(stripOrderPrefix);
    const file  = stripOrderPrefix(parts[parts.length-1]).replace(/\.md$/i,'');
    const span = document.createElement('span');
    span.textContent = [...names, file].join(' / ');
    bc.appendChild(span);
  }

  // —— 渲染 markdown ——
  function renderMarkdown(mdText){
    viewer.innerHTML = marked.parse(mdText);
    // 清理旧命中
    hits = []; hitIndex = -1; updateHitUI();
  }

  // —— 载入文档 ——
  async function openDoc(docPath){
    currentDocPath = docPath;
    try{
      const txt = await md(docPath);
      renderMarkdown(txt);
      renderBreadcrumb(docPath);
    }catch(err){
      viewer.innerHTML = `<p style="color:#c00">载入失败：${String(err)}</p>`;
    }
  }

  // —— 搜索：命中全部、高亮、上下跳 ——
  function clearMarks(){
    $$('.mark-search-hit', viewer).forEach(el=>{
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });
  }
  function doSearch(q){
    clearMarks(); hits = []; hitIndex = -1;
    if(!q){ updateHitUI(); return; }
    const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT, null);
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi');
    const toWrap = [];
    while(walker.nextNode()){
      const node = walker.currentNode;
      if(!node.nodeValue.trim()) continue;
      const text = node.nodeValue;
      let m; let last = 0; let frag = document.createDocumentFragment(); let changed = false;
      while((m = re.exec(text))){
        changed = true;
        const before = text.slice(last, m.index);
        if(before) frag.appendChild(document.createTextNode(before));
        const mark = document.createElement('mark');
        mark.className = 'mark-search-hit';
        mark.textContent = m[0];
        frag.appendChild(mark);
        hits.push(mark);
        last = m.index + m[0].length;
      }
      if(changed){
        const tail = text.slice(last);
        if(tail) frag.appendChild(document.createTextNode(tail));
        toWrap.push([node, frag]);
      }
    }
    toWrap.forEach(([node, frag])=>node.parentNode.replaceChild(frag, node));
    if(hits.length){ hitIndex = 0; scrollToHit(hitIndex); }
    updateHitUI();
  }
  function scrollToHit(i){
    hits.forEach((el,idx)=>{ el.classList.toggle('mark-search-current', idx===i); });
    const el = hits[i]; if(!el) return;
    const rect = el.getBoundingClientRect();
    const top = rect.top + window.scrollY - 120;
    window.scrollTo({ top, behavior: 'smooth' });
  }
  function updateHitUI(){
    const info = $('#hit-info'); if(info) info.textContent = hits.length ? `${hitIndex+1}/${hits.length}` : '0/0';
  }

  // —— 事件绑定 ——
  function bindUI(){
    // 搜索栏：把计数/上下键放到右侧容器
    const sb = $('#searchbar');
    if(sb && !$('#search-tools')){
      const tools = document.createElement('div'); tools.id='search-tools';
      const prev = $('#prev-hit') || Object.assign(document.createElement('button'), {id:'prev-hit', textContent:'↑'});
      const next = $('#next-hit') || Object.assign(document.createElement('button'), {id:'next-hit', textContent:'↓'});
      const info = $('#hit-info') || Object.assign(document.createElement('span'), {id:'hit-info'});
      tools.appendChild(prev); tools.appendChild(next); tools.appendChild(info);
      sb.appendChild(tools);
    }
    const input = $('#q');
    if(input){
      input.addEventListener('input', ()=>doSearch(input.value.trim()));
      input.addEventListener('keydown', e=>{
        if(e.key==='Enter'){ doSearch(input.value.trim()); }
      });
    }
    const prevBtn = $('#prev-hit');
    const nextBtn = $('#next-hit');
    prevBtn && prevBtn.addEventListener('click', ()=>{ if(!hits.length) return; hitIndex = (hitIndex-1+hits.length)%hits.length; scrollToHit(hitIndex); updateHitUI(); });
    nextBtn && nextBtn.addEventListener('click', ()=>{ if(!hits.length) return; hitIndex = (hitIndex+1)%hits.length; scrollToHit(hitIndex); updateHitUI(); });

    // 展开/收起全部（文本树 & 本页目录都可复用）
    const btnExpandAll = $('#toggleAll');
    if(btnExpandAll){
      btnExpandAll.onclick = ()=>{
        const all = $$('.dir .children');
        const willOpen = Array.from(all).some(b=>b.style.display==='none');
        all.forEach(b=>{ b.style.display = willOpen ? '' : 'none'; });
        $$('.dir>.header span:first-child').forEach(c=>c.textContent = willOpen ? '▾' : '▸');
        btnExpandAll.textContent = willOpen ? '收起全部' : '展开全部';
      };
    }
  }

  // —— 路由 ——
  function onHash(){
    const m = location.hash.match(/(?:^#|&)doc=([^&]+)/);
    if(m){
      const p = decodeURIComponent(m[1]);
      openDoc(p);
    }else{
      viewer.innerHTML = '<p style="color:#666">在左侧选择文档，或在上方搜索</p>';
    }
  }

  // —— 初始化 ——
  async function init(){
    bindUI();
    try{
      const tree = await fetch('index/tree.json').then(r=>r.json());
      TREE = tree;
      const list = $('#doclist'); if(list){ renderTree((tree.children||[]), list); }
    }catch(e){
      console.error('加载树失败：', e);
    }
    window.addEventListener('hashchange', onHash);
    onHash();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
