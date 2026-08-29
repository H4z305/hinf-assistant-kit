// test/brief.test.js
const test = require("node:test");
const assert = require("node:assert");
const { composeBrief, buildBriefPrompt, getWeather, getPrayerTimes } = require("../lib/brief");

// composeBrief seeds its state file for real, so any test that actually calls it
// must stub the filesystem -- otherwise it litters the repo with a file named
// after whatever statePath happened to be.
function noWriteFs() {
  return { existsSync: () => true, mkdirSync: () => {}, writeFileSync: () => {} };
}

// composeBrief seeds its state file for REAL. Any test that actually calls it
// must stub the filesystem, or it litters the repo with a file named after
// whatever statePath happened to be -- which is exactly what happened.
function noWriteFs() {
  return { existsSync: () => true, mkdirSync: () => {}, writeFileSync: () => {} };
}

function okJson(body) {
  return { ok: true, status: 200, json: async () => body };
}

const WEATHER_BODY = {
  current: { temperature_2m: 35.4, weather_code: 0 },
  daily: { temperature_2m_max: [45.2], temperature_2m_min: [31.6] },
};

const PRAYER_BODY = {
  data: { timings: { Fajr: "04:13", Dhuhr: "12:08", Asr: "15:40", Maghrib: "18:39", Isha: "20:09" } },
};

// --- fetchers ----------------------------------------------------------------

test("getWeather renders current temp, description and today's high", async () => {
  const line = await getWeather({ fetchFn: async () => okJson(WEATHER_BODY) });
  assert.match(line, /35°C now/);
  assert.match(line, /clear/);
  assert.match(line, /high 45°C/);
});

test("getWeather throws on a non-ok response", async () => {
  await assert.rejects(
    () => getWeather({ fetchFn: async () => ({ ok: false, status: 503 }) }),
    /Open-Meteo failed: 503/
  );
});

test("getPrayerTimes renders all five prayers", async () => {
  const line = await getPrayerTimes({ fetchFn: async () => okJson(PRAYER_BODY), city: "Testville" });
  for (const p of ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]) {
    assert.ok(line.includes(p), `missing ${p}`);
  }
});

// --- prompt ------------------------------------------------------------------

test("the prompt demands the fixed section order", () => {
  const p = buildBriefPrompt({ statePath: "S" });
  for (const section of ["TODAY", "CALENDAR", "WEEK AHEAD", "INBOX", "FROM ME"]) {
    assert.ok(p.includes(section), `prompt is missing the ${section} section`);
  }
});

test("the prompt carries the three-slot tone rule and bans greeting theatre", () => {
  const p = buildBriefPrompt({ statePath: "S" });
  assert.match(p, /opening line must contain a judgment/i);
  assert.match(p, /hope you\s*slept well/i, "must explicitly name the banned greeting");
  assert.match(p, /carry no voice at all/i);
});

test("the prompt lists all seven week-ahead checks", () => {
  const p = buildBriefPrompt({ statePath: "S" });
  const checks = [
    /overlapping/i,
    /back-to-back/i,
    /no location set/i,
    /invite still unanswered/i,
    /P0\/P1/,
    /unusually empty/i,
    /all-day/i,
  ];
  for (const c of checks) assert.match(p, c, `missing week check: ${c}`);
});

// Regression guard. The first live run produced a perfectly good brief while
// silently never creating brief-state.json -- the prompt asked Claude to create
// it and Claude just didn't. Flag-once would have degraded to nothing and the
// week scan would have repeated itself every morning, which is the exact noise
// problem the feature exists to prevent. Code seeds it now; the model only
// updates it.
test("seeds the state file before the run when it is missing", async () => {
  const written = new Map();
  const fsImpl = {
    existsSync: (p) => written.has(p),
    mkdirSync: () => {},
    writeFileSync: (p, d) => written.set(p, d),
  };

  await composeBrief({
    statePath: "DATA/brief-state.json",
    fsImpl,
    fetchFn: async () => { throw new Error("skip"); },
    runner: { run: async () => ({ text: "x" }) },
  });

  assert.ok(written.has("DATA/brief-state.json"), "state file must be seeded by code");
  assert.deepStrictEqual(JSON.parse(written.get("DATA/brief-state.json")), { flags: [] });
});

