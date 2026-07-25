// DOM side: find cards, build ctx, apply the verdict, watch for new and recycled nodes.
(function () {
  'use strict';

  const LFB = globalThis.LFB;
  const C = globalThis.LFBCards;

  // Fingerprint per card, not a WeakSet of "seen" nodes: LinkedIn recycles cards and
  // swaps the content inside them, so a card has to be re-checked when its text changes.
  const lastFp = new WeakMap();
  const seen = C.makeSeen();
  let opts = { enabled: true, disabled: [], phrases: [], allow: [] };

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

  function process(el, surface, sel) {
    const fp = C.fingerprint(el);
    if (!fp || lastFp.get(el) === fp) return;
    // Recorded before the collapsible check, not after: containers fail that check on
    // every single scan otherwise, and each failure costs a querySelector.
    lastFp.set(el, fp);
    // Innermost match only. Guards against hiding a layout container, which blanks out a
    // whole region of the page.
    if (!C.collapsible(fp, Boolean(el.querySelector(sel)))) return;
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

  function scan() {
    if (opts.enabled === false) return;
    const surface = surfaceOf(location.pathname);
    if (!surface) return;
    C.syncPage(seen, location.pathname + location.search);

    const sel = SELECTORS[surface];
    document.querySelectorAll(sel).forEach((el) => process(el, surface, sel));
  }

  // One trailing scan per burst, over the whole document.
  //
  // The obvious design, scanning each added node, is the slow one: LinkedIn adds
  // thousands of nodes per scroll and their subtrees overlap, so the same elements get
  // walked over and over. A single document.querySelectorAll costs about the same as one
  // of those subtree walks and covers everything, and lastFp makes the per-card work
  // nearly free on repeat visits.
  //
  // setTimeout, not requestIdleCallback: on a busy page idle never arrives, so work piles
  // up and then lands all at once, which is exactly the stutter this is avoiding.
  // Backs off if a scan ever turns out to be expensive, so the extension can never sit on
  // the main thread and make the page feel broken. Ceiling is 5s between scans.
  let rescanMs = 300;
  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const t0 = performance.now();
      scan();
      const cost = performance.now() - t0;
      if (cost > 50 && rescanMs < 5000) {
        rescanMs = Math.min(5000, rescanMs * 2);
        console.warn('[lfb] scan took ' + Math.round(cost) + 'ms, backing off to ' + rescanMs + 'ms');
      }
    }, rescanMs);
  }

  chrome.storage.sync.get({ enabled: true, disabled: [], phrases: [], allow: [] }, (data) => {
    opts = data;
    if (opts.enabled === false) return;
    scan();
    // childList only, and the records are not even read: any mutation just means "scan
    // again soon". Reading them was pure cost, since the scan covers the document anyway.
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  });
})();
