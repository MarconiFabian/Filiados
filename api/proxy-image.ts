import axios from "axios";
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const imageUrl = req.query.url as string;
  if (!imageUrl) return res.status(400).send("URL is required");

  try {
    let finalUrl = imageUrl;
    if (finalUrl.startsWith('//')) {
      finalUrl = 'https:' + finalUrl;
    }

    const response = await axios.get(finalUrl, { 
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const contentType = response.headers['content-type'] as string || 'image/png';
    res.setHeader('Content-Type', contentType);
    return res.status(200).send(response.data);
  } catch (error) {
    console.error("Proxy error for URL:", imageUrl, error);
    return res.status(500).send("Failed to proxy image");
  }
}