test("does not clobber an existing state file", async () => {
  const existing = JSON.stringify({ flags: [{ id: "keep-me" }] });
  const written = new Map([["DATA/brief-state.json", existing]]);
  const fsImpl = {
    existsSync: (p) => written.has(p),
    mkdirSync: () => {},
    writeFileSync: (p, d) => written.set(p, d),
  };

  await composeBrief({
    statePath: "DATA/brief-state.json",
    fsImpl,
    fetchFn: async () => { throw new Error("skip"); },
    runner: { run: async () => ({ text: "x" }) },
  });

  assert.strictEqual(written.get("DATA/brief-state.json"), existing, "existing flags must survive");
});

test("a failure to seed state does not stop the brief", async () => {
  const logs = [];
  const fsImpl = {
    existsSync: () => false,
    mkdirSync: () => { throw new Error("EACCES"); },
    writeFileSync: () => { throw new Error("EACCES"); },
  };

  const out = await composeBrief({
    statePath: "DATA/brief-state.json",
    fsImpl,
    log: (m) => logs.push(m),
    fetchFn: async () => { throw new Error("skip"); },
    runner: { run: async () => ({ text: "still fine" }) },
  });

  assert.strictEqual(out.text, "still fine");
  assert.ok(logs.some((l) => /seed flag state/i.test(l)));
});

test("the prompt wires flag-once state to the given path", () => {
  const p = buildBriefPrompt({ statePath: "C:/x/brief-state.json" });
  assert.ok(p.includes("C:/x/brief-state.json"));
  assert.match(p, /Raise a week-ahead flag ONCE/);
  assert.match(p, /48 hours away/);
});

test("the prompt permits create and edit but forbids delete", () => {
  const p = buildBriefPrompt({ statePath: "S" });
  assert.match(p, /NEVER DELETE/);
  assert.match(p, /before . after/i, "edits must require a before/after diff");
  assert.match(p, /wait for their confirmation/i);
});

test("--all mode overrides suppression and skips the state write", () => {
  const normal = buildBriefPrompt({ statePath: "S", showAll: false });
  const all = buildBriefPrompt({ statePath: "S", showAll: true });

  assert.ok(!normal.includes("OVERRIDE"));
  assert.match(all, /OVERRIDE/);
  assert.match(all, /do not update the state file/i);
});

// --- composeBrief ------------------------------------------------------------

test("composeBrief passes the assembled prompt to the runner and returns its text", async () => {
  let seenPrompt = null;
  const out = await composeBrief({
    statePath: "S",
    fsImpl: noWriteFs(),
    briefCity: "Testville",
    fetchFn: async (url) => okJson(String(url).includes("aladhan") ? PRAYER_BODY : WEATHER_BODY),
    runner: {
      run: async ({ prompt }) => {
        seenPrompt = prompt;
        return { text: "  TODAY · Tuesday 18 August  ", costUsd: 0.6, sessionId: "s1" };
      },
    },
  });

  assert.strictEqual(out.text, "TODAY · Tuesday 18 August");
  assert.strictEqual(out.costUsd, 0.6);
  assert.match(seenPrompt, /35°C now/, "weather must reach the prompt");
  assert.match(seenPrompt, /Fajr 04:13/, "prayer times must reach the prompt");
});

test("composeBrief still produces a brief when weather and prayer both fail", async () => {
  const logs = [];
  const out = await composeBrief({
    statePath: "S",
    fsImpl: noWriteFs(),
    briefCity: "Testville",
    log: (m) => logs.push(m),
    fetchFn: async () => { throw new Error("network down"); },
    runner: { run: async ({ prompt }) => ({ text: "brief anyway", costUsd: 0 }) },
  });

  assert.strictEqual(out.text, "brief anyway");
  assert.strictEqual(logs.length, 2, "both failures should be logged");
});

test("composeBrief marks unavailable inputs explicitly in the prompt", async () => {
  let seenPrompt = null;
  await composeBrief({
    statePath: "S",
    fsImpl: noWriteFs(),
    fetchFn: async () => { throw new Error("down"); },
    runner: { run: async ({ prompt }) => { seenPrompt = prompt; return { text: "x" }; } },
  });

  assert.match(seenPrompt, /Weather \(your area\): unavailable/);
  assert.match(seenPrompt, /Prayer times[^\n]*unavailable/);
});
