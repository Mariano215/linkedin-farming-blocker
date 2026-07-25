# LinkedIn Farming & Scam Blocker

A Chrome extension that hides engagement farming and job scams on LinkedIn, and tells
you why it hid each one.

Nothing gets deleted. A flagged post collapses to a single line naming the rule that
fired, with a **show** button next to it. You always know what the filter is doing, which
means you can catch it being wrong and switch that rule off.

Works on job search results, the home feed, and the messaging pane.

> Screenshot goes here.

## The problem

Two different things clog up a LinkedIn job search.

The first is engagement farming. A post says it is hiring, but the link is behind
"comment INTERESTED and I'll DM you", or a repost, or a follow. The job may not exist.
The point of the post is the engagement.

The second is outright fraud. Contact only over WhatsApp or Telegram, a registration or
training fee, "direct joining, no interview", data entry at $55 an hour, reshipping and
mystery shopper work, an apply link behind a URL shortener.

LinkedIn's own filters do not touch either one. This extension does it locally, in your
browser, with no account and no network calls.

## What it matches

Behaviour, and only behaviour.

**Farming:** comment-gated links, DM gates, repost bait, follow bait, emoji walls.

**Scams:** WhatsApp or Telegram contact with a real handle or number, fees and deposits,
"no interview" and guaranteed selection, known scam genres (reshipping, mystery shopper,
crypto payment processing), URL shorteners as the only apply link, free-email recruiter
addresses, no linked company page, one poster spamming many listings, the same listing
reposted over and over.

A post collapses on one scam or farming hit, or on two weak hits. A single weak signal
only dims the post. That threshold exists because single soft signals are where the false
positives are.

There is also a negation guard. Posts warning people about these scams quote the exact
phrases they are warning about, so "please do not comment INTERESTED on random job posts"
stays visible.

### On nationality

No rule looks at nationality, country, ethnicity, name, or language.

That is a design decision, and it is also the accurate one. Fraudulent listings are
posted from everywhere, and in any country with a large recruiting industry the
overwhelming majority of recruiters are legitimate, so country of origin is a weak
predictor with an enormous false positive rate. The behaviour signals above are much
sharper: a real scam has to tell you to pay, or to move to WhatsApp, or to skip the
interview, and that is what gets matched.

`test/rules.test.mjs` contains explicit negative cases asserting that ordinary listings
from Bengaluru, Karachi, and Lahore are not flagged. If a change breaks that, the tests
fail.

## Install

Not on the Chrome Web Store. Load it yourself:

1. Clone or download this repository
2. Go to `chrome://extensions` and turn on Developer mode
3. Click **Load unpacked** and pick the folder
4. Open a LinkedIn job search and scroll

Chrome, Edge, Brave, and any other Chromium browser. Permissions requested: `storage`,
plus content-script access to `linkedin.com`. No host permissions for anything else, no
background worker, no telemetry.

## Tuning it

Open the extension's options page (`chrome://extensions`, Details, Extension options):

- A checkbox per rule, so you can switch off one that annoys you
- Your own phrases, one per line, treated as a farming hit
- An allowlist of companies, profile URLs, or phrases that must never be hidden
- A hit count per rule, so an over-firing rule is obvious

If something legitimate gets hidden, the stub tells you which rule did it. Uncheck it,
reload LinkedIn, done.

## How it is put together

| file | role |
| --- | --- |
| `rules.js` | the rule table and matchers. No DOM, so it is testable on its own |
| `cards.js` | card identity, content fingerprints, per-page counters |
| `counters.js` | batched hit counters with a retry |
| `content.js` | finds cards, applies verdicts, watches for new and recycled ones |
| `options.html`, `options.js` | toggles, phrases, allowlist, hit counts |

No build step, no bundler, no dependencies. The files Chrome loads are the files in the
repository.

## Tests

```
node --test test/*.mjs
```

20 tests, no framework, no dependencies. `rules.js`, `cards.js`, and `counters.js` all
set a global and also export for CommonJS, which is how the same file runs in a content
script and under node.

## Adding a rule

One entry in the `rules` array in `rules.js`:

```js
{
  id: 'my-rule',
  label: 'what the stub should say',
  surfaces: ['jobs', 'feed'],   // jobs | feed | messaging
  severity: 'scam',             // scam | farming | weak
  test: notNegated(/your regex/)
}
```

Then one test case in `test/rules.test.mjs`, and one negative case proving what it must
not match. The negative case is the important half. It is easy to write a rule that
catches every scam and half the real jobs too.

Matchers get a plain object, never a DOM node, so a test is one string in and one
assertion out.

## Known limits

LinkedIn rotates DOM class names and A/B tests card markup, so the selectors in
`content.js` will rot eventually. Matching is text and `data-*`-attribute based to slow
that down, and every stub states its reason so a broken rule is visible rather than
silent. If the hit table stops moving, the selectors need a look.

Cross-card rules (one poster spamming, the same listing repeated) count as you scroll, so
a farm poster is caught from the card that crosses the threshold onward, not
retroactively.

Hit counts are a tuning aid, not an audit log. Two tabs flushing at the same instant can
lose a delta.

## License

MIT. See `LICENSE`.
