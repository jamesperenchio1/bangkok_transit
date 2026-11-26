/**
 * A short haptic tick when a choice lands (start or destination set), so a
 * phone rider feels the tap register without looking down.
 *
 * Android browsers expose the Vibration API; iPhone Safari does not, and there
 * is nothing honest to polyfill it with (audio or CSS tricks are not haptics),
 * so there it is silently a no-op. Some browsers also refuse the call outside a
 * user gesture, which is why it can never be allowed to throw into the handler
 * that is actually doing the work.
 */
export function tapFeedback(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Refused (permissions policy, no API, page not focused): the tap still counts.
  }
}
