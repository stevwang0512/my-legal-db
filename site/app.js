// 目录开关逻辑（独立于侧栏存在于中缝gutter）
(function(){
  const btn = document.getElementById('toc-toggle');
  const root = document.body;
  const content = document.getElementById('content');

  function setState(collapsed){
    root.classList.toggle('sidebar-collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = collapsed ? '展开目录' : '收起目录';
    btn.textContent = collapsed ? '❯' : '❮';
  }

  // 初始化：桌面展开 / 移动端收起（可按需调整断点）
  const preferCollapsed = window.matchMedia('(max-width: 960px)').matches;
  setState(preferCollapsed);

  btn.addEventListener('click', () => {
    setState(!root.classList.contains('sidebar-collapsed'));
    // 收起或展开后把焦点移到正文，便于键盘/读屏用户继续阅读
    if (content) content.focus();
  });

  btn.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      btn.click();
    }
  });

  // 示例：目录点击定位（与现有平滑滚动兼容）
  document.querySelectorAll('.toc a[data-anchor]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(a.getAttribute('data-anchor'));
      if(!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      history.replaceState(null, '', a.getAttribute('data-anchor'));
    });
  });
})();
