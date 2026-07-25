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
  // Several anchor shapes per surface. The new jobs UI links its list cards to
  // ?currentJobId=<id> and only the right-hand detail pane carries a /jobs/view/ link, so
  // anchoring on /jobs/view/ alone finds the detail pane and none of the list.
  const ANCHORS = {
    jobs: [
      { sel: 'a[href*="currentJobId="]', id: /currentJobId=(\d+)/ },
      { sel: 'a[href*="/jobs/view/"]', id: /\/jobs\/view\/(\d+)/ }
    ],
    feed: [{ sel: 'a[href*="/feed/update/"]', id: /\/feed\/update\/([^/?#]+)/ }],
    messaging: [{ sel: 'a[href*="/messaging/thread/"]', id: /\/messaging\/thread\/([^/?#]+)/ }]
  };

  const MAX_WALK = 10;

  // A size ceiling per surface, because the same-id rule alone is not enough. If a page
  // holds only ONE job id of a given anchor shape, no second id ever appears and the walk
  // climbs to a container spanning the whole layout. On the jobs page that means hovering
  // a list item on the left highlights a block covering the detail pane on the right.
  //
  // A jobs list card is a couple of hundred characters. A job detail pane is thousands,
  // which is also why it should never be treated as a card and collapsed.
  const CARD_MAX = { jobs: 2000, feed: MAX_CHARS, messaging: 2000 };

  function idsWithin(el, anchor) {
    const ids = new Set();
    for (const a of el.querySelectorAll(anchor.sel)) {
      const m = anchor.id.exec(a.getAttribute('href') || '');
      if (m) ids.add(m[1]);
    }
    return ids;
  }

  // Below this, an element is a title fragment rather than a card. A real card carries at
  // least a title plus a company or a preview line.
  const MIN_CARD_CHARS = 25;

  function cardFor(anchorEl, anchor, cap) {
    let el = anchorEl.parentElement;
    let best = null;
    for (let i = 0; i < MAX_WALK && el && el !== document.body; i++, el = el.parentElement) {
      if (idsWithin(el, anchor).size !== 1) break; // reached a neighbouring card
      if (norm(el.textContent).length > cap) break; // reached a layout container
      best = el;
    }
    return best && norm(best.textContent).length >= MIN_CARD_CHARS ? best : null;
  }

  // Union of the structural pass and the legacy selectors, so both the new and the old
  // markup work and neither one going stale takes the extension down.
  function findCards(surface, legacySel) {
    const cap = CARD_MAX[surface] || MAX_CHARS;
    const byId = new Map();

    // The shape that found more distinct ids goes first: the list shape sees every
    // listing, the detail-pane shape sees one. First find wins per id. The earlier
    // smaller-element-wins rule let the pane's little title block replace the open job's
    // real list card, which made that one card unhoverable and unmarkable.
    const shapes = (ANCHORS[surface] || [])
      .map((anchor) => {
        const hits = [];
        const distinct = new Set();
        for (const a of document.querySelectorAll(anchor.sel)) {
          const m = anchor.id.exec(a.getAttribute('href') || '');
          if (m) {
            hits.push([a, m[1]]);
            distinct.add(m[1]);
          }
        }
        return { anchor, hits, distinct: distinct.size };
      })
      .sort((x, y) => y.distinct - x.distinct);

    for (const { anchor, hits } of shapes) {
      for (const [a, id] of hits) {
        if (byId.has(id)) continue; // first find wins, within a shape that is DOM order
        const card = cardFor(a, anchor, cap);
        if (card) byId.set(id, card);
      }
    }

    const cards = Array.from(new Set(byId.values()));
    if (legacySel) {
      for (const el of document.querySelectorAll(legacySel)) {
        // Only add a legacy match disjoint from every structural card. A wrapper or an
        // inner fragment of one would nest cards inside cards.
        if (!cards.some((f) => f === el || f.contains(el) || el.contains(f))) cards.push(el);
      }
    }
    // Never keep an element that contains another kept element.
    return cards.filter((el) => !cards.some((o) => o !== el && el.contains(o)));
  }

  // Match counts per anchor shape and per legacy selector, for the debug report. This is
  // what turns "it does nothing" into a one-paste diagnosis.
  function diag(surface, legacySel) {
    const shapes = {};
    for (const a of ANCHORS[surface] || []) shapes[a.sel] = document.querySelectorAll(a.sel).length;
    const legacy = {};
    for (const s of String(legacySel || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)) {
      try {
        legacy[s] = document.querySelectorAll(s).length;
      } catch (_) {
        legacy[s] = 'invalid selector';
      }
    }
    return { shapes, legacy };
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

  const api = { norm, fingerprint, cardId, collapsible, findCards, diag, MAX_CHARS, makeSeen, bump, countOf, syncPage };
  root.LFBCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
