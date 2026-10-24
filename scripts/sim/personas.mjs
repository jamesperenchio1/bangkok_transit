// Simulated users. Each has a tone, a geolocation profile, a fixture profile
// and a scenario op (name of the function in harness.mjs). The `say()` function
// turns structured observations into persona-voiced complaints/comments.
//
// Voice is deterministic (rule-based templates) - no API calls.

const pick = (arr, seed) => arr[Math.abs(hash(seed)) % arr.length];
function hash(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0;
  return h;
}

// Generic lines per event. Persona-specific interjections are layered on top.
const LINES = {
  boot: [
    "Okay opening the app now…",
    "Alright, launching it…",
    "App's opening, let's see.",
  ],
  map_ready: [
    "Map's up, I can see the lines.",
    "The map loaded, looks right.",
    "Good, map's showing.",
  ],
  geo_ok: [
    "It found me on the map ({lat}, {lon}).",
    "Blue dot's there, it knows where I am.",
    "Location works, I can see myself.",
  ],
  geo_denied: [
    "Ugh, it's asking me to enable location and I can't see myself.",
    "Location's blocked — this banner is annoying.",
    "No location access. Why do I need to dig into settings?",
  ],
  geo_timeout: [
    "It's just… not finding me. No error, nothing.",
    "No location dot and no message. Did it give up?",
    "Still no position and it isn't telling me why.",
  ],
  geo_unsupported: [
    "No location at all on this device, silent about it.",
    "It just doesn't show me. No hint why.",
  ],
  nearest: [
    "It says nearest is {name} ({dist} away) — nice.",
    "Nearest: {name}. That's about right.",
    "Yes, {name} is the closest one.",
  ],
  search_open: ["Let me search a station…", "Opening search."],
  no_results: [
    "\"{q}\" gives me nothing. No suggestions either.",
    "Typed \"{q}\" and got zero results. Odd.",
  ],
  search_pick: ["Found {name}, tapping it.", "Picking {name}."],
  start_set: ["Set {name} as my start. ✓", "{name} is my start now."],
  dest_set: ["Destination is {name}. Go.", "{name} selected as destination."],
  route_drawn: [
    "Route's up: {stops} and {changes}.",
    "Okay, {stops}, {changes}. Makes sense.",
    "It drew the route — {stops}, {changes}.",
  ],
  transfer: [
    "Have to change at {at} to {line}. Fine.",
    "Transfer at {at}. I hate transfers but okay.",
  ],
  no_route: [
    "It says no route?! These are both on the map.",
    "No route found — that can't be right.",
  ],
  clear_route: ["Cleared it, starting over.", "Reset the route."],
  swap: ["Swapped start and destination.", "Swapped them around."],
  sheet_open: ["The route sheet slid up.", "Bottom panel opened."],
  sheet_close: ["Closed the panel.", "Hide the panel, got it."],
  arrivals_ok: [
    "Next train to {dest} in {eta}. That's what I wanted.",
    "Arrivals show {eta} for {dest}. Useful.",
    "I can see the next {n} trains, {eta} away.",
  ],
  arrivals_checking: [
    "It's still 'checking times…' — how long?",
    "Spinning on checking times. Hmm.",
  ],
  arrivals_unavailable: [
    "Times are unavailable and it's retrying. At least it says so.",
    "No times right now, 'retrying…' shown.",
  ],
  arrivals_not_running: [
    "Says not running, next ~{next}. Okay then.",
    "Line's closed — next service ~{next}.",
  ],
  arrivals_stale: [
    "These times are {age} old and flagged amber. Sketchy.",
    "It's showing {age}-old times as 'last known'. I'd rather know it's down.",
  ],
  arrivals_empty: [
    "Empty — 'No live arrivals right now'.",
    "Nothing showing for arrivals. Is the line dead?",
  ],
  arrivals_nolive: [
    "This line just says 'No live data for this line'.",
    "No live data here — expected I guess, but disappointing.",
  ],
  offline: [
    "I'm offline now — the map's gone grey.",
    "Lost signal; nothing's loading.",
  ],
  online_again: [
    "Back online, it caught up.",
    "Signal's back, times refreshing.",
  ],
  hidden: ["Switching to another app…", "Backgrounding it for a bit."],
  visible: ["Okay back to the app.", "Reopened it to the front."],
  reopen_seeded: [
    "Reopened and my times were there instantly — no blank wait.",
    "After reopening it remembered the times. Good.",
  ],
  reopen_fresh: [
    "Reopened and it went blank until it fetched. Meh.",
    "Had to wait for times again after reopening.",
  ],
  console_error: [
    "Something's erroring in the background: {msg}",
    "Console's throwing: {msg}",
  ],
  slow_req: [
    "That took {ms}ms to load. Slow.",
    "Loading stalled for {ms}ms.",
  ],
  many_requests: [
    "It's hammering the network — {n} calls so far.",
    "{n} requests and counting. That's a lot.",
  ],
  standalone: [
    "Installed it; it opened full-screen like a real app.",
    "Standalone mode works, no browser bars.",
  ],
  icons_missing: [
    "There's no app icon to install — the manifest has none.",
    "Can't add a proper icon; PWA install looks broken.",
  ],
  rapid_taps: [
    "I tapped a bunch of stations fast — did it keep up?",
    "Spamming taps to see if it chokes.",
  ],
  soak_summary: [
    "Been running a while: {errors} errors, {requests} requests.",
    "After {mins} min: {errors} errors, {requests} requests logged.",
  ],
  done: ["Okay, that's enough testing for me.", "I'm done with this app for now."],
};

