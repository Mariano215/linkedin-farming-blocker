import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../cards.js';

const { fingerprint, cardId, collapsible, MAX_CHARS, makeSeen, bump, countOf, syncPage } = globalThis.LFBCards;

// Minimal stand-in for a card element. cards.js is duck-typed, so no DOM is needed.
function node(text, attrs = {}) {
  const kids = [{ textContent: text }];
  return {
    childNodes: kids,
    get textContent() {
      return kids.map((k) => k.textContent).join(' ');
    },
    getAttribute: (a) => attrs[a] || null,
    setText(t) {
      kids[0].textContent = t;
    },
    addStub(t) {
      kids.unshift({ textContent: t, classList: { contains: (c) => c === 'lfb-stub' } });
    }
  };
}

test('fix: a recycled card is re-checked when its text changes', () => {
  const el = node('Senior Go Engineer at Acme');
  const first = fingerprint(el);

  // same content, same fingerprint, so no rework
  assert.equal(fingerprint(el), first);

  // LinkedIn reuses the node for a different listing
  el.setText('WhatsApp me on +91 98765 43210 for instant joining');
  assert.notEqual(fingerprint(el), first);
});

test('fix: our own stub does not change the fingerprint', () => {
  // Without this the collapse itself changes the text, the card looks new on the next
  // mutation, and it is processed forever.
  const el = node('Comment INTERESTED for the link');
  const before = fingerprint(el);
  el.addStub('hidden: comment-gated job link show');
  assert.equal(fingerprint(el), before);
});

test('fix: counts track distinct cards, not renders', () => {
  const seen = makeSeen();
  const el = node('Java Developer', { 'data-job-id': '4231' });
  const id = cardId(el, fingerprint(el));

  for (let i = 0; i < 12; i++) bump(seen.posters, '/in/recruiter-x', id);
  assert.equal(countOf(seen.posters, '/in/recruiter-x'), 1, 're-rendering one card must count once');

  for (let i = 0; i < 8; i++) bump(seen.posters, '/in/recruiter-x', 'job-' + i);
  assert.equal(countOf(seen.posters, '/in/recruiter-x'), 9);
});

test('cards with no id attribute fall back to their content', () => {
  const a = node('Data Entry Clerk at Acme');
  const b = node('Data Entry Clerk at Acme');
  assert.equal(cardId(a, fingerprint(a)), cardId(b, fingerprint(b)), 'identical reposts share an id');

  const c = node('Different listing entirely');
  assert.notEqual(cardId(a, fingerprint(a)), cardId(c, fingerprint(c)));
});

test('fix: a container holding other cards is never collapsed', () => {
  // This is what broke the page: LinkedIn puts data-job-id on the card AND on the
  // layout container around it, querySelectorAll returns both, and hiding the container
  // blanks out a whole region.
  const card = 'Java Developer at Acme, Austin TX';
  assert.equal(collapsible(card, false), true, 'a plain card is fine');
  assert.equal(collapsible(card, true), false, 'not if it contains another card');

  // second net: nothing anywhere near a page region's size, even with no nested match
  assert.equal(collapsible('x'.repeat(MAX_CHARS + 1), false), false);
  assert.equal(collapsible('x'.repeat(MAX_CHARS), false), true);

  // a long but believable feed post still gets filtered
  assert.equal(collapsible('Comment INTERESTED. ' + 'lorem ipsum '.repeat(200), false), true);

  assert.equal(collapsible('', false), false, 'empty text is not a card');
});

test('fix: client-side navigation clears per-page counts', () => {
  const seen = makeSeen();
  syncPage(seen, '/jobs/search?keywords=go');
  for (let i = 0; i < 7; i++) bump(seen.posters, '/in/recruiter-x', 'job-' + i);
  assert.equal(countOf(seen.posters, '/in/recruiter-x'), 7);

  assert.equal(syncPage(seen, '/jobs/search?keywords=go'), false, 'same page is not a reset');
  assert.equal(countOf(seen.posters, '/in/recruiter-x'), 7);

  // new search, so the poster must start from zero and not trip spam-poster on card one
  assert.equal(syncPage(seen, '/jobs/search?keywords=rust'), true);
  assert.equal(countOf(seen.posters, '/in/recruiter-x'), 0);
  assert.equal(bump(seen.posters, '/in/recruiter-x', 'job-99'), 1);
});
