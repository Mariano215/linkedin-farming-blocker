// DOM side: find cards, build ctx, apply the verdict, watch for new and recycled nodes.
(function () {
  'use strict';

  const LFB = globalThis.LFB;
  const C = globalThis.LFBCards;

  // Fingerprint per card, not a WeakSet of "seen" nodes: LinkedIn recycles cards and
  // swaps the content inside them, so a card has to be re-checked when its text changes.
  const lastFp = new WeakMap();
  const seen = C.makeSeen();
  let opts = { disabled: [], phrases: [], allow: [] };

  const counter = globalThis.LFBCounters.makeCounter({
    get: (defaults, cb) => chrome.storage.local.get(defaults, cb),
    set: (obj, cb) => chrome.storage.local.set(obj, () => cb(chrome.runtime.lastError || null))
  });

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

  function clearVerdict(el) {
    el.removeAttribute('data-lfb-collapse');
    el.removeAttribute('data-lfb-dim');
    el.removeAttribute('data-lfb-show');
    el.removeAttribute('title');
    const stub = el.querySelector(':scope > .lfb-stub');
    if (stub) stub.remove();
  }

  function buildCtx(el, surface, fp) {
    const links = Array.from(el.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '');
    const companyLink = links.find((h) => h.includes('/company/'));
    const posterLink = links.find((h) => h.includes('/in/') || h.includes('/company/'));
    const titleEl = el.querySelector(
      '.job-card-list__title, .job-card-container__link, [class*="job-card"] strong, .update-components-actor__title'
    );
    const company =
      C.norm(
        (el.querySelector('.job-card-container__primary-description, .artdeco-entity-lockup__subtitle') || {})
          .textContent || ''
      ) || null;

    const ctx = {
      raw: fp,
      text: fp.toLowerCase(),
      links,
      title: titleEl ? C.norm(titleEl.textContent) : null,
      company,
      companyUrl: companyLink || null,
      posterUrl: posterLink || null,
      posterCount: 0,
      dupeCount: 0
    };

    if (surface === 'jobs') {
      const id = C.cardId(el, fp);
      const posterKey = posterLink ? posterLink.split('?')[0].toLowerCase() : null;
      const dupeKey = ctx.title && company ? (ctx.title + '|' + company).toLowerCase() : null;
      ctx.posterCount = C.bump(seen.posters, posterKey, id) || C.countOf(seen.posters, posterKey);
      ctx.dupeCount = C.bump(seen.listings, dupeKey, id) || C.countOf(seen.listings, dupeKey);
    }
    return ctx;
  }

  function allowed(ctx) {
    return opts.allow.some((a) => {
      const needle = a.toLowerCase();
      return (
        (ctx.company && ctx.company.toLowerCase().includes(needle)) ||
        (ctx.posterUrl && ctx.posterUrl.toLowerCase().includes(needle)) ||
        (needle.length > 3 && ctx.text.includes(needle))
      );
    });
  }

  function stub(el, res) {
    const bar = document.createElement('div');
    bar.className = 'lfb-stub';
    bar.dataset.lfbSeverity = res.severity;
    bar.textContent = 'hidden: ' + res.hits.map((h) => h.label).join(', ');
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

  function process(el, surface) {
    const fp = C.fingerprint(el);
    if (!fp || lastFp.get(el) === fp) return;
    lastFp.set(el, fp);
    clearVerdict(el);

    const ctx = buildCtx(el, surface, fp);
    if (allowed(ctx)) return;
    const res = LFB.evaluate(ctx, surface, opts);
    if (!res) return;
    el.setAttribute('data-lfb-' + res.action, res.severity);
    if (res.action === 'collapse') stub(el, res);
    else el.setAttribute('title', 'flagged: ' + res.hits.map((h) => h.label).join(', '));
    counter.add(res.hits.map((h) => h.id));
  }

  function scan(node) {
    const surface = surfaceOf(location.pathname);
    if (!surface) return;
    C.syncPage(seen, location.pathname + location.search);

    const sel = SELECTORS[surface];
    if (node && node !== document && node.closest) {
      // A mutation often only adds a descendant, so climb to the card that owns it.
      const own = node.closest(sel);
      if (own) process(own, surface);
    }
    const scope = node && node.querySelectorAll ? node : document;
    scope.querySelectorAll(sel).forEach((el) => process(el, surface));
  }

  const idle = globalThis.requestIdleCallback || ((fn) => setTimeout(fn, 150));
  // A Set, not an array: one card being retyped fires hundreds of characterData
  // mutations on the same parent, and scanning it once per batch is enough.
  let pending = new Set();
  let queued = false;
  function schedule(nodes) {
    for (const n of nodes) pending.add(n);
    if (queued) return;
    queued = true;
    idle(() => {
      queued = false;
      const batch = pending;
      pending = new Set();
      batch.forEach(scan);
    });
  }

  chrome.storage.sync.get({ disabled: [], phrases: [], allow: [] }, (data) => {
    opts = data;
    scan(document);
    new MutationObserver((muts) => {
      const touched = [];
      for (const m of muts) {
        for (const n of m.addedNodes) if (n.nodeType === 1) touched.push(n);
        // Text swapped inside a recycled card: re-check the card that owns the target.
        if (m.type === 'characterData' && m.target.parentElement) touched.push(m.target.parentElement);
      }
      if (touched.length) schedule(touched);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
})();
