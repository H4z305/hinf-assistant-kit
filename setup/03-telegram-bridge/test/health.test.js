const test = require("node:test");
const assert = require("node:assert");
const { createHealth } = require("../lib/health");

function fakeFs() {
  const written = {};
  return {
    written,
    writeFile(file, data, cb) {
      written[file] = data;
      cb(null);
    },
    unlinkSync(file) {
      delete written[file];
    },
  };
}

test("write() serialises poller state as ISO timestamps", () => {
  const fsImpl = fakeFs();
  const poller = {
    state: {
      mode: "long",
      consecutiveFailures: 0,
      lastSuccessAt: 1786601760000,
      running: true,
    },
  };
  const health = createHealth({
    healthFile: "H",
    poller,
    startedAt: 1786600000000,
    fsImpl,
    now: () => 1786601790000,
  });

  health.write();

  const payload = JSON.parse(fsImpl.written.H);
  assert.equal(payload.pid, process.pid);
  assert.equal(payload.startedAt, new Date(1786600000000).toISOString());
  assert.equal(payload.ts, new Date(1786601790000).toISOString());
  assert.equal(payload.poller.lastSuccessAt, new Date(1786601760000).toISOString());
  assert.equal(payload.poller.mode, "long");
  assert.equal(payload.poller.consecutiveFailures, 0);
  assert.equal(payload.poller.running, true);
});

test("a poller that has never succeeded reports null, not a bogus date", () => {
  const fsImpl = fakeFs();
  const poller = { state: { mode: "long", consecutiveFailures: 0, lastSuccessAt: null, running: true } };
  const health = createHealth({ healthFile: "H", poller, startedAt: 1, fsImpl, now: () => 2 });

  health.write();

  assert.equal(JSON.parse(fsImpl.written.H).poller.lastSuccessAt, null);
});

test("start() writes immediately and then on the interval; stop() clears it", () => {
  const fsImpl = fakeFs();
  const poller = { state: { mode: "long", consecutiveFailures: 0, lastSuccessAt: null, running: true } };
  let tick = null;
  let cleared = null;
  const health = createHealth({
    healthFile: "H",
    poller,
    startedAt: 1,
    fsImpl,
    now: () => 2,
    intervalMs: 60000,
    setIntervalFn: (fn, ms) => {
      tick = { fn, ms };
      return "TIMER";
    },
    clearIntervalFn: (t) => {
      cleared = t;
    },
  });

  health.start();
  assert.ok(fsImpl.written.H, "start() must write once immediately, not wait 60s");
  assert.equal(tick.ms, 60000);

  health.stop();
  assert.equal(cleared, "TIMER");
  assert.equal(fsImpl.written.H, undefined, "stop() must remove the file so a dead bot never looks alive");
});
