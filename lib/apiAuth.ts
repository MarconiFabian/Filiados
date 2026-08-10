import type { VercelRequest, VercelResponse } from './vercelTypes.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'gen-lang-client-0772285066';
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

type RateEntry = { count: number; resetAt: number };
const rateEntries = new Map<string, RateEntry>();

export async function requireApiUser(req: VercelRequest, res: VercelResponse): Promise<string | null> {
  const header = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  const match = typeof header === 'string' ? header.match(/^Bearer\s+(.+)$/i) : null;
  if (!match) {
    res.status(401).json({ error: 'Faça login para continuar.' });
    return null;
  }

  try {
    const { payload } = await jwtVerify(match[1], FIREBASE_JWKS, {
      issuer: FIREBASE_ISSUER,
      audience: FIREBASE_PROJECT_ID,
      algorithms: ['RS256'],
    });
    if (!payload.sub) throw new Error('Token sem usuário.');
    return payload.sub;
  } catch (error) {
    console.warn('api_auth_rejected', { reason: error instanceof Error ? error.name : 'invalid_token' });
    res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
    return null;
  }
}

export function enforceRateLimit(
  res: VercelResponse,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const existing = rateEntries.get(key);
  const entry = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + windowMs } : existing;
  entry.count += 1;
  rateEntries.set(key, entry);

  if (rateEntries.size > 5_000) {
    for (const [entryKey, value] of rateEntries) {
      if (value.resetAt <= now) rateEntries.delete(entryKey);
    }
  }

  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
  if (entry.count <= limit) return true;

  const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  res.setHeader('Retry-After', String(retryAfter));
  res.status(429).json({ error: `Muitas tentativas. Aguarde ${retryAfter} segundos.` });
  return false;
}

export function requestContext(req: VercelRequest) {
  const header = req.headers['x-vercel-id'];
  return {
    requestId: (Array.isArray(header) ? header[0] : header) || `local-${Date.now()}`,
    startedAt: Date.now(),
  };
}