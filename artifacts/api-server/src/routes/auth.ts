import { Router, type Request, type Response } from 'express';
import { getClientAuthConfig } from '../lib/auth-config.js';
import { getSupabase } from '../lib/supabase-client.js';
import { ensureUserSettings } from '../lib/store.js';
import {
  normalizeUsername, usernameToEmail, isSyntheticAuthEmail,
  isValidUsername, isValidEmail, isValidPassword,
  isAuthConfigured, getAnonAuthClient, findUserByUsername,
  resolveAuthEmail, updateAuthenticatedUserPassword,
  displayNameFromUser, lookupDisplayNameFromDb
} from '../lib/auth.js';
import { isValidPhoneForRegion, normalizePhoneRegion, phoneErrorMessage } from '../lib/phone.js';

const FORGOT_PASSWORD_MESSAGE =
  'If an account matches, a reset link was sent to your email. Check your inbox and spam folder.';

function asyncRoute(fn: (req: any, res: any) => Promise<void | any>) {
  return (req: any, res: any, next: any) => fn(req, res).catch(next);
}

async function requireBearerUser(req: Request, res: Response): Promise<any | null> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) { res.status(401).json({ error: 'Authorization required.' }); return null; }
  const { getUserFromToken } = await import('../lib/auth.js');
  const user: any = await getUserFromToken(token);
  if (!user?.id) { res.status(401).json({ error: 'Invalid or expired token.' }); return null; }
  return user;
}

function getRecoveryRedirectUrl(req: Request): string {
  const configured = process.env.APP_URL || process.env.PUBLIC_APP_URL;
  if (configured) return `${String(configured).replace(/\/$/, '')}/reset-password.html`;
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:5000';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}/reset-password.html`;
}

function emailMatchesAccount(user: any, email: string): boolean {
  const provided = String(email || '').trim().toLowerCase();
  if (!provided) return false;
  const contact = String(user.user_metadata?.contact_email || '').trim().toLowerCase();
  const authEmail = String(user.email || '').trim().toLowerCase();
  return provided === contact || provided === authEmail;
}

function authErrorMessage(error: any): string {
  if (!error) return '';
  const message = String(error.message || error.msg || '').trim();
  if (!message || message === '{}') return 'Could not send reset link. Try again in a few minutes.';
  if (/rate limit/i.test(message)) return 'Too many reset emails sent. Please wait about an hour and try again.';
  return message;
}

function resetEmailForUser(user: any): string {
  const authEmail = String(user.email || '').trim().toLowerCase();
  const contactEmail = String(user.user_metadata?.contact_email || '').trim().toLowerCase();
  if (isSyntheticAuthEmail(authEmail) && contactEmail) return contactEmail;
  return authEmail;
}

