// DOM side: find cards, build ctx, apply the verdict, watch for new nodes.
(function () {
  'use strict';

  const LFB = globalThis.LFB;
  const done = new WeakSet();
  const seen = LFB.emptySeen();
  let opts = { disabled: [], phrases: [], allow: [] };
  const counts = Object.create(null);
  let flushTimer = null;

  const SELECTORS = {
    jobs: '[data-job-id], [data-occludable-job-id], li.jobs-search-results__list-item, .job-card-container',
    feed: '.feed-shared-update-v2[data-id], [data-urn^="urn:li:activity"], div[data-id^="urn:li:activity"]',
    messaging: 'li.msg-conversations-container__convo-item, .msg-s-event-listitem'
  };

  function surfaceOf(path) {
    if (path.startsWith('/jobs')) return 'jobs';
    if (path.startsWith('/messaging')) return 'messaging';
    if (path.startsWith('/feed') || path === '/') return 'feed';
    return null;
  }

  function norm(s) {
    return s.replace(/\s+/g, ' ').trim();
  }

  function buildCtx(el, surface) {
    const raw = norm(el.innerText || el.textContent || '');
    const links = Array.from(el.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '');
    const companyLink = links.find((h) => h.includes('/company/'));
    const posterLink = links.find((h) => h.includes('/in/') || h.includes('/company/'));
    const titleEl = el.querySelector(
      '.job-card-list__title, .job-card-container__link, [class*="job-card"] strong, .update-components-actor__title'
    );
    const company =
      norm(
        (el.querySelector('.job-card-container__primary-description, .artdeco-entity-lockup__subtitle') || {})
          .textContent || ''
      ) || null;

    const ctx = {
      raw,
      text: raw.toLowerCase(),
      links,
      title: titleEl ? norm(titleEl.textContent) : null,
      company,
      companyUrl: companyLink || null,
      posterUrl: posterLink || null,
      posterKey: posterLink ? posterLink.split('?')[0] : null,
      dupeKey: null,
      seen
    };
    if (surface === 'jobs' && ctx.title && company) ctx.dupeKey = (ctx.title + '|' + company).toLowerCase();

    if (ctx.posterKey) seen.posters.set(ctx.posterKey, (seen.posters.get(ctx.posterKey) || 0) + 1);
    if (ctx.dupeKey) seen.listings.set(ctx.dupeKey, (seen.listings.get(ctx.dupeKey) || 0) + 1);
    return ctx;
  }

  function allowed(ctx) {
    return opts.allow.some((a) => {
      const needle = a.toLowerCase();
      return (
        (ctx.company && ctx.company.toLowerCase().includes(needle)) ||
        (ctx.posterUrl && ctx.posterUrl.toLowerCase().includes(needle)) ||
        (ctx.text && needle.length > 3 && ctx.text.includes(needle))
      );
    });
  }

  function stub(el, res) {
    const bar = document.createElement('div');
    bar.className = 'lfb-stub';
    bar.dataset.lfbSeverity = res.severity;
    const reason = res.hits.map((h) => h.label).join(', ');
    bar.textContent = 'hidden: ' + reason;
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'lfb-show';
    show.textContent = 'show';
    show.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const on = el.hasAttribute('data-lfb-show');
      if (on) el.removeAttribute('data-lfb-show');
      else el.setAttribute('data-lfb-show', '');
      show.textContent = on ? 'show' : 'hide';
    });
    bar.appendChild(show);
    el.insertBefore(bar, el.firstChild);
  }

  function tally(res) {
    for (const h of res.hits) counts[h.id] = (counts[h.id] || 0) + 1;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      chrome.storage.local.get({ counts: {} }, (data) => {
        const merged = data.counts || {};
        for (const k in counts) merged[k] = (merged[k] || 0) + counts[k];
        for (const k in counts) delete counts[k];
        chrome.storage.local.set({ counts: merged });
      });
    }, 5000);
  }

  function process(el, surface) {
    if (done.has(el)) return;
    done.add(el);
    const ctx = buildCtx(el, surface);
    if (!ctx.text || allowed(ctx)) return;
    const res = LFB.evaluate(ctx, surface, opts);
    if (!res) return;
    el.setAttribute('data-lfb-' + res.action, res.severity);
    if (res.action === 'collapse') stub(el, res);
    else el.setAttribute('title', 'flagged: ' + res.hits.map((h) => h.label).join(', '));
    tally(res);
  }

  function scan(root) {
    const surface = surfaceOf(location.pathname);
    if (!surface) return;
    const sel = SELECTORS[surface];
    const scope = root && root.querySelectorAll ? root : document;
    if (scope !== document && scope.matches && scope.matches(sel)) process(scope, surface);
    scope.querySelectorAll(sel).forEach((el) => process(el, surface));
  }

  const idle = globalThis.requestIdleCallback || ((fn) => setTimeout(fn, 150));
  let pending = [];
  let queued = false;
  function schedule(nodes) {
    pending.push(...nodes);
    if (queued) return;
    queued = true;
    idle(() => {
      queued = false;
      const batch = pending;
      pending = [];
      batch.forEach(scan);
    });
  }

  chrome.storage.sync.get({ disabled: [], phrases: [], allow: [] }, (data) => {
    opts = data;
    scan(document);
    new MutationObserver((muts) => {
      const added = [];
      for (const m of muts) {
        for (const n of m.addedNodes) if (n.nodeType === 1) added.push(n);
      }
      if (added.length) schedule(added);
    }).observe(document.body, { childList: true, subtree: true });
  });
})();
