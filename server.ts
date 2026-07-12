import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenAI } from "@google/genai";
import { parseImageUrl, parseMarketplaceUrl } from "./lib/security.js";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.options('/api/proxy-image', (req, res) => {
    const origin = req.headers.origin;
    if (origin === 'https://web.whatsapp.com' || origin === 'https://ml-afiliados-pro.vercel.app') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.status(204).end();
  });
  
  // API route to proxy images for clipboard
  app.get("/api/proxy-image", async (req, res) => {
    const origin = req.headers.origin;
    if (origin === 'https://web.whatsapp.com' || origin === 'https://ml-afiliados-pro.vercel.app') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(response.data);
    } catch (error) {
      console.error("Proxy image error:", error);
      res.status(400).send(error instanceof Error ? error.message : 'Falha ao carregar imagem.');
    }
  });

  app.post("/api/improve-title", async (req, res) => {
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
      return res.json({ title: improvedTitle.slice(0, 500) });
    } catch (error) {
      console.error('Improve title error:', error);
      return res.status(502).json({ error: 'Não foi possível melhorar o título agora.' });
    }
  });

  // API Route for scraping
  app.get("/api/scrape", async (req, res) => {
    try {
      const safeUrl = parseMarketplaceUrl(req.query.url);
      const response = await axios.get(safeUrl.toString(), {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        },
        timeout: 10000,
        maxContentLength: 2_000_000,
        maxRedirects: 3,
      });
      const $ = cheerio.load(response.data);
      
      const title = $('.ui-pdp-title').text().trim() || 
                    $('.shopee-product-info__header__text').text().trim() ||
                    $('#productTitle').text().trim() ||
                    $('.product-title-text').text().trim() ||
                    $('meta[property="og:title"]').attr('content') || 
                    $('title').text().trim();
                    
      const image = $('.ui-pdp-image').attr('data-zoom') || 
                    $('.ui-pdp-image').attr('src') || 
                    $('.shopee-product-images img').attr('src') ||
                    $('#imgTagWrapperId img').attr('src') ||
                    $('.image-view-magnifier-wrap img').attr('src') ||
                    $('meta[property="og:image"]').attr('content');
      
      // Attempt to find store name
      let store = "Loja Oficial";
      store = "Mercado Livre";

      // Attempt to find price in standard ML patterns
      let price = "";
      let originalPrice = "";
      
      const allPrices: { fraction: string, cents: string, isPrevious: boolean }[] = [];
      
      $('.andes-money-amount').each((i, el) => {
        const $el = $(el);
        if ($el.closest('.ui-pdp-installments, .ui-search-installments').length > 0) return;
        
        let fraction = $el.find('.andes-money-amount__fraction').text().trim().replace(/[^0-9]/g, '');
        let cents = $el.find('.andes-money-amount__cents').text().trim().replace(/[^0-9]/g, '');
        
        if (!fraction) {
           const fullText = $el.text().trim();
           const match = fullText.match(/(\d+)[,\.](\d{2})/);
           if (match) {
             fraction = match[1];
             cents = match[2];
           } else {
             const onlyNums = fullText.replace(/[^0-9]/g, '');
             if (onlyNums.length > 2) {
                fraction = onlyNums.slice(0, -2);
                cents = onlyNums.slice(-2);
             } else {
                fraction = onlyNums;
                cents = "00";
             }
           }
        }
        
        const isPrevious = $el.hasClass('andes-money-amount--previous') || 
                          $el.closest('.ui-pdp-price__old').length > 0 ||
                          $el.closest('.ui-pdp-price__original-value').length > 0;
        
        if (fraction) {
          allPrices.push({ fraction, cents: cents || "00", isPrevious });
        }
      });

      // Price extraction for other stores or if ML patterns failed
      if (allPrices.length === 0) {
          const genericPriceSelectors = [
              '.price-tag-fraction', 
              '.shopee-price', 
              '.ui-pdp-price__main-container .andes-money-amount__fraction',
              '.price-tag-amount .andes-money-amount__fraction',
              '.andes-money-amount__fraction',
              '.priceToPay', 
              '.product-price-value',
              '.a-offscreen',
              '[itemprop="price"]'
          ];
          
          for (const selector of genericPriceSelectors) {
              const text = $(selector).first().text().trim();
              if (text) {
                  const match = text.match(/(\d+)[,\.](\d{2})/);
                  if (match) {
                      price = `${match[1]},${match[2]}`;
                      break;
                  } else {
                      const simpleMatch = text.replace(/[^0-9]/g, '');
                      if (simpleMatch) {
                          const cents = $(selector).parent().find('.andes-money-amount__cents').first().text().trim() || '00';
                          price = `${simpleMatch},${cents}`;
                          break;
                      }
                  }
              }
          }

          const genericOriginalPriceSelectors = [
              '.shopee-price-before-discount',
              '.basisPrice',
              '.product-price-del',
              '.a-text-strike',
              '.ui-pdp-price__original-value .andes-money-amount__fraction',
              '.andes-money-amount--previous .andes-money-amount__fraction',
              'del .andes-money-amount__fraction',
              'del',
              '.price-old'
          ];

          for (const selector of genericOriginalPriceSelectors) {
            const text = $(selector).first().text().trim();
            if (text) {
                const match = text.match(/(\d+)[,\.](\d{2})/);
                if (match) {
                    originalPrice = `${match[1]},${match[2]}`;
                    break;
                } else {
                    const simpleMatch = text.replace(/[^0-9,.]/g, '').replace('.', ',');
                    if (simpleMatch && simpleMatch.length > 0) {
                        originalPrice = simpleMatch;
                        if (!originalPrice.includes(',')) originalPrice += ',00';
                        break;
                    }
                }
            }
          }
      }

      // Original Price from ML Pattern
      if (!originalPrice) {
        const originalObj = allPrices.find(p => p.isPrevious);
        if (originalObj) {
          originalPrice = `${originalObj.fraction},${originalObj.cents}`;
        }
      }

      // Current Price from ML Pattern
      if (!price) {
        const currentObj = allPrices.find(p => !p.isPrevious);
        if (currentObj) {
          price = `${currentObj.fraction},${currentObj.cents}`;
        }
      }

      // Fallback 1: Meta tags (Geralmente preço atual)
      if (!price) {
        const metaPrice = $('meta[property="product:price:amount"]').attr('content') || 
                          $('meta[itemprop="price"]').attr('content');
        if (metaPrice) price = metaPrice.replace('.', ',');
      }

      // Fallback 2: Se só tem um preço e não foi categorized como original nem current
      if (!price && allPrices.length > 0) {
        price = `${allPrices[0].fraction},${allPrices[0].cents}`;
      }

      // 4. Find Coupons
      let coupon = "";
      const couponSelectors = [
        '.ui-pdp-promotions-pill-label',
        '.shopee-voucher-ticket',
        '.coupon-code',
        '.ui-pdp-promotions__title',
        '.ui-pdp-vpp-label'
      ];
      
      for (const selector of couponSelectors) {
        const text = $(selector).text();
        if (text && (text.toUpperCase().includes('CUPOM') || text.toUpperCase().includes('USE'))) {
          // Extract pattern like "CUPOM10" or "MASTER"
          const match = text.match(/[A-Z0-9]{4,}/);
          if (match) {
            coupon = match[0];
            break;
          }
        }
      }

      // Sanitize
      price = price.trim();
      originalPrice = originalPrice.trim();

      res.json({
        title: title?.trim(),
        image,
        price,
        originalPrice,
        coupon,
        store,
        originalLink: safeUrl.toString()
      });
    } catch (error) {
      console.error("Scraping error:", error);
      const message = error instanceof Error ? error.message : 'Falha ao capturar o produto.';
      const status = /link|HTTPS|Mercado Livre/i.test(message) ? 400 : 502;
      res.status(status).json({ error: message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
