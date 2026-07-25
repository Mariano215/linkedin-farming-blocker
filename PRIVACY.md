# Privacy

Short version: the extension sends nothing anywhere. There is no server, no account, no
analytics, and no network request of any kind in the codebase.

## What it reads

While you are on `linkedin.com`, the extension reads the text of job cards, feed posts,
and message list items on the page you are viewing. That reading happens in memory, to
decide whether a card matches a rule. Nothing about a card you did not mark is written
anywhere.

It does not run on any other site. The manifest grants content-script access to
`linkedin.com` only, and requests no other host permissions.

## What it stores, and where

Everything is stored by Chrome on your machine, through the extension `storage`
permission. Two buckets:

**Synced settings** (`chrome.storage.sync`, so they follow your Chrome profile if you have
Chrome Sync turned on):

- whether blocking is on, and the display mode
- which rules you switched off
- phrases you added
- your allowlist
- posters you blocked

**Local only** (`chrome.storage.local`, never synced):

- per-rule hit counts, for the options page table
- cards you marked with <kbd>F</kbd>: the first 600 characters of the card's text, its
  title, company, and the poster's name and profile URL. Capped at the 200 most recent.

Marked cards are the only page content that is persisted at all, and only for cards you
explicitly marked. They exist so the options page can suggest phrases to you. Clear them
any time with **Clear marked cards** in options.

## What it does not do

- No network requests. No telemetry, no crash reporting, no usage statistics, no remote
  rule updates.
- No reading or storing of your messages, connections, profile, or account data beyond the
  visible text of the cards described above.
- No cookies, no fingerprinting, no third-party code. There are no dependencies, so
  nothing runs that is not in this repository.
- Nothing is shared with Mattei Systems or anyone else. There is no recipient.

## Removing your data

Uninstalling the extension removes everything Chrome stored for it. To clear it without
uninstalling: **Clear marked cards** and **Reset counts** in the options page, and clear
the text fields.

## Verifying this

The extension has no build step, so the files Chrome loads are the files in this
repository. To check these claims yourself:

```
grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|navigator.send|import\(" *.js
```

That returns nothing. `manifest.json` lists the full permission set, which is `storage`
plus the `linkedin.com` content script.

## Contact

Open an issue on the repository.
