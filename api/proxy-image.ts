import axios from "axios";
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseImageUrl } from '../lib/security.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin;
  if (origin === 'https://web.whatsapp.com' || origin === 'https://ml-afiliados-pro.vercel.app') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).send('Método não permitido.');

  try {
    const imageUrl = parseImageUrl(req.query.url);

    const response = await axios.get(imageUrl.toString(), { 
      responseType: 'arraybuffer',
      timeout: 10_000,
      maxContentLength: 10_000_000,
      maxRedirects: 2,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const contentType = response.headers['content-type'] as string || 'image/png';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return res.status(415).send('O endereço não retornou uma imagem.');
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', contentType);
    return res.status(200).send(response.data);
  } catch (error) {
    console.error("Proxy image error:", error);
    return res.status(400).send(error instanceof Error ? error.message : 'Falha ao carregar imagem.');
  }
}
