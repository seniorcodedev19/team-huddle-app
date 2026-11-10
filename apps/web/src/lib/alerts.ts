/* Sound and desktop alerts for new notifications.

   Two separate settings, because they differ in kind. Sound is on unless
   turned off. A desktop alert needs the browser's permission, which may only
   be asked for in response to a click, so it is off until someone turns it
   on. Both are per-browser preferences and live in localStorage; every
   access is guarded, since storage can be blocked. */

const SOUND_KEY = "notif-sound";
const DESKTOP_KEY = "notif-desktop";
const ALERTED_KEY = "notif-alerted";

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* The choice just does not persist. */
  }
}

export const soundEnabled = () => read(SOUND_KEY) !== "0";
export const setSoundEnabled = (on: boolean) => write(SOUND_KEY, on ? "1" : "0");

/** What the browser will allow, independent of the user's own switch. */
export function desktopPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** On only when the user asked for it AND the browser still allows it. */
export const desktopEnabled = () => read(DESKTOP_KEY) === "1" && desktopPermission() === "granted";

/* Turning desktop alerts on asks the browser, which is why this must be
   called from a click handler. Resolves to whether they ended up on. */
export async function setDesktopEnabled(on: boolean): Promise<boolean> {
  if (!on) {
    write(DESKTOP_KEY, "0");
    return false;
  }
  if (desktopPermission() === "unsupported") return false;
  const permission =
    Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  const granted = permission === "granted";
  write(DESKTOP_KEY, granted ? "1" : "0");
  return granted;
}

/* Several tabs each poll the same feed. The first to see a notification
   records its id here, and the others stay quiet, so one event makes one
   sound rather than one per open tab. */
export function claimAlert(newestId: number) {
  if (Number(read(ALERTED_KEY) ?? 0) >= newestId) return false;
  write(ALERTED_KEY, String(newestId));
  return true;
}

let audio: AudioContext | null = null;

/* Browsers keep audio silent until the page has been interacted with. Called
   on the first click or key press so that a later chime, which arrives from
   a timer and not from a gesture, is allowed to play. */
export function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    /* No Web Audio: alerts are simply silent. */
  }
}

/* A short two-note chime, synthesised rather than loaded from a file: no
   asset to ship, nothing to fail to download. Quiet by design. */
export function chime() {
  try {
    unlockAudio();
    if (!audio || audio.state !== "running") return;
    const ctx = audio;
    const now = ctx.currentTime;
    for (const [freq, at] of [
      [880, 0],
      [1174.66, 0.16],
    ]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // A fast attack and a soft tail, so it rings instead of beeping.
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.16, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.42);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.45);
    }
  } catch {
    /* A failed chime must never break the feed. */
  }
}

/* A system notification — on Windows it appears in the corner and in the
   notification centre. `tag` makes the same event replace itself rather
   than stack if more than one tab raises it. */
export function showDesktop(opts: { title: string; body: string; tag: string; href: string | null }) {
  try {
    const n = new Notification(opts.title, { body: opts.body, tag: opts.tag, icon: "/icon.png" });
    n.onclick = () => {
      window.focus();
      if (opts.href) window.location.assign(opts.href);
      n.close();
    };
  } catch {
    /* Some browsers only allow this from a service worker; the sound and
       the in-app badge still tell the user. */
  }
}
