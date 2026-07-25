// Rule table. Pure data + matchers, no DOM. Loaded as a plain content script and
// imported by test/rules.test.mjs (node treats this as CJS), so there is one source
// of truth for the rules.
//
// A matcher receives ctx:
//   { text, raw, links, title, company, companyUrl, posterUrl, posterKey, seen }
// text is lowercased and whitespace-collapsed. seen is per-page cross-card state.
//
// Filtering is on behaviour only. No rule looks at nationality, country, name, or
// language of the poster: those do not predict scams and filtering on them is
// national-origin discrimination.

(function (root) {
  'use strict';

  const any = (re) => (ctx) => re.test(ctx.text);

  const FREEMAIL = /@(gmail|googlemail|outlook|hotmail|yahoo|ymail|proton(mail)?|aol|mail|yandex|rediffmail)\.[a-z.]{2,}/;
  const SHORTENER = /\b(bit\.ly|tinyurl\.com|cutt\.ly|rb\.gy|is\.gd|t\.co|shorturl\.at|lnkd\.in\/[a-z0-9]{4,}\?)/;
  const LOW_SKILL = /\b(data entry|typing|copy paste|form filling|chat support|remote assistant|package (handler|processor)|survey|mystery shopper)\b/;
  const HIGH_PAY = /(\$|usd\s?)\s?([3-9]\d|\d{3,})\s?(\/|per\s)\s?(hr|hour)|\$\s?[2-9]\d{3,}\s?(\/|per\s)\s?week/;

  const rules = [
    // ---- engagement farming (feed) ----
    {
      id: 'comment-gate',
      label: 'comment-gated job link',
      surfaces: ['feed'],
      severity: 'farming',
      test: any(/\bcomment\s+["'“]?(interested|intrested|yes|link|me|hiring)\b|\btype\s+["'“]?interested\b|\bdrop\s+["'“]?interested\b|comment\s+below\s+and\s+i(\s|')?ll\s+(dm|send|share)/)
    },
    {
      id: 'dm-gate',
      label: 'DM-gated link',
      surfaces: ['feed', 'messaging'],
      severity: 'farming',
      test: any(/\b(dm|pm|inbox)\s+me\s+(for|to get)\b|\bsend me a (dm|pm)\b|\bdm for (the )?(link|details|jd)\b/)
    },
    {
      id: 'repost-bait',
      label: 'repost bait',
      surfaces: ['feed'],
      severity: 'farming',
      test: any(/\brepost (this )?(for reach|to help)|\bshare (this )?to help someone\b|\btag someone who\b|\bhelp (this|it) reach\b/)
    },
    {
      id: 'follow-bait',
      label: 'follow bait',
      surfaces: ['feed'],
      severity: 'farming',
      test: any(/\bfollow me for (daily |more )?(jobs|updates|openings)\b|\bturn on (my )?(post )?notifications\b|\bhit the bell\b/)
    },
    {
      id: 'emoji-wall',
      label: 'emoji wall',
      surfaces: ['feed'],
      severity: 'weak',
      test: (ctx) => {
        const emoji = ctx.raw.match(/\p{Extended_Pictographic}/gu) || [];
        if (emoji.length >= 6 && ctx.raw.length < 400) return true;
        const lead = ctx.raw.slice(0, 40).match(/[\u{1F6A8}\u{1F525}\u{1F4E3}\u{1F4E2}\u{2757}\u{203C}]/gu) || [];
        return lead.length >= 3;
      }
    },

    // ---- scam job patterns (jobs + messaging) ----
    {
      id: 'offplatform-contact',
      label: 'off-platform contact (WhatsApp/Telegram)',
      surfaces: ['jobs', 'feed', 'messaging'],
      severity: 'scam',
      test: (ctx) =>
        /\b(whats?app|telegram|signal)\b[^.]{0,40}(\+?\d[\d\s().-]{7,}|@[a-z0-9_]{4,}|\bme\b|\bus\b|\bnow\b)/.test(ctx.text) ||
        /\b(wa\.me\/|t\.me\/)/.test(ctx.text)
    },
    {
      id: 'freemail-recruiter',
      label: 'free-email recruiter address',
      surfaces: ['jobs', 'messaging'],
      severity: 'weak',
      test: (ctx) => FREEMAIL.test(ctx.text)
    },
    {
      id: 'pay-to-apply',
      label: 'asks for money',
      surfaces: ['jobs', 'feed', 'messaging'],
      severity: 'scam',
      test: any(/\b(registration|processing|training|onboarding|placement|security)\s+(fee|charge|deposit|amount)\b|\brefundable deposit\b|\bpay\s*(₹|rs\.?|\$)\s?\d/)
    },
    {
      id: 'no-interview',
      label: 'no-interview / guaranteed offer',
      surfaces: ['jobs', 'messaging'],
      severity: 'scam',
      test: any(/\bno interview\b|\bwithout interview\b|\bdirect joining\b|\binstant (offer|joining|hiring)\b|\bselection (is )?guaranteed\b|\b100% (job )?guarantee\b/)
    },
    {
      id: 'known-scam-genre',
      label: 'known scam genre',
      surfaces: ['jobs', 'feed', 'messaging'],
      severity: 'scam',
      test: any(/\b(reshipping|package reshipping|parcel forwarding)\b|\bcrypto (payment|transaction) (processing|processor)\b|\bmystery shopper\b|\bmoney mule\b|\bcheck cashing\b|\bwire the (remaining|balance)\b/)
    },
    {
      id: 'unrealistic-pay',
      label: 'low-skill role, implausible pay',
      surfaces: ['jobs', 'feed'],
      severity: 'weak',
      test: (ctx) => LOW_SKILL.test(ctx.text) && HIGH_PAY.test(ctx.text)
    },
    {
      id: 'link-shortener',
      label: 'shortened apply link',
      surfaces: ['jobs', 'feed', 'messaging'],
      severity: 'weak',
      test: (ctx) => ctx.links.some((h) => SHORTENER.test(h)) || SHORTENER.test(ctx.text)
    },
    {
      id: 'no-company-page',
      label: 'no linked company page',
      surfaces: ['jobs'],
      severity: 'weak',
      test: (ctx) => Boolean(ctx.company) && !ctx.companyUrl
    },

    // ---- cross-card state (needs ctx.seen, populated by content.js) ----
    // ponytail: counts accumulate as you scroll, so a farm poster is only caught from
    // the card that crosses the threshold onward. Re-scanning earlier cards on every
    // increment is not worth it; upgrade path is a second pass on scroll idle.
    {
      id: 'spam-poster',
      label: 'poster spams many listings',
      surfaces: ['jobs'],
      severity: 'weak',
      test: (ctx) => Boolean(ctx.posterKey) && (ctx.seen.posters.get(ctx.posterKey) || 0) >= 8
    },
    {
      id: 'dupe-listing',
      label: 'duplicate listing spam',
      surfaces: ['jobs'],
      severity: 'weak',
      test: (ctx) => Boolean(ctx.dupeKey) && (ctx.seen.listings.get(ctx.dupeKey) || 0) >= 4
    }
  ];

  // A card collapses on one scam or farming hit, or on two weak hits. One weak hit
  // only dims. Single soft signals are where the false positives live.
  function verdict(hits) {
    if (!hits.length) return null;
    const hard = hits.find((h) => h.severity === 'scam' || h.severity === 'farming');
    if (hard) return { action: 'collapse', severity: hard.severity, hits };
    if (hits.length >= 2) return { action: 'collapse', severity: 'weak', hits };
    return { action: 'dim', severity: 'weak', hits };
  }

  function evaluate(ctx, surface, opts) {
    const off = (opts && opts.disabled) || [];
    const phrases = (opts && opts.phrases) || [];
    const hits = [];
    for (const rule of rules) {
      if (off.includes(rule.id)) continue;
      if (!rule.surfaces.includes(surface)) continue;
      let hit = false;
      try {
        hit = rule.test(ctx);
      } catch (_) {
        hit = false;
      }
      if (hit) hits.push({ id: rule.id, label: rule.label, severity: rule.severity });
    }
    const phrase = phrases.find((p) => p && ctx.text.includes(p.toLowerCase()));
    if (phrase) hits.push({ id: 'user-phrase', label: 'your phrase: ' + phrase, severity: 'farming' });
    return verdict(hits);
  }

  const api = { rules, evaluate, verdict, emptySeen: () => ({ posters: new Map(), listings: new Map() }) };
  root.LFB = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
