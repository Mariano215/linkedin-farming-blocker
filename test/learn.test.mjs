import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../learn.js';

const { suggest, protectedBy } = globalThis.LFBLearn;

const mark = (text, extra = {}) => ({ text, title: null, company: null, ...extra });
const phrasesOf = (res) => res.candidates.map((c) => c.phrase);

test('a phrase recurring across marks becomes a candidate', () => {
  const res = suggest([
    mark('Urgent requirement, share your updated resume with expected ctc immediately'),
    mark('Immediate joiners, share your updated resume with expected ctc today')
  ]);
  assert.ok(
    phrasesOf(res).some((p) => p.includes('updated resume with expected ctc')),
    'expected the shared phrase, got ' + JSON.stringify(phrasesOf(res))
  );
});

test('one mark alone suggests nothing', () => {
  const res = suggest([mark('Share your updated resume with expected ctc immediately')]);
  assert.deepEqual(res.candidates, [], 'a single example is not evidence');
});

test('phrases already covered by your rules are not re-suggested', () => {
  const marks = [mark('share your updated resume now please'), mark('share your updated resume today please')];
  const res = suggest(marks, { phrases: ['updated resume'] });
  assert.ok(!phrasesOf(res).some((p) => p.includes('updated resume')));
});

test('sub-phrases of a better candidate are collapsed away', () => {
  const res = suggest([mark('bench sales recruiter hotlist available'), mark('bench sales recruiter hotlist attached')]);
  const hits = phrasesOf(res).filter((p) => p.includes('bench sales'));
  assert.equal(hits.length, 1, 'want one phrase, not every sub-phrase: ' + JSON.stringify(hits));
});

// ---- the guard ----

test('phrases identifying nationality or location are withheld, with a reason', () => {
  const marks = [
    mark('Manager Talent Acquisition US Recruitment working offshore from India', {
      posterName: 'A Recruiter',
      posterUrl: '/in/a-recruiter'
    }),
    mark('Senior Recruiter US Staffing working offshore from India', {
      posterName: 'B Recruiter',
      posterUrl: '/in/b-recruiter'
    })
  ];
  const res = suggest(marks);

  const withheld = res.blocked.map((b) => b.phrase).join(' | ');
  assert.ok(res.blocked.length, 'expected withheld phrases');
  assert.ok(/india|offshore/.test(withheld), 'expected the nationality phrase withheld, got ' + withheld);
  assert.ok(res.blocked.every((b) => b.reason), 'every withheld phrase states why');

  // and none of them leak into the candidates the user can one-click add
  for (const p of phrasesOf(res)) {
    assert.equal(protectedBy(p), null, 'candidate must not key on identity: ' + p);
  }

  // the individual posters are still offered for blocking, which is the honest way to
  // act on this: one person at a time, chosen deliberately
  assert.equal(res.posters.length, 2);
});

test('the guard covers countries, cities, and person-location framings', () => {
  for (const p of [
    'hiring in pakistan',
    'indian candidates only',
    'bengaluru based team',
    'karachi office',
    'working from manila',
    'based in nigeria',
    'native english speaker',
    'visa status required',
    'check their surname'
  ]) {
    assert.ok(protectedBy(p), 'should be withheld: ' + p);
  }
});

test('the guard does not withhold behaviour phrases', () => {
  for (const p of [
    'comment interested for link',
    'bench sales recruiter',
    'corp to corp only',
    'registration fee required',
    'whatsapp me for details',
    'no interview direct joining',
    'share your updated resume with expected ctc',
    'rate confirmation attached'
  ]) {
    assert.equal(protectedBy(p), null, 'should be allowed: ' + p);
  }
});
