import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../rules.js'; // plain script, sets globalThis.LFB

const { evaluate } = globalThis.LFB;

function ctx(raw, extra = {}) {
  return {
    raw,
    text: raw.replace(/\s+/g, ' ').trim().toLowerCase(),
    links: [],
    title: null,
    company: null,
    companyUrl: null,
    posterUrl: null,
    posterCount: 0,
    dupeCount: 0,
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
  assert.ok(hitIds('Java Developer, Austin TX', 'jobs', { posterCount: 8 }).includes('spam-poster'));
  assert.ok(!hitIds('Java Developer, Austin TX', 'jobs', { posterCount: 3 }).includes('spam-poster'));
  assert.ok(hitIds('Java Developer, Austin TX', 'jobs', { dupeCount: 4 }).includes('dupe-listing'));
  assert.ok(!hitIds('Java Developer, Austin TX', 'jobs', { dupeCount: 2 }).includes('dupe-listing'));
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

// ---- regressions found in review ----

test('fix: naming an app without a handle is not off-platform contact', () => {
  // "Signal" plus a nearby word used to collapse this as a scam.
  assert.equal(evaluate(ctx('Our engineering org uses Signal now for incident coordination.'), 'feed', {}), null);
  assert.equal(evaluate(ctx('We moved internal comms to Telegram and Slack last quarter.'), 'feed', {}), null);
  // still catches the real thing
  assert.ok(hitIds('WhatsApp me for the JD', 'jobs').includes('offplatform-contact'));
  assert.ok(hitIds('Contact us on Telegram to proceed', 'jobs').includes('offplatform-contact'));
  assert.ok(hitIds('Reach me on Signal for next steps', 'jobs').includes('offplatform-contact'));
  assert.ok(hitIds('Ping here: https://t.me/hiringfast', 'jobs').includes('offplatform-contact'));
});

test('fix: posts warning about these patterns are not flagged', () => {
  const warnings = [
    ['Please do not comment INTERESTED on random job posts, apply on the company site.', 'feed'],
    ['Do not send me a DM about this role, apply through our careers page.', 'feed'],
    ['Red flag: they asked me to pay a registration fee of $200. Report these.', 'feed'],
    ['Never repost this for reach, it only helps the farmer.', 'feed'],
    ['Beware of anyone telling you to WhatsApp me for the JD, that is a scam.', 'feed']
  ];
  for (const [raw, surface] of warnings) {
    assert.equal(evaluate(ctx(raw), surface, {}), null, 'should not flag warning: ' + raw);
  }
  // the guard is scoped: "no interview" keeps firing, since "no" is the signal itself
  assert.ok(hitIds('Direct joining with no interview required.', 'jobs').includes('no-interview'));
});

test('fix: previously missed phrasings now match', () => {
  assert.ok(hitIds('Hiring backend engineers. Comment below for link.', 'feed').includes('comment-gate'));
  // hrefs keep their original case
  assert.ok(hitIds('Apply here', 'jobs', { links: ['https://BIT.LY/xy12ab'] }).includes('link-shortener'));
  assert.ok(hitIds('To start onboarding, pay 250 USD today.', 'jobs').includes('pay-to-apply'));
  assert.ok(hitIds('Pay 5000 INR for the training kit.', 'jobs').includes('pay-to-apply'));
});

test('fix: urgency copy is not mistaken for a negation', () => {
  // The negation guard used to swallow these, which is worse than the bug it fixed:
  // a farming post only has to open with "Don't miss this" to become invisible.
  assert.ok(hitIds("Don't miss this role, comment interested for the link.", 'feed').includes('comment-gate'));
  assert.ok(hitIds('No need to apply on site, comment interested for the link.', 'feed').includes('comment-gate'));
  assert.ok(hitIds("Don't wait! DM me for the link before it closes.", 'feed').includes('dm-gate'));

  // and the real warnings still stay visible
  assert.equal(evaluate(ctx('Please do not comment interested on random job posts.'), 'feed', {}), null);
  assert.equal(evaluate(ctx('Never repost this for reach.'), 'feed', {}), null);
});

test("fix: LinkedIn's own shortener is not treated as suspicious", () => {
  // lnkd.in is on a large share of ordinary posts, so matching it dimmed real content.
  assert.equal(evaluate(ctx('I wrote up the migration notes here: https://lnkd.in/abcDEF12'), 'feed', {}), null);
  assert.equal(evaluate(ctx('Notes attached', { links: ['https://lnkd.in/abcDEF12'] }), 'feed', {}), null);
  // third-party shorteners still count
  assert.ok(hitIds('Apply: cutt.ly/abc123', 'jobs').includes('link-shortener'));
});
