/**
 * Helpers for detecting and converting Steam web URLs to the steam:// protocol.
 *
 * Supported Steam domains:
 *   https://store.steampowered.com/...
 *   https://steamcommunity.com/...
 *
 * Uses the steam://openurl/<url> scheme, which opens the page inside the
 * Steam client browser. If Steam is not installed the caller is responsible
 * for providing a fallback.
 */

const STEAM_DOMAINS = [
  'https://store.steampowered.com/',
  'https://steamcommunity.com/',
] as const;

/**
 * Returns true when `url` targets a known Steam web property.
 */
export function isSteamUrl(url: string): boolean {
  return STEAM_DOMAINS.some((domain) => url.startsWith(domain));
}

/**
 * Converts an https Steam URL into a steam:// protocol URL.
 * The Steam client will open the URL in its built-in browser.
 */
export function toSteamProtocolUrl(url: string): string {
  return `steam://openurl/${url}`;
}
