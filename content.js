// DOM side: find cards, build ctx, apply the verdict, watch for new and recycled nodes.
(function () {
  'use strict';

  const LFB = globalThis.LFB;
  const C = globalThis.LFBCards;

  // Fingerprint per card, not a WeakSet of "seen" nodes: LinkedIn recycles cards and
  // swaps the content inside them, so a card has to be re-checked when its text changes.
  const lastFp = new WeakMap();
  const seen = C.makeSeen();
  let opts = { enabled: true, mode: 'collapse', marking: true, disabled: [], phrases: [], allow: [], blockPosters: [] };

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

    const nameEl = el.querySelector(
      '.update-components-actor__title, .jobs-poster__name, .hirer-card__hirer-information a, .msg-conversation-listitem__participant-names'
    );

    const ctx = {
      raw: fp,
      text: fp.toLowerCase(),
      links,
      title: titleEl ? C.norm(titleEl.textContent) : null,
      company,
      companyUrl: companyLink || null,
      posterUrl: posterLink || null,
      posterName: nameEl ? C.norm(nameEl.textContent) : null,
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

  // Marking: hover a card, press F.
  //
  // No button is injected into the card. Injecting one means either absolute positioning,
  // which needs position:relative on a LinkedIn card and re-anchors that card's own
  // absolutely-positioned children, or an element in normal flow, which shifts their
  // layout. Both are how this extension broke the page before. An outline plus a hotkey
  // changes nothing about the document.
  function toast(msg) {
    let el = document.getElementById('lfb-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lfb-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.remove(), 2200);
  }

  let hovered = null;

  function trackHover(surface, sel) {
    document.addEventListener(
      'mouseover',
      (e) => {
        if (opts.marking === false) return;
        const card = e.target.closest && e.target.closest(sel);
        if (card === hovered) return;
        if (hovered) hovered.removeAttribute('data-lfb-hover');
        hovered = card;
        if (hovered) hovered.setAttribute('data-lfb-hover', '');
      },
      { passive: true }
    );

    document.addEventListener('keydown', (e) => {
      if (opts.marking === false || e.key !== 'f' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      // Never steal the key while the user is typing.
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      if (!hovered) return;
      e.preventDefault();
      mark(hovered, surface);
    });
  }

  // Stores text only, locally. No network, no account, capped so it stays a phrase corpus
  // rather than an archive of everything you read.
  function mark(el, surface) {
    const ctx = buildCtx(el, surface, C.fingerprint(el));
    chrome.storage.local.get({ marked: [] }, (data) => {
      const marked = data.marked || [];
      marked.push({
        text: ctx.raw.slice(0, 600),
        title: ctx.title,
        company: ctx.company,
        posterName: ctx.posterName,
        posterUrl: ctx.posterUrl
      });
      chrome.storage.local.set({ marked: marked.slice(-200) }, () => {
        toast('Marked. ' + marked.length + ' saved, see the options page for suggested rules.');
      });
    });
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
    flagged++;
  }

  // Floating pill: how many are hidden, and one click to see them all. The count is the
  // honest part. If it reads "312 hidden" on a page of 25 jobs, the rules are wrong.
  let flagged = 0;
  let pill = null;

  function updatePill() {
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'lfb-toggle';
      pill.type = 'button';
      pill.addEventListener('click', () => {
        const root = document.documentElement;
        if (root.hasAttribute('data-lfb-reveal')) root.removeAttribute('data-lfb-reveal');
        else root.setAttribute('data-lfb-reveal', '');
        updatePill();
      });
      document.body.appendChild(pill);
    }
    const revealed = document.documentElement.hasAttribute('data-lfb-reveal');
    pill.textContent = revealed ? 'hide ' + flagged + ' flagged' : flagged + ' hidden';
    pill.hidden = flagged === 0;
  }

  function scan() {
    if (opts.enabled === false) return;
    const surface = surfaceOf(location.pathname);
    if (!surface) return;
    C.syncPage(seen, location.pathname + location.search);

    const sel = SELECTORS[surface];
    document.querySelectorAll(sel).forEach((el) => process(el, surface, sel));
    updatePill();
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

  chrome.storage.sync.get({ enabled: true, mode: 'collapse', marking: true, disabled: [], phrases: [], allow: [], blockPosters: [] }, (data) => {
    opts = data;
    if (opts.enabled === false) return;
    document.documentElement.setAttribute('data-lfb-mode', opts.mode);
    const surface = surfaceOf(location.pathname);
    if (surface) trackHover(surface, SELECTORS[surface]);
    scan();
    // childList only, and the records are not even read: any mutation just means "scan
    // again soon". Reading them was pure cost, since the scan covers the document anyway.
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  });
})();
