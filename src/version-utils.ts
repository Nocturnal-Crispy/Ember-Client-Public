/**
 * Returns true if `latest` is strictly newer than `current`.
 * Both must be in MAJOR.MINOR.PATCH format (leading 'v' is stripped automatically).
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const strip = (v: string) => v.replace(/^v/, '');
  const parse = (v: string): [number, number, number] | null => {
    const parts = strip(v).split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return null;
    return parts as [number, number, number];
  };
  const c = parse(current);
  const l = parse(latest);
  if (!c || !l) return false;
  if (l[0] !== c[0]) return l[0] > c[0];
  if (l[1] !== c[1]) return l[1] > c[1];
  return l[2] > c[2];
}
