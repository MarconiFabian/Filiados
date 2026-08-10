import axios from 'axios';
import type { VercelRequest, VercelResponse } from '../lib/vercelTypes.js';
import { enforceRateLimit, requestContext, requireApiUser } from '../lib/apiAuth.js';
import { parseImageUrl } from '../lib/security.js';

function redirectUrl(options: Record<string, unknown>): URL {
  const protocol = String(options.protocol || 'https:');
  const hostname = String(options.hostname || '');
  const port = options.port ? `:${String(options.port)}` : '';
  const path = String(options.path || '/');
  return new URL(`${protocol}//${hostname}${port}${path}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const userId = await requireApiUser(req, res);
  if (!userId || !enforceRateLimit(res, `proxy-image:${userId}`, 60, 60_000)) return;
  const context = requestContext(req);

  try {
    const imageUrl = parseImageUrl(req.query.url);
    const response = await axios.get<ArrayBuffer>(imageUrl.toString(), {
      responseType: 'arraybuffer',
      timeout: 10_000,
      maxContentLength: 5_000_000,
      maxBodyLength: 5_000_000,
      maxRedirects: 2,
      beforeRedirect: (options) => {
        parseImageUrl(redirectUrl(options as unknown as Record<string, unknown>).toString());
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      },
    });

    const finalUrl = response.request?.res?.responseUrl;
    if (finalUrl) parseImageUrl(finalUrl);
    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('image/')) return res.status(415).json({ error: 'O endereço não retornou uma imagem.' });

    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', contentType);
    console.info('proxy_image_completed', { requestId: context.requestId, userId, durationMs: Date.now() - context.startedAt });
    return res.status(200).send(response.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao carregar imagem.';
    console.error('proxy_image_failed', { requestId: context.requestId, userId, durationMs: Date.now() - context.startedAt, error: message });
    return res.status(400).json({ error: message });
  }
}