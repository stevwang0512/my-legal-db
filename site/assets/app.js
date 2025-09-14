/* site/assets/app.js — v0.24-compat
 * 适配现有结构：加载 `index/tree.json`，节点含 {type:'dir'|'file', path}
 * 修复：
 *   - Pages 空白：需要 `site/index/tree.json`；
 *   - 搜索条布局：命中计数/跳转靠右，搜索框撑满；
 *   - 侧栏折叠时正文自适应宽度，折叠按钮高度/宽度一致；
 *   - “展开/收起全部”按钮（文件树 & 本页目录）。
 */
(function(){
  const $ = (s, r=document)=>r.querySelector(s);
  const $$=(s, r=document)=>Array.from(r.querySelectorAll(s));

  const css = document.createElement('style');
  css.textContent = `
    #searchbar{display:flex; align-items:center; gap:8px;}
    #searchbar input[type="search"]{flex:1; min-width:160px;}
    #hit-ctr{margin-left:auto; display:flex; align-items:center; gap:6px; white-space:nowrap;}
    :root{ --toc-w:280px; --gutter-w:36px; }
    main{ display:grid; grid-template-columns: var(--toc-w) var(--gutter-w) 1fr; height: calc(100vh - 58px); }
    aside#toc{ overflow:auto; }
    #gutter{ display:flex; align-items:center; justify-content:center; }
    #toc-toggle{ width:28px; height:64px; border-radius:8px; }
    body.sb-collapsed main{ grid-template-columns: 0 var(--gutter-w) 1fr; }
    body.sb-collapsed aside#toc{ pointer-events:none; opacity:0; }
    .tree a.file{ display:block; padding:3px 6px; border-radius:6px; text-decoration:none;}
    .tree a.file:hover{ background:#eef5ff; }
    .tree a.file.active, #page-toc a.active{ background:#DAE8FC; border-left:3px solid #6AA9FF; }
    .mark-search-current, .highlight-target{ background:#fff5c4; outline:1px solid #ffde66; }
  `;
  document.head.appendChild(css);

  const state = { tree:null };

  async function loadTree(){
    const t = await fetch('index/tree.json').then(r=>r.json());
    state.tree = t;
  }

  // —— 渲染文件树 ——
  function renderTree(){
    const root = $('#doclist'); if(!root) return;
    root.innerHTML = ''; root.classList.add('tree');

    const make = (node, container)=>{
      if(node.type==='dir'){
        const det = document.createElement('details');
        det.open = false;
        const sum = document.createElement('summary');
        sum.textContent = node.title || node.name || '';
        det.appendChild(sum);
        const ul = document.createElement('ul'); det.appendChild(ul);
        (node.children||[]).forEach(ch=>make(ch, ul));
        container.appendChild(det);
      }else if(node.type==='file'){
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'file';
        a.textContent = (node.title||node.name||'').replace(/\.md$/i,'');
        const path = /^content\//.test(node.path||'') ? node.path : ('content/'+(node.path||''));
        a.href = '#doc=' + encodeURIComponent(path);
        a.addEventListener('click', (e)=>{
          e.preventDefault(); location.hash = 'doc=' + encodeURIComponent(path);
        });
        li.appendChild(a); container.appendChild(li);
      }
    };

    (state.tree.children||[]).forEach(ch=>make(ch, root));
  }

  // —— 面包屑 ——
  function renderBreadcrumb(path){
    const bc = $('#breadcrumb'); if(!bc) return;
    bc.innerHTML = ''; if(!path) return;
    const clean = path.replace(/^content\//,'');
    const parts = clean.split('/');
    const file  = parts.pop().replace(/\.md$/i,'');
    parts.forEach((p,i)=>{
      const span = document.createElement('span');
      span.textContent = stripOrderPrefix(p);
      bc.appendChild(span);
      if(i<parts.length) bc.appendChild(document.createTextNode(' / '));
    });
    const strong = document.createElement('strong'); strong.textContent = stripOrderPrefix(file);
    if(parts.length) bc.appendChild(document.createTextNode(' / '));
    bc.appendChild(strong);
  }
  function stripOrderPrefix(s){ return s.replace(/^\s*\d{1,3}[._\-\s]+/,''); }

  // —— 打开文档 ——
  async function openDoc(path){
    renderBreadcrumb(path);
    const md = await fetch(path).then(r=>r.text());
    const html = window.marked.parse(md);
    $('#viewer').innerHTML = html;
    buildPageToc();
  }

  // —— 页内 TOC & 锁定高亮 ——
  function buildPageToc(){
    const toc = $('#page-toc'); if(!toc) return;
    toc.innerHTML='';
    const hs = $$('#viewer h1, #viewer h2, #viewer h3, #viewer h4, #viewer h5, #viewer h6');
    let ul = document.createElement('ul'); toc.appendChild(ul);
    let lastLevel = 1; let stack=[ul];
    hs.forEach(h=>{
      const lvl = parseInt(h.tagName.slice(1),10);
      h.id = h.id || ('h-' + Math.random().toString(36).slice(2));
      const a = document.createElement('a'); a.href = '#'+h.id; a.textContent = h.textContent.trim();
      a.addEventListener('click', (e)=>{
        e.preventDefault();
        setActiveToc(a); highlightBlock(h);
        const y = h.getBoundingClientRect().top + window.scrollY - 90;
        window.scrollTo({top:y, behavior:'smooth'});
      });
      const li = document.createElement('li'); li.appendChild(a);
      while(lvl > lastLevel){ const nu = document.createElement('ul'); stack[stack.length-1].lastElementChild.appendChild(nu); stack.push(nu); lastLevel++; }
      while(lvl < lastLevel){ stack.pop(); lastLevel--; }
      stack[stack.length-1].appendChild(li);
    });
  }
  function setActiveToc(a){ $$('#page-toc a').forEach(x=>x.classList.remove('active')); a.classList.add('active'); }
  function highlightBlock(h){ $$('#viewer .highlight-target').forEach(x=>x.classList.remove('highlight-target')); h.classList.add('highlight-target'); }

  // —— 搜索（当前文档内） ——
  function wireSearch(){
    const q=$('#q'), prev=$('#prev-hit'), next=$('#next-hit'), info=$('#hit-info'); if(!q||!prev||!next||!info) return;
    let hits=[], i=-1;
    const clean=()=> $$('#viewer mark.search-hit').forEach(m=>m.replaceWith(m.textContent));
    const update=()=> info.textContent = hits.length? `${i+1}/${hits.length}` : '0/0';
    function markAll(){
      clean(); hits=[]; i=-1; update();
      const textNodes=[]; const it=document.createTreeWalker($('#viewer'), NodeFilter.SHOW_TEXT, null);
      const qv = q.value.trim(); if(!qv) return;
      const re = new RegExp(qv.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig');
      
      let n; while(n=it.nextNode()){ textNodes.append(n); }
      textNodes.forEach(n=>{
        const s=n.nodeValue; let last=0; const frag=document.createDocumentFragment();
        s.replace(re,(m,off)=>{
          frag.appendChild(document.createTextNode(s.slice(last,off)));
          const mark=document.createElement('mark'); mark.className='search-hit'; mark.textContent=m;
          frag.appendChild(mark); last=off+m.length;
        });
        frag.appendChild(document.createTextNode(s.slice(last)));
        if(frag.childNodes.length>1) n.parentNode.replaceChild(frag,n);
      });
      hits = $$('#viewer mark.search-hit'); i = hits.length? 0 : -1; go();
      update();
    }
    function go(){
      if(!hits.length) return update();
      $$('#viewer mark.search-hit').forEach(m=>m.classList.remove('mark-search-current'));
      const m = hits[i]; if(m){ m.classList.add('mark-search-current'); m.scrollIntoView({block:'center'}); }
      update();
    }
    q.addEventListener('keyup', (e)=>{ if(e.key==='Enter') markAll(); });
    prev.addEventListener('click', ()=>{ if(!hits.length) return; i=(i-1+hits.length)%hits.length; go(); });
    next.addEventListener('click', ()=>{ if(!hits.length) return; i=(i+1)%hits.length; go(); });

    }
  }
})();