export function createAuthRouter() {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.json(getClientAuthConfig());
  });

  router.get('/me', asyncRoute(async (req, res) => {
    if (!isAuthConfigured()) return res.status(503).json({ error: 'Sign-in is not configured yet.' });
    const admin = getSupabase();
    if (!admin) return res.status(503).json({ error: 'Server auth is not configured.' });
    const user = await requireBearerUser(req, res);
    if (!user) return;
    const { data: loaded, error: loadError } = await admin.auth.admin.getUserById(user.id);
    if (loadError || !loaded?.user) return res.status(404).json({ error: 'Account not found.' });
    const account = loaded.user;
    const displayName = await lookupDisplayNameFromDb(admin, account);
    if (displayName && !displayNameFromUser(account)) {
      await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...account.user_metadata, full_name: displayName } });
    }
    res.json({ ok: true, displayName, username: normalizeUsername(account.user_metadata?.username) });
  }));

  router.post('/signup', asyncRoute(async (req, res) => {
    // Sign-up is a mobile-app-only flow: the phone apps send this header, the web
    // build has no signup form, and anything else is refused here.
    if (String(req.get('X-SP-Client') || '').trim().toLowerCase() !== 'mobile') {
      return res.status(403).json({ error: 'New shop accounts are created from the SubarnaPasal mobile app. Download it and sign up there.' });
    }
    if (!isAuthConfigured()) return res.status(503).json({ error: 'Sign-in is not configured yet.' });
    const admin = getSupabase();
    const anon = getAnonAuthClient();
    if (!admin || !anon) return res.status(503).json({ error: 'Server auth is not configured.' });
    const username = normalizeUsername(req.body?.username);
    const fullName = String(req.body?.full_name || '').trim();
    const email = String(req.body?.email || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const password = String(req.body?.password || '');
    if (!isValidUsername(username)) return res.status(400).json({ error: 'Username must be 3–24 characters (letters, numbers, underscore).' });
    if (!fullName) return res.status(400).json({ error: 'Enter your full name.' });
    if (!email && !phone) return res.status(400).json({ error: 'Enter an email address or mobile number.' });
    if (email && !isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (phone && !isValidPhoneForRegion(phone, req.body?.phoneRegion)) return res.status(400).json({ error: phoneErrorMessage(normalizePhoneRegion(req.body?.phoneRegion)) });
    if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const authEmail = email ? email.toLowerCase() : usernameToEmail(username);
    const existing = await findUserByUsername(admin, username);
    if (existing) return res.status(409).json({ error: 'That username is already taken.' });
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email: authEmail, password, email_confirm: true, user_metadata: { username, full_name: fullName, phone: phone || null, contact_email: email || null } });
    if (createError) {
      const message = createError.message?.includes('already registered') ? 'That username is already taken.' : (createError.message || 'Could not create account.');
      return res.status(400).json({ error: message });
    }
    if (created?.user?.id) {
      try { await ensureUserSettings(admin, created.user.id); } catch (err: any) { console.warn(`Default settings not created:`, err.message); }
    }
    const { data, error: signInError } = await anon.auth.signInWithPassword({ email: authEmail, password });
    if (signInError) return res.status(201).json({ ok: true, session: null, message: 'Account created. You can log in now.' });
    res.status(201).json({ ok: true, session: data.session });
  }));

  router.post('/login', asyncRoute(async (req, res) => {
    if (!isAuthConfigured()) return res.status(503).json({ error: 'Sign-in is not configured yet.' });
    const admin = getSupabase();
    const anon = getAnonAuthClient();
    if (!admin || !anon) return res.status(503).json({ error: 'Server auth is not configured.' });
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');
    if (!isValidUsername(username)) return res.status(400).json({ error: 'Incorrect username or password.' });
    if (!isValidPassword(password)) return res.status(400).json({ error: 'Incorrect username or password.' });
    const authEmail = await resolveAuthEmail(admin, username);
    const { data, error } = await anon.auth.signInWithPassword({ email: authEmail, password });
    if (error) return res.status(401).json({ error: 'Incorrect username or password.' });
    res.json({ ok: true, session: data.session });
  }));

  router.post('/forgot-password', asyncRoute(async (req, res) => {
    if (!isAuthConfigured()) return res.status(503).json({ error: 'Sign-in is not configured yet.' });
    const admin = getSupabase();
    const anon = getAnonAuthClient();
    if (!admin || !anon) return res.status(503).json({ error: 'Server auth is not configured.' });
    const username = normalizeUsername(req.body?.username);
    const email = String(req.body?.email || '').trim();
    if (!isValidUsername(username) || !email || !isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid username and email.' });
    const user = await findUserByUsername(admin, username);
    if (!user || !emailMatchesAccount(user, email)) return res.json({ ok: true, message: FORGOT_PASSWORD_MESSAGE });
    const resetEmail = resetEmailForUser(user);
    let { error } = await anon.auth.resetPasswordForEmail(resetEmail, { redirectTo: getRecoveryRedirectUrl(req) });
    const authEmail = String(user.email || '').trim().toLowerCase();
    if (error && resetEmail !== authEmail) {
      ({ error } = await anon.auth.resetPasswordForEmail(authEmail, { redirectTo: getRecoveryRedirectUrl(req) }));
    }
    if (error) {
      const message = authErrorMessage(error);
      console.warn('Forgot password email:', message);
      const status = /rate limit/i.test(message) ? 429 : 500;
      return res.status(status).json({ error: message });
    }
    return res.json({ ok: true, message: FORGOT_PASSWORD_MESSAGE });
  }));

  router.post('/change-password', asyncRoute(async (req, res) => {
    if (!isAuthConfigured()) return res.status(503).json({ error: 'Sign-in is not configured yet.' });
    const anon = getAnonAuthClient();
    const admin = getSupabase();
    if (!anon) return res.status(503).json({ error: 'Sign-in is not configured yet.' });
    const user = await requireBearerUser(req, res);
    if (!user?.email) return;
    const currentPassword = String(req.body?.currentPassword || '');
    const password = String(req.body?.password || '');
    const confirm = String(req.body?.confirm || '');
    if (!isValidPassword(currentPassword)) return res.status(400).json({ error: 'Enter your current password.' });
    if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (password !== confirm) return res.status(400).json({ error: 'Passwords do not match.' });
    if (password === currentPassword) return res.status(400).json({ error: 'Choose a different password.' });
    const { data: signInData, error: verifyError } = await anon.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (verifyError) return res.status(401).json({ error: 'Current password is incorrect.' });
    const freshToken = signInData?.session?.access_token;
    if (!freshToken) return res.status(400).json({ error: 'Could not verify your password. Try again.' });
    const { error: updateError } = await updateAuthenticatedUserPassword(freshToken, password);
    if (updateError) return res.status(400).json({ error: updateError });
    if (admin) await admin.auth.admin.signOut(user.id, 'global').catch(() => {});
    res.json({ ok: true, message: 'Password updated.' });
  }));

  return router;
}
