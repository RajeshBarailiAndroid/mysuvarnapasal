export function readEnv(name: string): string {
  const raw = process.env[name];
  if (raw == null || raw === '') return '';
  return String(raw).trim().replace(/^["']|["']$/g, '');
}
