import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../counters.js';

const { makeCounter } = globalThis.LFBCounters;

// Fake chrome.storage.local. failNext makes the write fail once.
function fakeStorage(initial = {}) {
  const store = { counts: { ...initial } };
  return {
    store,
    failNext: false,
    writes: 0,
    get(defaults, cb) {
      cb({ counts: { ...store.counts } });
    },
    set(obj, cb) {
      this.writes++;
      if (this.failNext) {
        this.failNext = false;
        return cb({ message: 'QUOTA_BYTES quota exceeded' });
      }
      Object.assign(store, obj);
      cb(null);
    }
  };
}

const never = () => null; // no auto-flush, tests drive flush() directly

test('hits merge into whatever is already stored', async () => {
  const s = fakeStorage({ 'comment-gate': 5 });
  const c = makeCounter(s, { setTimeout: never });
  c.add(['comment-gate', 'dm-gate']);
  c.add(['comment-gate']);
  await new Promise((done) => c.flush(done));
  assert.deepEqual(s.store.counts, { 'comment-gate': 7, 'dm-gate': 1 });
  assert.equal(c.pending().size, 0);
});

test('fix: a failed write keeps the counts instead of dropping them', async () => {
  const s = fakeStorage();
  const c = makeCounter(s, { setTimeout: never });
  c.add(['pay-to-apply', 'pay-to-apply']);

  s.failNext = true;
  const err = await new Promise((done) => c.flush(done));
  assert.ok(err, 'flush reports the error');
  assert.equal(c.pending().get('pay-to-apply'), 2, 'counts survive a failed write');
  assert.deepEqual(s.store.counts, {}, 'nothing was written');

  await new Promise((done) => c.flush(done));
  assert.deepEqual(s.store.counts, { 'pay-to-apply': 2 }, 'the retry lands them');
});

test('fix: hits recorded during the async write are not lost', async () => {
  const s = fakeStorage();
  // set defers its callback, so there is a real gap to add hits into
  const deferred = [];
  s.set = function (obj, cb) {
    deferred.push(() => {
      Object.assign(this.store, obj);
      cb(null);
    });
  };
  const c = makeCounter(s, { setTimeout: never });

  c.add(['dm-gate']);
  const flushed = new Promise((done) => c.flush(done));
  c.add(['dm-gate']); // arrives mid-write
  deferred.pop()();
  await flushed;

  assert.equal(s.store.counts['dm-gate'], 1, 'only the snapshot was written');
  assert.equal(c.pending().get('dm-gate'), 1, 'the mid-write hit is still pending');

  s.set = (obj, cb) => {
    Object.assign(s.store, obj);
    cb(null);
  };
  await new Promise((done) => c.flush(done));
  assert.equal(s.store.counts['dm-gate'], 2, 'and lands on the next flush');
});

test('flushing with nothing pending does not write', async () => {
  const s = fakeStorage();
  const c = makeCounter(s, { setTimeout: never });
  await new Promise((done) => c.flush(done));
  assert.equal(s.writes, 0);
});
