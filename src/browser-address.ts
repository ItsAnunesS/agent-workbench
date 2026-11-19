export function browserAddress(raw: string): string {
  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value))
    return `http://${value}`;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  return `https://${value}`;
}
