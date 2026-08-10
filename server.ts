import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import type { VercelRequest, VercelResponse } from './lib/vercelTypes.js';
import improveTitleHandler from './api/improve-title.js';
import proxyImageHandler from './api/proxy-image.js';
import scrapeHandler from './api/scrape.js';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  const useVercelHandler = (handler: (req: VercelRequest, res: VercelResponse) => unknown) =>
    async (req: express.Request, res: express.Response) => {
      await handler(req as unknown as VercelRequest, res as unknown as VercelResponse);
    };

  app.all('/api/scrape', useVercelHandler(scrapeHandler));
  app.all('/api/proxy-image', useVercelHandler(proxyImageHandler));
  app.all('/api/improve-title', useVercelHandler(improveTitleHandler));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`ML Afiliados Pro disponível em http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error('Não foi possível iniciar o servidor:', error);
  process.exitCode = 1;
});