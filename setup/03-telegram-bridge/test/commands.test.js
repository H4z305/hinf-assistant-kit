// test/commands.test.js
const test = require("node:test");
const assert = require("node:assert");
const stop = require("../lib/commands/stop");
const help = require("../lib/commands/help");
const { commands } = require("../lib/commands");

test("every registered command has a description and a handler", () => {
  for (const [name, entry] of Object.entries(commands)) {
    if (name === "__callback__") {
      assert.strictEqual(typeof entry.handler, "function", `${name} needs a handler`);
      continue;
    }
    assert.strictEqual(typeof entry.description, "string", `/${name} needs a description`);
    assert.ok(entry.description.length > 0, `/${name} description must not be empty`);
    assert.strictEqual(typeof entry.handler, "function", `/${name} needs a handler`);
  }
});

test("/stop reports when nothing is running", async () => {
  const reply = await stop.handler({ router: { abortCurrent: () => false } });
  assert.match(reply, /nothing running/i);
});

test("/stop aborts a live run and confirms", async () => {
  let aborted = false;
  const reply = await stop.handler({
    router: { abortCurrent: () => { aborted = true; return true; } },
  });

  assert.strictEqual(aborted, true);
  assert.match(reply, /stopp/i);
});

test("/help lists every registered command with its description", async () => {
  const registry = {
    stop: { description: "Abort the run.", handler: () => {} },
    help: { description: "This list.", handler: () => {} },
  };
  const reply = await help.handler({ commands: registry });

  assert.ok(reply.includes("/stop"), "missing /stop");
  assert.ok(reply.includes("Abort the run."), "missing the stop description");
  assert.ok(reply.includes("/help"), "missing /help");
  assert.ok(reply.includes("This list."), "missing the help description");
});

test("/help excludes the callback pseudo-command", async () => {
  const registry = {
    __callback__: { handler: () => {} },
    help: { description: "This list.", handler: () => {} },
  };
  const reply = await help.handler({ commands: registry });

  assert.ok(!reply.includes("__callback__"), "the callback handler must not appear in help");
});

test("/help falls back to the real registry when none is injected", async () => {
  const reply = await help.handler({});
  assert.ok(reply.includes("/help"), "help must describe itself");
  assert.ok(reply.includes("/stop"), "help must list /stop");
});

test("the live registry exposes stop and help", () => {
  assert.ok(commands.stop, "/stop must be registered");
  assert.ok(commands.help, "/help must be registered");
});
