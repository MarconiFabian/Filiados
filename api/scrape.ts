import axios from "axios";
import * as cheerio from "cheerio";
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      },
      timeout: 10000
    });
    const $ = cheerio.load(response.data);
    
    const title = $('.ui-pdp-title').text().trim() || $('meta[property="og:title"]').attr('content') || $('title').text().trim();
    const image = $('.ui-pdp-image').attr('data-zoom') || $('.ui-pdp-image').attr('src') || $('meta[property="og:image"]').attr('content');
    
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
           fraction = fullText.replace(/[^0-9]/g, '');
           cents = "00";
         }
      }
      
      const isPrevious = $el.hasClass('andes-money-amount--previous') || $el.closest('.ui-pdp-price__old').length > 0;
      
      if (fraction) {
        allPrices.push({ fraction, cents: cents || "00", isPrevious });
      }
    });

    const originalObj = allPrices.find(p => p.isPrevious);
    if (originalObj) {
      originalPrice = `${originalObj.fraction},${originalObj.cents}`;
    }

    const currentObj = allPrices.find(p => !p.isPrevious);
    if (currentObj) {
      price = `${currentObj.fraction},${currentObj.cents}`;
    }

    if (!price) {
      const metaPrice = $('meta[property="product:price:amount"]').attr('content') || 
                        $('meta[itemprop="price"]').attr('content');
      if (metaPrice) price = metaPrice.replace('.', ',');
    }

    if (!price && allPrices.length > 0) {
      price = `${allPrices[0].fraction},${allPrices[0].cents}`;
    }

    let coupon = "";
    const couponSelectors = [
      '.ui-pdp-promotions-pill-label',
      '.ui-pdp-promotions__title',
      '.ui-pdp-media__title',
      '.ui-pdp-vpp-label'
    ];
    
    for (const selector of couponSelectors) {
      const text = $(selector).text();
      if (text && (text.toUpperCase().includes('CUPOM') || text.toUpperCase().includes('USE'))) {
        const match = text.match(/[A-Z0-9]{4,}/);
        if (match) {
          coupon = match[0];
          break;
        }
      }
    }

    price = price.trim();
    originalPrice = originalPrice.trim();

    return res.status(200).json({
      title: title?.trim(),
      image,
      price,
      originalPrice,
      coupon,
      originalLink: url
    });
  } catch (error) {
    console.error("Scraping error:", error);
    return res.status(500).json({ error: "Failed to scrape product data" });
  }
}
