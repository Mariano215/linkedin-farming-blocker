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

  const api = { norm, fingerprint, cardId, collapsible, MAX_CHARS, makeSeen, bump, countOf, syncPage };
  root.LFBCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
