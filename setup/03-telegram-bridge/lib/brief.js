// lib/brief.js
// The morning brief. One implementation, two triggers: the 08:03 Scheduled Task
// (proactive-checkin.js) and the /brief command.
//
// Design note from the original author's brief spec: "more professional, more checkful, check the calendar
// thoroughly, check the week and flag something in the week, ask if I need to
// add something in the calendar at what time, free or busy."
//
// Almost all of that lives in the PROMPT rather than in code, because the brief
// is composed by Claude, which already has the calendar, Gmail and vault tools.
// What code owns is the two things Claude cannot cheaply fetch itself -- weather
// and prayer times -- plus assembling the instructions below.
const path = require("path");
const realFs = require("fs");

// Location for the weather + prayer-time lines of the brief. Defaults to the
// Qassim region, Saudi Arabia; override via .env (BRIEF_LAT / BRIEF_LON /
// BRIEF_CITY / BRIEF_COUNTRY). Leave BRIEF_CITY blank to drop the prayer line.
const LAT = process.env.BRIEF_LAT || 26.326;
const LON = process.env.BRIEF_LON || 43.975;

// Open-Meteo: free, no API key. https://open-meteo.com/
const WMO_DESCRIPTIONS = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain",
  71: "light snow", 73: "snow", 75: "heavy snow",
  80: "rain showers", 81: "rain showers", 82: "violent rain showers",
  95: "thunderstorm", 96: "thunderstorm", 99: "thunderstorm",
};

async function getWeather({ fetchFn = fetch } = {}) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FRiyadh`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Open-Meteo failed: ${res.status}`);
  const data = await res.json();
  const desc = WMO_DESCRIPTIONS[data.current.weather_code] || "unknown conditions";
  return `${Math.round(data.current.temperature_2m)}°C now, ${desc}, high ${Math.round(
    data.daily.temperature_2m_max[0]
  )}°C`;
}

// Aladhan: free, no API key, method 4 = Umm al-Qura (used in Saudi Arabia).
// Returns null when no BRIEF_CITY is configured — the caller renders that as
// "unavailable" and the brief simply omits the prayer line.
async function getPrayerTimes({
  fetchFn = fetch,
  city = process.env.BRIEF_CITY || "",
  country = process.env.BRIEF_COUNTRY || "Saudi Arabia",
} = {}) {
  if (!city) return null;
  const url =
    `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}` +
    `&country=${encodeURIComponent(country)}&method=4`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Aladhan failed: ${res.status}`);
  const data = await res.json();
  const t = data.data.timings;
  return `Fajr ${t.Fajr} · Dhuhr ${t.Dhuhr} · Asr ${t.Asr} · Maghrib ${t.Maghrib} · Isha ${t.Isha}`;
}

function buildBriefPrompt({ weatherLine, prayerLine, statePath, showAll = false }) {
  return `Compose the owner's brief and reply with ONLY the message text to send over Telegram. No preamble, no "here's the brief" framing, no closing pleasantry.

Weather (your area): ${weatherLine || "unavailable"}
Prayer times (your area, Umm al-Qura): ${prayerLine || "unavailable"}

## Structure — use these sections, in this order, every time

TODAY · <Weekday D Month>

<the opening line — see the tone rule below>

<weather line>
<prayer line>

CALENDAR — <n> events
  <HH:MM–HH:MM   Title>
                 <busy|free · location or "no location" · invite state if unanswered>
  <a closing line like "Clear after 11:00." or "Nothing scheduled.">

WEEK AHEAD — <n> flags
  <Day DD   the finding, and its consequence>

INBOX — <"nothing for you" or "<n> worth a look">
  <one line per item that genuinely matters; a count of the rest>

FROM ME
  <at most three lines — see below>

A section with nothing to report collapses to a single line rather than
disappearing. A missing section is ambiguous; an explicit "nothing" is
information.

## Tone — structure rigid, voice in exactly three slots

Warmth sprinkled everywhere becomes filler and gets skimmed, so it goes in
three places only, and each must carry information:

1. THE OPENING LINE must contain a judgment: the shape of the day, or the one
   thing that actually matters in it. "Dentist at 09:30 and nothing after —
   light day." "Three things back to back, no gaps." If there is genuinely
   nothing to judge, make it one short clause. NEVER "Good morning, hope you
   slept well" — that is the theatre this rule exists to prevent.
2. THE FLAGS state the finding AND its consequence. "Family lunch and gym both
   sit at 16:00. One has to move" beats "Overlap detected 16:00–17:00."
3. FROM ME is written as you asking them, not as a form field.

Everywhere else stays clipped. 24-hour times. No adjective that does no work.
At most one emoji, and only where it replaces a word. The data rows — weather,
prayer, calendar rows, inbox counts — carry no voice at all. They are a table
and should read like one.

## Today — check the calendar thoroughly

Use the Google Calendar tool. For every event today report start–end, whether
it is BUSY or FREE (the transparency field), its location, and whether an
invite is still unanswered. Do not summarise these away.

## Week ahead — findings only, never a listing

Scan the next 7 days and surface only what is WRONG or MISSING. Never list their
week back at them. The checks:
- two events overlapping
- back-to-back events in different locations with no travel gap
- an event that implies a place but has no location set
- an invite still unanswered
- a P0/P1 in second-brain/wiki/hot.md or log.md falling this week with nothing
  blocked in the calendar against it
- a weekday that is unusually empty against their normal pattern
- a timed event colliding with an all-day commitment

## Flag-once — this is what keeps thoroughness from becoming noise

Read ${statePath}. It already exists and is seeded for you (JSON:
{ "flags": [ { "id", "raisedAt", "detail" } ] }) -- you only ever UPDATE it.

- Raise a week-ahead flag ONCE. Then stay quiet about it.
- Re-raise it only when it is 48 hours away or closer, or when its underlying
  detail has changed.
- Drop resolved flags silently. Never announce good news.
- Give each flag a stable \`id\` derived from what it is about (for example
  "overlap-2026-08-21-1600"), so the same finding matches itself tomorrow.
- After composing the brief, WRITE the updated state back to that file.
${showAll ? "\n- OVERRIDE: this run was invoked with --all. Show every flag, including suppressed ones, and do not update the state file.\n" : ""}
Without this, a thorough week scan repeats itself every morning until they stop
reading it.

## Inbox

Check Gmail for anything unread or important in the last 16 hours. Flag only
what genuinely needs them. Everything else is a count, not a list.

## FROM ME — the two-way tail, at most three lines total

1. PROPOSALS: where you spotted a gap, suggest a specific block —
   "Want Thursday 16:00–18:00 blocked for the submission? Say the word."
2. THE STANDING INVITATION, always last:
   "Anything else going in today — time, and busy or free?"

If they ask you to add something, you may CREATE or EDIT calendar
events, but NEVER DELETE one — propose deletion and let them do it.

Before any write, echo the event back and wait for their confirmation: title,
date, start–end, busy or free, location. Never infer an unstated time or
busy/free state — ask. For an EDIT, show before → after on every field you are
changing; a silent overwrite of the wrong event is the one mistake here they
would not notice and could not easily undo.`;
}

