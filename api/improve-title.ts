import { GoogleGenAI } from '@google/genai';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!title || title.length > 500) {
    return res.status(400).json({ error: 'Informe um título válido.' });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'Configure GEMINI_API_KEY para usar a IA.' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Reescreva o título abaixo como uma chamada curta e atraente para uma oferta. Preserve o nome e as características principais do produto. Não invente preço, desconto, cupom ou benefício. Retorne somente o novo título, sem aspas.\n\nTítulo: ${title}`,
    });
    const improvedTitle = response.text?.trim();
    if (!improvedTitle) throw new Error('Resposta vazia');
    return res.status(200).json({ title: improvedTitle.slice(0, 500) });
  } catch (error) {
    console.error('Improve title error:', error);
    return res.status(502).json({ error: 'Não foi possível melhorar o título agora.' });
  }
}
