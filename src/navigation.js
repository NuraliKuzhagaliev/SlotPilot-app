(() => {
  // Keep cross-section links in the existing desktop tabs, including Next router links.
  // No privileged bridge is exposed to this renderer.
  if (window.__slotpilotTabsInstalled) return;
  window.__slotpilotTabsInstalled = true;
  function section(url) {
    for (const name of ['book', 'admin', 'demo']) {
      if (url.pathname === '/' + name || url.pathname.startsWith('/' + name + '/')) return name;
    }
    return 'home';
  }
  window.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download')) return;
    let target;
    try { target = new URL(link.href); } catch { return; }
    if (target.origin !== location.origin || target.protocol !== 'https:') return;
    if (section(target) === section(new URL(location.href)) && !event.ctrlKey && !event.metaKey && link.target !== '_blank') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.open(target.href, '_blank');
  }, true);
})();