export function say(persona, event, data = {}) {
  const tmpl = pick(LINES[event] || ["…"], persona.id + event);
  let line = tmpl.replace(/\{(\w+)\}/g, (_, k) => (data[k] ?? `{${k}}`));
  return line;
}

// Deterministic persona flavour prefix so voices differ.
function interjection(persona) {
  return persona.tics?.[0];
}

export const personas = [
  {
    id: "maya",
    name: "Maya (first-timer, tourist)",
    tone: "excited and easily confused",
    tics: ["Ooh, okay.", "Wait—", "Hmm!"],
    geo: { mode: "allow", position: { latitude: 13.745515, longitude: 100.534605, accuracy: 25 } },
    fixture: "normal",
    op: "scenarioFirstTimer",
  },
  {
    id: "somchai",
    name: "Somchai (daily commuter, GPS off)",
    tone: "gruff and time-pressed",
    tics: ["Right,", "Tsk.", "Come on."],
    geo: { mode: "denied" },
    fixture: "normal",
    op: "scenarioDeniedGps",
  },
  {
    id: "priya",
    name: "Priya (on the move)",
    tone: "quick, walking, checking as she goes",
    tics: ["Walking,", "One sec—", "Moving fast."],
    geo: {
      mode: "moving",
      track: [
        { latitude: 13.745515, longitude: 100.534605, accuracy: 20 },
        { latitude: 13.751931, longitude: 100.531535, accuracy: 20 },
        { latitude: 13.764, longitude: 100.538, accuracy: 22 },
        { latitude: 13.7805, longitude: 100.547, accuracy: 24 },
        { latitude: 13.802649, longitude: 100.553763, accuracy: 26 },
      ],
    },
    fixture: "normal",
    op: "scenarioMoving",
  },
  {
    id: "niran",
    name: "Niran (power user)",
    tone: "fast, skeptical, wants efficiency",
    tics: ["Okay so,", "Right—", "Efficient or bust."],
    geo: { mode: "allow", position: { latitude: 13.802649, longitude: 100.553763, accuracy: 18 } },
    fixture: "normal",
    op: "scenarioPowerUser",
  },
  {
    id: "jin",
    name: "Jin (spotty signal)",
    tone: "frustrated with connectivity",
    tics: ["Argh,", "Again?", "Hold on."],
    geo: { mode: "allow", position: { latitude: 13.745515, longitude: 100.534605, accuracy: 40 } },
    fixture: "partial",
    op: "scenarioSpottyNetwork",
  },
  {
    id: "arthit",
    name: "Arthit (app juggler)",
    tone: "constantly switching apps",
    tics: ["Brb,", "Back—", "Where was I."],
    geo: { mode: "allow", position: { latitude: 13.745515, longitude: 100.534605, accuracy: 30 } },
    fixture: "normal",
    op: "scenarioLifecycle",
  },
  {
    id: "lena",
    name: "Lena (impatient tapper)",
    tone: "fast and demanding",
    tics: ["Come ON.", "Faster.", "Ugh."],
    geo: { mode: "allow", position: { latitude: 13.745515, longitude: 100.534605, accuracy: 15 } },
    fixture: "normal",
    op: "scenarioStress",
  },
  {
    id: "guide",
    name: "Guide (PWA installer / soak)",
    tone: "methodical, long-session",
    tics: ["Let's leave it running.", "Note:", "Recording."],
    geo: { mode: "allow", position: { latitude: 13.745515, longitude: 100.534605, accuracy: 22 } },
    fixture: "normal",
    op: "scenarioPwaSoak",
  },
];

export const personaById = new Map(personas.map((p) => [p.id, p]));
export { interjection };
