import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../rules.js'; // plain script, sets globalThis.LFB

const { evaluate, emptySeen } = globalThis.LFB;

function ctx(raw, extra = {}) {
  return {
    raw,
    text: raw.replace(/\s+/g, ' ').trim().toLowerCase(),
    links: [],
    title: null,
    company: null,
    companyUrl: null,
    posterUrl: null,
    posterKey: null,
    dupeKey: null,
    seen: emptySeen(),
    ...extra
  };
}

const hitIds = (raw, surface, extra) => {
  const res = evaluate(ctx(raw, extra), surface, {});
  return res ? res.hits.map((h) => h.id) : [];
};

test('farming patterns are caught in the feed', () => {
  assert.ok(hitIds('Hiring 20 devs! Comment INTERESTED and I will DM the link.', 'feed').includes('comment-gate'));
  assert.ok(hitIds('Great role. DM me for the link, spots filling fast.', 'feed').includes('dm-gate'));
  assert.ok(hitIds('Repost this for reach so it finds someone.', 'feed').includes('repost-bait'));
  assert.ok(hitIds('Follow me for daily jobs in tech.', 'feed').includes('follow-bait'));
  assert.ok(hitIds('🚨🚨🚨 HIRING NOW, apply today', 'feed').includes('emoji-wall'));
});

test('scam job patterns are caught and collapse on one hit', () => {
  const wa = evaluate(ctx('Urgent hiring. Contact on WhatsApp +91 98765 43210 for details.'), 'jobs', {});
  assert.equal(wa.action, 'collapse');
  assert.equal(wa.severity, 'scam');
  assert.ok(wa.hits.some((h) => h.id === 'offplatform-contact'));

  assert.ok(hitIds('Pay a refundable security deposit of $250 to start onboarding.', 'jobs').includes('pay-to-apply'));
  assert.ok(hitIds('Direct joining, no interview, selection guaranteed.', 'jobs').includes('no-interview'));
  assert.ok(hitIds('Work from home package reshipping agent needed.', 'jobs').includes('known-scam-genre'));
  assert.ok(hitIds('Remote data entry clerk, $55 per hour, no experience.', 'jobs').includes('unrealistic-pay'));
  assert.ok(hitIds('Apply here: bit.ly/xy12ab', 'jobs').includes('link-shortener'));
});

test('one weak signal only dims, two collapse', () => {
  const one = evaluate(ctx('Send your CV to hr.staffing@gmail.com'), 'jobs', {});
  assert.equal(one.action, 'dim');

  const two = evaluate(ctx('Send your CV to hr.staffing@gmail.com then apply via bit.ly/abc123'), 'jobs', {});
  assert.equal(two.action, 'collapse');
});

test('cross-card rules fire only past the threshold', () => {
  const seen = emptySeen();
  seen.posters.set('/in/recruiter-x', 8);
  assert.ok(hitIds('Java Developer, Austin TX', 'jobs', { seen, posterKey: '/in/recruiter-x' }).includes('spam-poster'));

  seen.posters.set('/in/recruiter-y', 3);
  assert.ok(!hitIds('Java Developer, Austin TX', 'jobs', { seen, posterKey: '/in/recruiter-y' }).includes('spam-poster'));
});

test('legitimate posts are not flagged', () => {
  const clean = [
    // ordinary engagement, not a comment gate
    ['We shipped v2 today. Comment your thoughts below, curious what you all think.', 'feed'],
    // a real recruiter with a real company page and ATS link
    ['Senior Backend Engineer at Acme Corp. Apply on our careers site.', 'jobs'],
    // genuinely high pay, but a senior title, so no low-skill combo
    ['Staff Site Reliability Engineer, $150 per hour contract, 10+ years required.', 'jobs'],
    // mentions an interview process normally
    ['Our process: recruiter screen, technical interview, then a system design round.', 'jobs'],
    // a recruiter in India posting a normal listing. Location and nationality must never
    // be a signal on their own.
    ['Hiring Python Developer in Bengaluru, India. 4-6 yrs. Apply via our careers portal.', 'jobs'],
    ['Karachi-based fintech hiring a QA Engineer. Interviews start next week.', 'jobs'],
    ['Referring candidates for our Lahore office, full-time, benefits included.', 'feed']
  ];
  for (const [raw, surface] of clean) {
    const res = evaluate(ctx(raw, { companyUrl: '/company/acme', company: 'Acme Corp' }), surface, {});
    assert.equal(res, null, 'should not flag: ' + raw + ' got ' + JSON.stringify(res));
  }
});

test('rule toggles and user phrases work', () => {
  const raw = 'Comment INTERESTED for the link';
  assert.equal(evaluate(ctx(raw), 'feed', { disabled: ['comment-gate'] }), null);
  const res = evaluate(ctx('Commission only, uncapped'), 'feed', { phrases: ['commission only'] });
  assert.equal(res.action, 'collapse');
  assert.equal(res.hits[0].id, 'user-phrase');
});
