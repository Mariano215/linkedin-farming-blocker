// Batched hit counters. Split out of content.js so the retry path is testable.
(function (root) {
  'use strict';

  // storage: { get(defaults, cb), set(obj, cb(err)) }
  function makeCounter(storage, options) {
    const opts = options || {};
    const delay = opts.delay == null ? 5000 : opts.delay;
    const timer = opts.setTimeout || setTimeout;
    const pending = new Map();
    let queued = null;

    function schedule() {
      if (queued) return;
      queued = timer(() => {
        queued = null;
        flush();
      }, delay);
    }

    function add(ids) {
      for (const id of ids) pending.set(id, (pending.get(id) || 0) + 1);
      if (pending.size) schedule();
    }

    // ponytail: read-modify-write, so two tabs flushing in the same instant can still
    // lose the smaller delta. Counts are a tuning aid, not billing. Upgrade path is a
    // service worker owning the writes.
    function flush(done) {
      if (!pending.size) {
        if (done) done(null);
        return;
      }
      // Snapshot rather than clear: hits recorded during the async gap must survive,
      // and a failed write must not drop what we already counted.
      const snapshot = new Map(pending);
      storage.get({ counts: {} }, (data) => {
        const merged = Object.assign({}, (data && data.counts) || {});
        for (const [id, n] of snapshot) merged[id] = (merged[id] || 0) + n;
        storage.set({ counts: merged }, (err) => {
          if (err) {
            schedule();
          } else {
            for (const [id, n] of snapshot) {
              const left = (pending.get(id) || 0) - n;
              if (left > 0) pending.set(id, left);
              else pending.delete(id);
            }
          }
          if (done) done(err || null);
        });
      });
    }

    return { add, flush, pending: () => new Map(pending) };
  }

  const api = { makeCounter };
  root.LFBCounters = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