// Seeds the flag-once state file if it is missing.
//
// The prompt asks Claude to "create it if it does not exist", and on the first
// live run it simply did not -- the brief came back fine and the file never
// appeared, which would have silently reduced flag-once to nothing and let the
// week scan repeat itself every morning. Asking a model to create a file as a
// side errand is unreliable; guaranteeing it in code and asking only for an
// UPDATE is not.
function ensureStateFile({ statePath, fsImpl = realFs, log = () => {} }) {
  try {
    if (fsImpl.existsSync(statePath)) return true;
    fsImpl.mkdirSync(path.dirname(statePath), { recursive: true });
    fsImpl.writeFileSync(statePath, JSON.stringify({ flags: [] }, null, 2), "utf8");
    log(`Seeded flag state at ${statePath}.`);
    return true;
  } catch (err) {
    log(`Could not seed flag state (${err.message}); the brief will still run.`);
    return false;
  }
}

// Composes and returns the brief text. Sending is the caller's job -- the
// Scheduled Task sends over raw fetch, /brief returns it through the router.
async function composeBrief({
  runner,
  statePath,
  showAll = false,
  log = () => {},
  fetchFn = fetch,
  fsImpl = realFs,
  briefCity = process.env.BRIEF_CITY || "",
}) {
  ensureStateFile({ statePath, fsImpl, log });

  let weatherLine;
  let prayerLine;

  try {
    weatherLine = await getWeather({ fetchFn });
  } catch (err) {
    log(`Weather fetch failed, continuing without it: ${err.message}`);
  }
  try {
    prayerLine = await getPrayerTimes({ fetchFn, city: briefCity });
  } catch (err) {
    log(`Prayer times fetch failed, continuing without it: ${err.message}`);
  }

  const prompt = buildBriefPrompt({ weatherLine, prayerLine, statePath, showAll });
  const result = await runner.run({ prompt });

  return {
    text: String(result.text || "").trim(),
    costUsd: result.costUsd,
    sessionId: result.sessionId,
  };
}

module.exports = {
  composeBrief,
  buildBriefPrompt,
  getWeather,
  getPrayerTimes,
  WMO_DESCRIPTIONS,
};
