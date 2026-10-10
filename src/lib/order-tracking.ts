const TRACKING_TOKEN_KEY = "bp-last-tracking-token";
const TRACKING_TOKEN_UPDATED_EVENT = "bp-tracking-token-updated";
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export function saveTrackingToken(token: string) {
  try {
    localStorage.setItem(TRACKING_TOKEN_KEY, token);
    window.dispatchEvent(new Event(TRACKING_TOKEN_UPDATED_EVENT));
  } catch {
    // The success screen still exposes the private tracking link if storage is unavailable.
  }
}

export function getSavedTrackingToken() {
  try {
    const token = localStorage.getItem(TRACKING_TOKEN_KEY);
    return token && UUID_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function subscribeToTrackingToken(callback: () => void) {
  window.addEventListener(TRACKING_TOKEN_UPDATED_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(TRACKING_TOKEN_UPDATED_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
