# LinkedIn Farming & Scam Blocker

Chrome extension (MV3) that collapses engagement-farming posts and scam job listings on
LinkedIn. Flagged items are not deleted: they collapse to a one-line stub that names the
rule that fired, with a "show" button, so you can see what the filter is doing and tune it.

Works on job search results, the home feed, and the messaging pane.

## What it matches

Behaviour, only. Farming: comment-gated job links ("comment INTERESTED"), DM gates,
repost bait, follow bait, emoji walls. Scams: WhatsApp/Telegram-only contact, fees and
deposits, "no interview / guaranteed selection", known scam genres (reshipping, mystery
shopper, crypto payment processing), link shorteners as the sole apply link, free-email
recruiter addresses, missing company page, one poster spamming many listings, the same
listing reposted over and over.

No rule looks at nationality, country, ethnicity, name, or language. Those do not predict
scams (fraud is posted from everywhere, and most recruiters in any given country are
legitimate) and filtering on them is national-origin discrimination. The behaviour rules
catch the actual bad posts with much better precision anyway. `test/rules.test.mjs` has
explicit negative cases asserting normal listings from India and Pakistan stay visible.

A card collapses on one scam or farming hit, or on two weak hits. A single weak signal
only dims the card.

## Install

1. `chrome://extensions`, enable Developer mode
2. "Load unpacked", pick this directory
3. Open the extension's options page to switch rules off, add your own phrases, add an
   allowlist, and see per-rule hit counts

## Test

```
node --test test/rules.test.mjs
```

## Files

| file | role |
| --- | --- |
| `rules.js` | rule table and matchers, no DOM, shared by the extension and the test |
| `content.js` | card discovery, collapse/expand, MutationObserver |
| `content.css` | stub and dim styles |
| `options.html` / `options.js` | toggles, phrases, allowlist, hit counts |

## Known ceiling

LinkedIn rotates DOM class names and A/B-tests card markup, so selectors rot over time.
Matching is therefore text and `data-*`-attribute based, and every stub states its reason.
If a rule starts over-firing or goes quiet, the hit table on the options page shows it.
