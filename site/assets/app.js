/* My Lex Base v0.30 front-end
 * - Stable level-by-level TOC folding (▸/▾)
 * - Breadcrumb parked under #searchtips and hidden
 * - Gutter/searchtips visuals normalized
 */

// ---------- Helpers ----------
const qs  = (sel, el=document) => el.querySelector(sel);
const qsa = (sel, el=document) => Array.from(el.querySelectorAll(sel));

function on(type, sel, handler, opts) {
  document.addEventListener(type, (e) => {
    const t = e.target.closest(sel);
    if (t) handler(e, t);
  }, opts||false);
}

function el(tag, attrs={}, ...kids){
  const n = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(k==='class') n.className = v;
    else if(k==='dataset') Object.assign(n.dataset, v);
    else if(k.startsWith('on') && typeof v==='function') n.addEventListener(k.slice(2), v);
    else if(v!==null && v!==undefined) n.setAttribute(k, v);
  }
  for(const kid of kids){
    if(kid==null) continue;
    n.appendChild(typeof kid==='string' ? document.createTextNode(kid) : kid);
  }
  return n;
}

// ---------- Breadcrumb relocation (hidden) ----------
(function parkBreadcrumbs(){
  const crumbs = qs('#breadcrumbs');
  const tips   = qs('#searchtips');
  if(crumbs && tips){
    tips.appendChild(crumbs);
    crumbs.classList.add('sr-only');
    crumbs.setAttribute('aria-hidden','true');
  }
})();

// ---------- TOC build & folding ----------
/**
 * Expect a nested structure like:
 * <div id="page-toc">
 *   <ul>
 *     <li data-level="1" class="collapsed|expanded">
 *        <div class="toc-line">
 *          <button class="twisty" aria-label="展开/折叠" aria-expanded="false">▸</button>
 *          <a href="#h-1">标题</a>
 *        </div>
 *        <ul> ... children (level+1) ... </ul>
 *     </li>
 *   </ul>
 * </div>
 */
function buildPageTOCFromHeadings(){
  const container = qs('#page-toc');
  if(!container) return;
  container.innerHTML = '';

  const heads = qsa('#viewer h1, #viewer h2, #viewer h3, #viewer h4, #viewer h5');
  if(heads.length===0) return;

  // Build tree
  const root = el('ul');
  const stack = [{level:0, ul:root}];
  heads.forEach(h => {
    const tag = h.tagName.toLowerCase();
    const level = parseInt(tag.slice(1), 10); // 1..5
    const text = h.textContent.trim();
    const id = h.id || h.dataset.id || `h-${Math.random().toString(36).slice(2,8)}`;
    h.id = id;

    // ascend/descend
    while (stack[stack.length-1].level >= level) stack.pop();
    const parent = stack[stack.length-1].ul;

    const line = el('div', {class:'toc-line'},
      el('button', {class:'twisty', 'aria-label':'展开/折叠', 'aria-expanded':'false'}, '▸'),
      el('a', {href:`#${id}`, 'data-target':id}, text)
    );
    const li = el('li', {'data-level':level, class:'collapsed'}, line, el('ul'));
    parent.appendChild(li);
    stack.push({level, ul: li.lastElementChild});
  });

// Hide twisty on leaf nodes (no children)
  root.querySelectorAll('li').forEach(li => {
    const ul = li.querySelector(':scope > ul');
    if(!ul || ul.children.length === 0){
      const tw = li.querySelector(':scope > .toc-line > .twisty');
      if(tw) tw.style.visibility = 'hidden';
    }
  });

  container.appendChild(root);
}


function setNodeExpanded(li, expand, affectDesc=false){
  if(!li) return;
  li.classList.toggle('collapsed', !expand);
  li.classList.toggle('expanded', !!expand);
  const twisty = qs(':scope > .toc-line > .twisty', li);
  if(twisty){
    twisty.textContent = expand ? '▾' : '▸';
    twisty.setAttribute('aria-expanded', String(!!expand));
  }
  if(affectDesc){
    qsa('li', li).forEach(child => {
      if(child===li) return;
      child.classList.add('collapsed');
      child.classList.remove('expanded');
      const t = qs(':scope > .toc-line > .twisty', child);
      if(t){ t.textContent='▸'; t.setAttribute('aria-expanded','false'); }
    });
  }
}

// Handle clicks (only toggle the clicked level)
on('click', '#page-toc .twisty', (e, btn) => {
  e.preventDefault(); e.stopPropagation();
  const li = btn.closest('li');
  const isOpen = li.classList.contains('expanded');
  setNodeExpanded(li, !isOpen, /*affectDescendants*/false);
});

// Optional: clicking the text also toggles only that level (not required, but handy)
on('click', '#page-toc .toc-line a', (e, a) => {
  // Do not toggle if user is using middle click etc.
  if(e.button!==0) return;
  const li = a.closest('li');
  // If collapsed, expand its immediate children but leave deeper levels closed.
  if(li && li.classList.contains('collapsed')){
    setNodeExpanded(li, true, /*affectDescendants*/false);
  }
  // Allow default anchor navigation to run.
});

// Ensure icons always match when DOM mutates externally (e.g., switching docs)
function normalizeTocIcons(){
  qsa('#page-toc li').forEach(li => {
    const open = li.classList.contains('expanded');
    const twisty = qs(':scope > .toc-line > .twisty', li);
    if(twisty){
      twisty.textContent = open ? '▾' : '▸';
      twisty.setAttribute('aria-expanded', String(open));
    }
  });
}

// Call after #viewer content is rendered
function onDocumentRendered(){
  buildPageTOCFromHeadings();
  normalizeTocIcons();
}

// ---------- Gutter / Searchtips tweaks ----------
(function setupTocToggle(){
  const btn = qs('#toc-toggle');
  const gutter = qs('#gutter');
  if(!btn || !gutter) return;
  btn.addEventListener('click', () => {
    const shown = !gutter.hasAttribute('hidden');
    if(shown){ gutter.setAttribute('hidden',''); btn.setAttribute('aria-pressed','false'); }
    else { gutter.removeAttribute('hidden'); btn.setAttribute('aria-pressed','true'); }
  });
})();

// ---------- Demo hook ----------
// If your app already calls a render function, please invoke `onDocumentRendered()`
window.LexBase = Object.assign(window.LexBase||{}, { onDocumentRendered });