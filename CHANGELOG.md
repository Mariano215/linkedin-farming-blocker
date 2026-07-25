# Changelog

## 0.1.0

First release.

- 15 behaviour-based rules across job search, the home feed, and messaging. Farming
  (comment gates, DM gates, repost and follow bait, emoji walls) and scams (off-platform
  contact, fees, "no interview", known scam genres, shorteners, free-email recruiters,
  body-shop vocabulary, implausible pay, poster spam, duplicate reposts).
- Flagged items collapse to a one-line reason with a **show** button. Display mode is
  configurable: collapse, hide completely, or dim only.
- Floating counter showing how many are hidden, with one click to reveal everything.
- Mark a card with <kbd>F</kbd>. The options page mines marked cards for phrases recurring
  across two or more of them and offers each as a rule you approve.
- The rule learner will not propose a rule keyed on nationality, country, a city used as a
  proxy, or a person-location framing. Those phrases are reported back with the reason,
  alongside the alternative: blocking that individual poster.
- Block posters by profile URL or displayed name.
- Per-rule toggles, custom phrases, an allowlist, hit counts, and a master off switch.
- No build step, no dependencies, no network calls. 31 tests under `node --test`.
- `demo/jobs/` runs the real rules over invented listings, for trying it without LinkedIn.

Notable bugs found and fixed before release, kept here because each one is a trap worth
remembering:

- Scanning per added DOM node froze the page. LinkedIn adds thousands of nodes per scroll
  with overlapping subtrees. Replaced with one debounced document-wide pass, plus a backoff
  if a pass ever exceeds 50ms.
- `no-company-page` dimmed nearly every job card, because LinkedIn prints the company as
  plain text rather than a link. Rule removed as unfixable at card level.
- Collapsing an ancestor container blanked whole page regions, since `querySelectorAll`
  returns ancestors as well as descendants. Only the innermost match is acted on now.
- A negation guard added to stop hiding posts that *warn* about farming then swallowed real
  farming posts opening with "Don't miss this". The guard now requires no comma between the
  negation and the match.
