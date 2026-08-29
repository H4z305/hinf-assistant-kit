// test/watchdog.test.js
const test = require("node:test");
const assert = require("node:assert");
const { checkAndRestart } = require("../watchdog");

function harness({ pidContents = null, aliveP = new Set() } = {}) {
  const logs = [];
  const spawned = [];

  const fsImpl = {
    existsSync: (f) => f === "bot.pid" && pidContents !== null,
    readFileSync: () => {
      if (pidContents === null) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return pidContents;
    },
  };

  const killFn = (pid) => {
    if (!aliveP.has(pid)) {
      const err = new Error("ESRCH");
      err.code = "ESRCH";
      throw err;
    }
    return true;
  };

  const spawnFn = (exe, args, opts) => {
    spawned.push({ exe, args, opts });
    return { unref: () => {}, pid: 999 };
  };

  return { fsImpl, killFn, spawnFn, logs, spawned, log: (m) => logs.push(m) };
}

test("reports alive and starts nothing when the bridge is running", () => {
  const h = harness({ pidContents: "1234", aliveP: new Set([1234]) });

  const result = checkAndRestart({
    pidFile: "bot.pid", fsImpl: h.fsImpl, killFn: h.killFn, spawnFn: h.spawnFn, log: h.log,
  });

  assert.strictEqual(result, "alive");
  assert.strictEqual(h.spawned.length, 0, "must not start a second instance");
});

test("restarts when the recorded pid is dead", () => {
  const h = harness({ pidContents: "1234", aliveP: new Set() });

  const result = checkAndRestart({
    pidFile: "bot.pid", fsImpl: h.fsImpl, killFn: h.killFn, spawnFn: h.spawnFn, log: h.log,
  });

  assert.strictEqual(result, "restarted");
  assert.strictEqual(h.spawned.length, 1);
});

test("starts the bridge when there is no pid file at all", () => {
  const h = harness({ pidContents: null });

  const result = checkAndRestart({
    pidFile: "bot.pid", fsImpl: h.fsImpl, killFn: h.killFn, spawnFn: h.spawnFn, log: h.log,
  });

  assert.strictEqual(result, "started");
  assert.strictEqual(h.spawned.length, 1);
});

test("treats a garbage pid file as dead rather than crashing", () => {
  const h = harness({ pidContents: "not-a-number" });

  const result = checkAndRestart({
    pidFile: "bot.pid", fsImpl: h.fsImpl, killFn: h.killFn, spawnFn: h.spawnFn, log: h.log,
  });

  assert.strictEqual(result, "started");
  assert.strictEqual(h.spawned.length, 1);
});

test("spawns detached and fully silent, so no window can appear", () => {
  const h = harness({ pidContents: "1234", aliveP: new Set() });

  checkAndRestart({
    pidFile: "bot.pid", fsImpl: h.fsImpl, killFn: h.killFn, spawnFn: h.spawnFn, log: h.log,
  });

  const opts = h.spawned[0].opts;
  assert.strictEqual(opts.detached, true, "must outlive the watchdog process");
  assert.strictEqual(opts.stdio, "ignore", "must not hold a console handle");
  assert.strictEqual(opts.windowsHide, true, "a visible window would interrupt a game");
});

test("a spawn failure is logged, not thrown", () => {
  const h = harness({ pidContents: "1234", aliveP: new Set() });
  h.spawnFn = () => { throw new Error("EACCES"); };

  let result;
  assert.doesNotThrow(() => {
    result = checkAndRestart({
      pidFile: "bot.pid", fsImpl: h.fsImpl, killFn: h.killFn, spawnFn: h.spawnFn, log: h.log,
    });
  });

  assert.strictEqual(result, "failed");
  assert.ok(h.logs.some((l) => /EACCES/.test(l)));
});

test("uses signal 0, which probes liveness without signalling the process", () => {
  const signals = [];
  const h = harness({ pidContents: "1234", aliveP: new Set([1234]) });
  const killFn = (pid, sig) => { signals.push(sig); return true; };

  checkAndRestart({
    pidFile: "bot.pid", fsImpl: h.fsImpl, killFn, spawnFn: h.spawnFn, log: h.log,
  });

  assert.deepStrictEqual(signals, [0]);
});

test("a paused watchdog does not restart a dead bot", () => {
  let spawned = false;
  const outcome = checkAndRestart({
    pidFile: "PID",
    pauseFile: "PAUSE",
    fsImpl: {
      existsSync: (f) => f === "PAUSE", // pause flag present, pid file absent
      readFileSync: () => "",
    },
    killFn: () => {
      throw new Error("dead");
    },
    spawnFn: () => {
      spawned = true;
      return { unref() {} };
    },
  });

  assert.equal(outcome, "paused");
  assert.equal(spawned, false, "Stop must hold; resurrecting the bot makes the button look broken");
});

test("clearing the pause flag restores normal restarting", () => {
  let spawned = false;
  const outcome = checkAndRestart({
    pidFile: "PID",
    pauseFile: "PAUSE",
    fsImpl: {
      existsSync: () => false, // neither pause flag nor pid file
      readFileSync: () => "",
    },
    killFn: () => {
      throw new Error("dead");
    },
    spawnFn: () => {
      spawned = true;
      return { unref() {} };
    },
  });

  assert.equal(outcome, "started");
  assert.equal(spawned, true);
});
