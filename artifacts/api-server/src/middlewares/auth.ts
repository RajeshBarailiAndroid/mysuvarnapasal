import { type Request, type Response, type NextFunction } from 'express';
import { LOCAL_DEV_USER_ID } from '../lib/store.js';
import { isSupabaseEnabled } from '../lib/supabase-client.js';
import { isAuthConfigured, getUserIdFromToken } from '../lib/auth.js';

const PUBLIC_PATHS = new Set([
  '/healthz', '/health', '/auth/config', '/auth/login', '/auth/signup', '/auth/forgot-password',
  '/shared/gold-rates', '/shared/gold-rates/ticks', '/metal-rates'
]);

function isCronAuthorized(req: Request): boolean {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const auth = String(req.headers.authorization || '');
  if (auth === `Bearer ${secret}`) return true;
  return String(req.headers['x-cron-secret'] || '') === secret;
}

export function createAttachUser(cronSubPath: string) {
  return async function attachUser(req: Request, res: Response, next: NextFunction) {
    if (req.path === cronSubPath && isCronAuthorized(req)) {
      (req as any).isCron = true;
      return next();
    }
    if (PUBLIC_PATHS.has(req.path)) return next();
    // Customer request link: /public/<code>/... resolves its own shop from the
    // code in the path (routes/api.ts), so it never needs a signed-in user.
    if (req.path.startsWith('/public/')) return next();
    if (isAuthConfigured()) {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      const userId = await getUserIdFromToken(token);
      if (!userId) return res.status(401).json({ error: 'Sign in required.' });
      (req as any).userId = userId;
      return next();
    }
    if (isSupabaseEnabled()) return res.status(503).json({ error: 'Sign-in is not configured yet.' });
    (req as any).userId = LOCAL_DEV_USER_ID;
    return next();
  };
}
