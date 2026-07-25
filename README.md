# LinkedIn Farming & Scam Blocker

[![test](https://github.com/Mariano215/linkedin-farming-blocker/actions/workflows/test.yml/badge.svg)](https://github.com/Mariano215/linkedin-farming-blocker/actions/workflows/test.yml)

A Chrome extension that hides engagement farming and job scams on LinkedIn, and tells you
why it hid each one.

Nothing is deleted. A flagged listing collapses to one line naming the rule that fired,
with a **show** button. A floating counter tells you how many are hidden and reveals them
all in one click. You can always see what the filter is doing, which is what lets you
catch it being wrong.

![Three scam listings collapsed to one-line reasons, one weak match dimmed, two clean
listings untouched, and a "4 hidden" counter](docs/screenshot.png)

*The demo page in `demo/jobs/`, running the real rules. Every listing in it is invented.*

## The problem

Two things clog a LinkedIn job search.

**Engagement farming.** The post says it is hiring, but the link is behind "comment
INTERESTED and I'll DM you", or a repost, or a follow. The job may not exist. The
engagement is the point.

**Fraud.** Contact only over WhatsApp or Telegram. A registration or training fee.
"Direct joining, no interview." Data entry at $55 an hour. Reshipping and mystery
shopper work. An apply link behind a URL shortener.

LinkedIn filters neither. This runs locally in your browser, with no account and no
network calls.

## Install

Not on the Chrome Web Store, so load it yourself:

1. `git clone https://github.com/Mariano215/linkedin-farming-blocker.git`
2. Open `chrome://extensions` and turn on **Developer mode** (top right)
3. Click **Load unpacked** (top left) and pick the folder
4. Open a LinkedIn job search and scroll

Works in Chrome, Edge, Brave, and other Chromium browsers. It asks for `storage` and
content-script access to `linkedin.com`. Nothing else: no other host permissions, no
background worker, no telemetry, no analytics.

After pulling an update, click the **reload** icon on the extension's card in
`chrome://extensions`, then reload your LinkedIn tab. Content script changes need both.

## What you get out of the box

Install it and it works with no configuration. Defaults:

| | default |
| --- | --- |
| Blocking | on |
| Flagged listings | collapse to a one-line reason, with **show** to expand |
| Surfaces | job search results, home feed, messaging |
| Marking | on (hover a card, press <kbd>F</kbd>) |
| Rules | all 15 on |
| Blocked posters | none, you add them |
| Your own phrases | none, you add them |

All 15 rules are on by default and match behaviour, never identity.

**Farming, on the feed:** comment-gated links ("comment INTERESTED"), DM gates, repost
bait, follow bait, emoji walls.

**Scams, on jobs and messaging:** WhatsApp or Telegram contact with a real handle or
number, fees and deposits, "no interview" and guaranteed selection, known scam genres
(reshipping, mystery shopper, crypto payment processing), third-party URL shorteners,
free-email recruiter addresses, third-party body-shop vocabulary (corp to corp, bench
sales, rate confirmation, hotlist), low-skill roles at implausible pay, one poster
spamming many listings, the same listing reposted repeatedly.

A listing collapses on one scam or farming hit, or on two weak hits. A single weak signal
only dims it. That threshold exists because single soft signals are where the false
positives live.

There is also a negation guard, because posts *warning* about these scams quote the exact
phrases they warn about. "Please do not comment INTERESTED on random job posts" stays
visible.

### On nationality

No rule looks at nationality, country, ethnicity, name, or language. Neither will the
rule learner: mark ten posts that happen to share a nationality and it will refuse to
propose that as a rule, and tell you why.

This is a design decision and it is also the accurate one. Fraud is posted from
everywhere, and in any country with a large recruiting industry the overwhelming majority
of recruiters are legitimate, so origin is a weak predictor with a huge false positive
rate. The behaviour signals are far sharper: a scam has to tell you to pay, or move to
WhatsApp, or skip the interview. That is what gets matched.

The `body-shop` rule is the useful version of a complaint often aimed at offshore
recruiters. It matches the business model, `corp to corp`, `bench sales`, `rate
confirmation`, which US-based agencies use just as much and many offshore recruiters
never touch.

If you do not want to see one specific person, block that person. See below.

## Using it

**The counter.** Bottom right of LinkedIn: `N hidden`. Click to reveal everything, click
again to re-hide. It is also the diagnostic. If it reads `40 hidden` on a page of 25
jobs, the rules are misfiring, not the page.

**Marking.** Hover any card and press <kbd>F</kbd>. The card outlines, a toast confirms,
and the text is stored locally. No button is injected into LinkedIn's markup, so nothing
about their layout changes.

**Turning marks into rules.** The options page mines your marked cards for phrases that
recur across two or more of them and lists them with an **Add** button. Nothing becomes a
rule until you click it. Phrases that identify people rather than describe behaviour are
listed separately under "Not suggested", with the reason.

**Blocking a poster.** Marked posters appear in options with a **Block this poster**
button, matching on profile URL or displayed name. This is a list you build one person at
a time and can read at any point.

**Options page:** `chrome://extensions` → **Details** → **Extension options**.

- Master on/off, so you never have to uninstall to escape a bad rule
- What flagged items do: collapse to a reason, hide completely, or only grey out
- A checkbox per rule
- Your own phrases, one per line
- An allowlist of companies, profile URLs, or phrases that must never be hidden
- Hit counts per rule, so an over-firing rule is obvious

If something legitimate gets hidden, the stub names the rule. Uncheck it, reload, done.

## Try it without LinkedIn

```
python3 -m http.server 8000
```

Open `http://localhost:8000/demo/jobs/`. Six invented listings, filtered by the real
`rules.js` and `content.js` with a small `chrome.storage` shim. Useful for seeing the
behaviour before installing, and for checking a rule change end to end without scrolling
a real feed.

## Tests

```
node --test test/*.mjs
```

31 tests, no framework, no dependencies, no build step.

| file | role |
| --- | --- |
| `rules.js` | rule table and matchers. No DOM, so it tests standalone |
| `cards.js` | card identity, content fingerprints, per-page counters |
| `counters.js` | batched hit counters with retry |
| `learn.js` | mines marked cards for candidate phrases, and the identity guard |
| `content.js` | finds cards, applies verdicts, watches for new and recycled ones |
| `options.html`, `options.js` | all settings and the learner UI |

The files Chrome loads are the files in the repository.

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

Then a test in `test/rules.test.mjs`, **and a negative case proving what it must not
match.** The negative case is the important half. Writing a rule that catches every scam
and half the real jobs with it is easy, and it has happened in this repo more than once.

Matchers receive a plain object, never a DOM node, so a test is one string in and one
assertion out.

## Known limits

LinkedIn rotates DOM class names and A/B tests card markup, so the selectors in
`content.js` will rot. Matching is text and `data-*`-attribute based to slow that down,
and every stub states its reason so a broken rule is visible rather than silent. If the
hit counts stop moving, the selectors need a look.

Cross-card rules (one poster spamming, a listing repeated) count as you scroll, so a farm
poster is caught from the card that crosses the threshold onward, not retroactively.

Scanning is one document-wide pass on a 300ms trailing timer, and it backs off to as much
as 5 seconds if a pass ever exceeds 50ms, logging `[lfb] scan took Nms`. If you see that
warning, the selectors are matching far more than intended.

Hit counts are a tuning aid, not an audit log. Two tabs flushing at the same instant can
lose a delta.

## Privacy

No network calls, no account, no telemetry. Marked cards and settings stay in Chrome's
local storage on your machine. See [PRIVACY.md](PRIVACY.md), which includes a one-line
grep to verify the no-network claim yourself.

## License

MIT, Mattei Systems. See `LICENSE`.
