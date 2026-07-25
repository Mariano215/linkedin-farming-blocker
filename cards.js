// Card identity and per-page state. Duck-typed against the DOM (anything with
// childNodes / textContent / getAttribute works), so it is testable without a browser.
(function (root) {
  'use strict';

  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  const OURS = ['lfb-stub', 'lfb-mark'];
  const isOurs = (n) =>
    Boolean(n && n.classList && n.classList.contains && OURS.some((c) => n.classList.contains(c)));

  // The fingerprint ignores anything we injected ourselves. Including it would change the
  // fingerprint the moment we touch a card, so the card would look new on the next scan
  // and be processed again forever, appending another control each time.
  // textContent, not innerText: innerText forces layout and returns '' for the
  // children we just hid with display:none.
  function fingerprint(el) {
    if (!el) return '';
    const kids = el.childNodes ? Array.from(el.childNodes) : null;
    if (!kids) return norm(el.textContent);
    return norm(
      kids
        .filter((n) => !isOurs(n))
        .map((n) => n.textContent)
        .join(' ')
    );
  }

  const ID_ATTRS = ['data-job-id', 'data-occludable-job-id', 'data-id', 'data-urn'];

  function cardId(el, fp) {
    for (const a of ID_ATTRS) {
      const v = el && el.getAttribute && el.getAttribute(a);
      if (v) return v;
    }
    // Fall back to the content itself: identical reposts share an id, so a
    // virtualized list re-inserting the same card cannot inflate the counts.
    return 'fp:' + (fp == null ? fingerprint(el) : fp);
  }

  // Biggest blast radius in the whole extension. querySelectorAll returns ancestors as
  // well as descendants, and LinkedIn reuses attributes like data-job-id on both a card
  // and the layout container around it. Collapsing a container hides a whole region of
  // the page, which reads to the user as "LinkedIn is broken".
  //
  // So: only ever act on the innermost match, and never on something far too big to be
  // one card. MAX_CHARS is deliberately loose. A long feed post runs to a few thousand
  // characters; a page region runs to tens of thousands.
  const MAX_CHARS = 6000;

  function collapsible(fp, hasNestedCard) {
    return Boolean(fp) && !hasNestedCard && fp.length <= MAX_CHARS;
  }

  // Structural card discovery.
  //
  // Class-name selectors rot: LinkedIn shipped a new jobs UI and every one of them matched
  // nothing, so the extension silently did nothing at all. Anchors are far more stable,
  // because the URL shape (/jobs/view/<id>) is a routing contract rather than styling.
  //
  // Walk up from an anchor and keep the OUTERMOST ancestor whose job links all point at
  // the same listing. One step further up would swallow a sibling card, which is the
  // container-collapse bug that blanked whole page regions.
  const ANCHORS = {
    jobs: { sel: 'a[href*="/jobs/view/"]', id: /\/jobs\/view\/(\d+)/ },
    feed: { sel: 'a[href*="/feed/update/"]', id: /\/feed\/update\/([^/?#]+)/ },
    messaging: { sel: 'a[href*="/messaging/thread/"]', id: /\/messaging\/thread\/([^/?#]+)/ }
  };

  const MAX_WALK = 10;

  function idsWithin(el, anchor) {
    const ids = new Set();
    for (const a of el.querySelectorAll(anchor.sel)) {
      const m = anchor.id.exec(a.getAttribute('href') || '');
      if (m) ids.add(m[1]);
    }
    return ids;
  }

  function cardFor(anchorEl, anchor) {
    let el = anchorEl.parentElement;
    let best = null;
    for (let i = 0; i < MAX_WALK && el && el !== document.body; i++, el = el.parentElement) {
      const ids = idsWithin(el, anchor);
      if (ids.size !== 1) break; // grown far enough to include a neighbouring card
      if (norm(el.textContent).length > MAX_CHARS) break;
      best = el;
    }
    return best;
  }

  // Union of the structural pass and the legacy selectors, so both the new and the old
  // markup work and neither one going stale takes the extension down.
  function findCards(surface, legacySel) {
    const found = new Set();
    const anchor = ANCHORS[surface];
    if (anchor) {
      for (const a of document.querySelectorAll(anchor.sel)) {
        const card = cardFor(a, anchor);
        if (card) found.add(card);
      }
    }
    if (legacySel) {
      for (const el of document.querySelectorAll(legacySel)) {
        // Skip a legacy match that merely wraps a card the structural pass already found.
        if (!Array.from(found).some((f) => el.contains(f) && el !== f)) found.add(el);
      }
    }
    return Array.from(found);
  }

  function makeSeen() {
    return { page: null, posters: new Map(), listings: new Map() };
  }

  // Counts distinct cards, not renders.
  function bump(map, key, id) {
    if (!key || !id) return 0;
    let ids = map.get(key);
    if (!ids) {
      ids = new Set();
      map.set(key, ids);
    }
    ids.add(id);
    return ids.size;
  }

  function countOf(map, key) {
    const ids = key ? map.get(key) : null;
    return ids ? ids.size : 0;
  }

  // LinkedIn navigates client-side, so the content script outlives the page it
  // loaded on. Without this, counts from an old job search leak into the next one.
  function syncPage(seen, pageKey) {
    if (seen.page === pageKey) return false;
    seen.page = pageKey;
    seen.posters.clear();
    seen.listings.clear();
    return true;
  }

  const api = { norm, fingerprint, cardId, collapsible, findCards, MAX_CHARS, makeSeen, bump, countOf, syncPage };
  root.LFBCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
