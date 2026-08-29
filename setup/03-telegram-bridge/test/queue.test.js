// test/queue.test.js
const test = require("node:test");
const assert = require("node:assert");
const { createQueue } = require("../lib/queue");

const tick = () => new Promise((r) => setImmediate(r));

test("runs jobs strictly one at a time, in order", async () => {
  const q = createQueue();
  const order = [];
  const slow = (label, ms) => async () => {
    order.push(`${label}:start`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`${label}:end`);
  };

  const a = q.push(slow("a", 20));
  const b = q.push(slow("b", 1));
  await Promise.all([a.done, b.done]);

  assert.deepStrictEqual(order, ["a:start", "a:end", "b:start", "b:end"]);
});

test("reports busy and depth while a job runs", async () => {
  const q = createQueue();
  assert.strictEqual(q.busy, false);

  const job = q.push(() => new Promise((r) => setTimeout(r, 10)));
  assert.strictEqual(q.busy, true);
  assert.strictEqual(q.depth, 1);

  await job.done;
  await tick();
  assert.strictEqual(q.depth, 0);
});

test("refuses work past maxDepth without running it", async () => {
  const q = createQueue({ maxDepth: 2 });
  let ran = 0;
  const block = () => new Promise((r) => setTimeout(r, 15));

  const first = q.push(block);
  const second = q.push(block);
  const third = q.push(() => { ran += 1; });

  assert.strictEqual(third.accepted, false);
  assert.strictEqual(third.done, undefined);

  await Promise.all([first.done, second.done]);
  assert.strictEqual(ran, 0, "the rejected job must never run");
});

test("a failing job does not break the queue for the next one", async () => {
  const q = createQueue();
  const bad = q.push(async () => { throw new Error("boom"); });
  await assert.rejects(() => bad.done, /boom/);

  let ran = false;
  const good = q.push(async () => { ran = true; });
  await good.done;

  assert.strictEqual(ran, true);
  await tick();
  assert.strictEqual(q.depth, 0);
});

test("accepts work again after draining", async () => {
  const q = createQueue({ maxDepth: 1 });
  const first = q.push(() => new Promise((r) => setTimeout(r, 5)));
  assert.strictEqual(q.push(() => {}).accepted, false);

  await first.done;
  await tick();

  assert.strictEqual(q.push(() => {}).accepted, true);
});
