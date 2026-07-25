// Rule table. Pure data + matchers, no DOM. Loaded as a plain content script and
// imported by the node tests, so there is one source of truth for the rules.
//
// A matcher receives ctx:
//   { text, raw, links, title, company, companyUrl, posterUrl, posterCount, dupeCount }
// text is lowercased and whitespace-collapsed. posterCount / dupeCount are counts of
// distinct cards, supplied by the caller (see cards.js).
//
// Filtering is on behaviour only. No rule looks at nationality, country, name, or
// language of the poster: those do not predict scams and filtering on them is
// national-origin discrimination.

(function (root) {
  'use strict';

  const FREEMAIL = /@(gmail|googlemail|outlook|hotmail|yahoo|ymail|proton(mail)?|aol|mail|yandex|rediffmail)\.[a-z.]{2,}/;
  // lnkd.in is deliberately absent: it is LinkedIn's own shortener and shows up on
  // ordinary posts constantly, so matching it dimmed legitimate content.
  const SHORTENER = /\b(bit\.ly|tinyurl\.com|cutt\.ly|rb\.gy|is\.gd|t\.co|shorturl\.at)\//;
  const LOW_SKILL = /\b(data entry|typing|copy paste|form filling|chat support|remote assistant|package (handler|processor)|survey|mystery shopper)\b/;
  const HIGH_PAY = /(\$|usd\s?)\s?([3-9]\d|\d{3,})\s?(\/|per\s)\s?(hr|hour)|\$\s?[2-9]\d{3,}\s?(\/|per\s)\s?week/;

  // Posts warning people about farming and scams quote the exact phrases they warn
  // about. Without this, "please do not comment INTERESTED on random job posts" is
  // collapsed as farming.
  //
  // The gap allows no comma or semicolon, which is what separates a real negation from
  // urgency copy: "do not comment interested" negates, "don't miss this role, comment
  // interested" does not. Without that, farming posts opening with "Don't miss this!"
  // sailed straight through.
  const NEGATION = /\b(do not|does not|don['’]?t|dont|never|avoid|beware of|watch out for|warning|red flag|scam)\b[^.!?,;]{0,30}$/;

  function notNegated(re) {
    return (ctx) => {
      const m = re.exec(ctx.text);
      if (!m) return false;
      return !NEGATION.test(ctx.text.slice(Math.max(0, m.index - 45), m.index));
    };
  }

  const rules = [
    // ---- engagement farming (feed) ----
    {
      id: 'comment-gate',
      label: 'comment-gated job link',
      surfaces: ['feed'],
      severity: 'farming',
      test: notNegated(
        /\bcomment\s+["'“]?(interested|intrested|yes|link|me|hiring)\b|\btype\s+["'“]?interested\b|\bdrop\s+["'“]?interested\b|\bcomment\s+(below|down|here)\b[^.!?]{0,30}\b(for|to get|and i)\b|\bcomment\s+(below|down|here)\s+(for|to get)\b/
      )
    },
    {
      id: 'dm-gate',
      label: 'DM-gated link',
      surfaces: ['feed', 'messaging'],
      severity: 'farming',
      test: notNegated(/\b(dm|pm|inbox)\s+me\s+(for|to get)\b|\bsend me a (dm|pm)\b|\bdm for (the )?(link|details|jd)\b/)
    },
    {
      id: 'repost-bait',
      label: 'repost bait',
      surfaces: ['feed'],
      severity: 'farming',
      test: notNegated(/\brepost (this )?(for reach|to help)|\bshare (this )?to help someone\b|\btag someone who\b|\bhelp (this|it) reach\b/)
    },
    {
      id: 'follow-bait',
      label: 'follow bait',
      surfaces: ['feed'],
      severity: 'farming',
      test: notNegated(/\bfollow me for (daily |more )?(jobs|updates|openings)\b|\bturn on (my )?(post )?notifications\b|\bhit the bell\b/)
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
      // Needs an actual handle, number, or an explicit "contact me there" phrasing.
      // Matching the bare app name collapsed posts like "we use Signal now for incidents".
      test: notNegated(
        /\b(whats?app|telegram|signal)\b[^.!?]{0,40}(\+?\d[\d\s().-]{7,}|@[a-z0-9_]{4,})|\b(whats?app|telegram)\s+(me|us)\b|\b(message|contact|ping|reach|text|call)\s+(me|us)\s+(on|via|at|through)\s+(whats?app|telegram|signal)\b|\b(wa\.me\/|t\.me\/)/
      )
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
      test: notNegated(
        /\b(registration|processing|training|onboarding|placement|security)\s+(fee|charge|deposit|amount)\b|\brefundable deposit\b|\bpay\s*(₹|rs\.?|\$)\s?\d|\bpay\s+\d{2,}\s?(usd|inr|rupees|dollars|euros?)\b/
      )
    },
    {
      id: 'no-interview',
      label: 'no-interview / guaranteed offer',
      surfaces: ['jobs', 'messaging'],
      severity: 'scam',
      // No negation guard here on purpose: "no" is part of the signal itself.
      test: (ctx) =>
        /\bno interview\b|\bwithout interview\b|\bdirect joining\b|\binstant (offer|joining|hiring)\b|\bselection (is )?guaranteed\b|\b100% (job )?guarantee\b/.test(
          ctx.text
        )
    },
    {
      id: 'known-scam-genre',
      label: 'known scam genre',
      surfaces: ['jobs', 'feed', 'messaging'],
      severity: 'scam',
      test: notNegated(
        /\b(reshipping|package reshipping|parcel forwarding)\b|\bcrypto (payment|transaction) (processing|processor)\b|\bmystery shopper\b|\bmoney mule\b|\bcheck cashing\b|\bwire the (remaining|balance)\b/
      )
    },
    {
      // Third-party body-shop vocabulary. This is a business model, not a place: US-based
      // agencies use exactly the same language, and plenty of offshore recruiters never
      // touch it. That is the point, it matches the practice rather than the person.
      id: 'body-shop',
      label: 'third-party staffing / bench sales',
      surfaces: ['jobs', 'feed', 'messaging'],
      severity: 'weak',
      test: notNegated(
        /\b(corp to corp|corp-to-corp|c2c\b|bench sales|bench candidates|rate confirmation|hotlist|hot list of consultants|submit(ting)? (your )?(resume|profile) to (my|our) client|implementation partner|prime vendor|w2 only|1099 only|third party (staffing|vendor))\b/
      )
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
      // hrefs keep their original case, so lowercase before matching.
      test: (ctx) => ctx.links.some((h) => SHORTENER.test(String(h).toLowerCase())) || SHORTENER.test(ctx.text)
    },
    // Removed: 'no-company-page'. LinkedIn's job cards print the company as plain text
    // rather than a link to its page, so companyUrl was null on almost every card and the
    // rule dimmed nearly the whole result list. Not fixable at card level, since the
    // information simply is not in the card.

    // ---- cross-card state, counts supplied by the caller ----
    // ponytail: counts accumulate as you scroll, so a farm poster is only caught from
    // the card that crosses the threshold onward. Upgrade path is a second pass on
    // scroll idle.
    {
      id: 'spam-poster',
      label: 'poster spams many listings',
      surfaces: ['jobs'],
      severity: 'weak',
      test: (ctx) => (ctx.posterCount || 0) >= 8
    },
    {
      id: 'dupe-listing',
      label: 'duplicate listing spam',
      surfaces: ['jobs'],
      severity: 'weak',
      test: (ctx) => (ctx.dupeCount || 0) >= 4
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

    // Posters you blocked by hand. Deliberate, individual, and yours: no inference from
    // one person to a group, which is why this is a list you build and can see.
    const url = (ctx.posterUrl || '').toLowerCase();
    const name = (ctx.posterName || '').toLowerCase();
    const blocked = ((opts && opts.blockPosters) || []).find((p) => {
      const needle = String(p || '').toLowerCase();
      return needle && ((url && url.includes(needle)) || (name && name.includes(needle)));
    });
    if (blocked) hits.push({ id: 'blocked-poster', label: 'poster you blocked: ' + blocked, severity: 'farming' });

    return verdict(hits);
  }

  const api = { rules, evaluate, verdict };
  root.LFB = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
