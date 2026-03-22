/**
 * Returns true if `latest` is strictly newer than `current`.
 * Both must be in MAJOR.MINOR.PATCH format (leading 'v' is stripped automatically).
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const stripVersionPrefix = (version: string) => version.replace(/^v/, '');
  const parseVersion = (version: string): [number, number, number] | null => {
    const parts = stripVersionPrefix(version).split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return null;
    return parts as [number, number, number];
  };
  const currentParsed = parseVersion(current);
  const latestParsed = parseVersion(latest);
  if (!currentParsed || !latestParsed) return false;
  if (latestParsed[0] !== currentParsed[0]) return latestParsed[0] > currentParsed[0];
  if (latestParsed[1] !== currentParsed[1]) return latestParsed[1] > currentParsed[1];
  return latestParsed[2] > currentParsed[2];
}
