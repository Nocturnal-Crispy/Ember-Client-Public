export function buildWsUrl(hostname: string, token: string): string {
  const normalizedHostname = hostname.replace(/\/+$/, '');
  return (
    normalizedHostname.replace(/^http/, 'ws').replace(/:8085\b/, ':8086') +
    `/ws?token=${encodeURIComponent(token)}`
  );
}
