import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { extractProduct, extractShopeeApiProduct, shopeeProductIds } from '../api/scrape.ts';
import { getMarketplace, isAffiliateLink } from '../lib/marketplaces.ts';
import { parseMarketplaceUrl } from '../lib/security.ts';

function readUint16(bytes: Buffer, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function extractStoredEntry(zip: Buffer, wanted: string): string {
  for (let offset = 0; offset < zip.length - 4; offset++) {
    if (zip.readUInt32LE(offset) !== 0x04034b50) continue;
    const method = readUint16(zip, offset + 8);
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = readUint16(zip, offset + 26);
    const extraLength = readUint16(zip, offset + 28);
    const nameStart = offset + 30;
    const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const dataStart = nameStart + nameLength + extraLength;
    if (name === wanted) {
      assert.equal(method, 0, 'o pacote de teste deve usar entrada ZIP sem compressão');
      return zip.subarray(dataStart, dataStart + size).toString('utf8');
    }
    offset = dataStart + size - 1;
  }
  throw new Error(`Entrada ${wanted} não encontrada no ZIP.`);
}

test('normaliza preço da API Shopee sem confundir centavos', () => {
  const product = extractShopeeApiProduct({
    data: {
      item: {
        name: 'Jogo de lençol',
        image: 'imagem-teste',
        price_min: 3_390_000,
        price_min_before_discount: 4_990_000,
        shop: { name: 'Loja teste' },
      },
    },
  });

  assert.ok(product);
  assert.equal(product.currentValue, 33.9);
  assert.equal(product.originalValue, 49.9);
  assert.equal(product.store, 'Loja teste');
});

test('reconhece IDs de URL canônica Shopee', () => {
  assert.deepEqual(
    shopeeProductIds(new URL('https://shopee.com.br/product/123456/987654')),
    { shopId: '123456', itemId: '987654' },
  );
});

test('aceita link afiliado curto da Shopee e rejeita URL insegura', () => {
  assert.equal(parseMarketplaceUrl('https://s.shopee.com.br/2gAFhInhqM').hostname, 's.shopee.com.br');
  assert.equal(isAffiliateLink('https://s.shopee.com.br/2gAFhInhqM', 'shopee'), true);
  assert.throws(() => parseMarketplaceUrl('http://shopee.com.br/produto'), /HTTPS/i);
  assert.throws(() => parseMarketplaceUrl('https://example.com/produto'), /Mercado Livre/i);
});


test('prioriza preço principal e ignora frete na página Shopee', () => {
  const html = `
    <h1>Jogo de lençol 200 fios</h1>
    <div data-testid="pdp-product-price-before-discount">R$ 49,90</div>
    <div data-testid="pdp-product-price">R$ 33,90</div>
    <section>Frete <span>R$ 9,62</span></section>
  `;
  const product = extractProduct(getMarketplace('shopee'), cheerio.load(html), html);
  assert.equal(product.currentValue, 33.9);
  assert.equal(product.originalValue, 49.9);
});

test('não transforma preço de frete em preço de produto', () => {
  const html = `
    <h1>Jogo de lençol 200 fios</h1>
    <section>Frete <span>R$ 9,62</span></section>
    <script>{"shipping":{"price":962000}}</script>
  `;
  const product = extractProduct(getMarketplace('shopee'), cheerio.load(html), html);
  assert.equal(product.currentValue, null);
});

test('regressão: fallback da extensão nunca escolhe o menor preço do escopo', async () => {
  const background = await readFile('chrome-extension/background.js', 'utf8');
  assert.doesNotMatch(background, /Math\.min\(\.\.\.scopedPrices\)/);
  assert.match(background, /frete\|envio\|entrega\|parcela/);
  assert.match(background, /fontSize \* 20/);
});

test('app, fonte e pacote baixável usam a mesma versão da extensão', async () => {
  const [app, manifestText, archiveText] = await Promise.all([
    readFile('src/App.tsx', 'utf8'),
    readFile('chrome-extension/manifest.json', 'utf8'),
    readFile('public/ml-afiliados-sender-v1.0.10.zip.b64', 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);
  const zip = Buffer.from(archiveText.replace(/\s+/g, ''), 'base64');
  const packagedManifest = JSON.parse(extractStoredEntry(zip, 'manifest.json'));

  assert.equal(manifest.version, '1.0.10');
  assert.equal(packagedManifest.version, manifest.version);
  assert.match(app, /REQUIRED_EXTENSION_VERSION = '1\.0\.10'/);
  assert.match(app, /ml-afiliados-sender-v1\.0\.10\.zip\.b64/);
});

test('pacote mantém a proteção persistente contra anúncios duplicados', async () => {
  const archiveText = await readFile('public/ml-afiliados-sender-v1.0.10.zip.b64', 'utf8');
  const background = extractStoredEntry(Buffer.from(archiveText.replace(/\s+/g, ''), 'base64'), 'background.js');
  const whatsapp = extractStoredEntry(Buffer.from(archiveText.replace(/\s+/g, ''), 'base64'), 'whatsapp.js');

  assert.match(background, /ML_SEND_GUARD_RESERVE/);
  assert.match(background, /ML_SEND_GUARD_COMMIT/);
  assert.match(background, /mlSentHistoryV2/);
  assert.match(background, /IN_FLIGHT_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(whatsapp, /ML_SEND_GUARD_RESERVE/);
  assert.match(whatsapp, /return \`v3-/);
  assert.match(whatsapp, /waitForSendConfirmation/);
  assert.match(whatsapp, /logDelivery\('uncertain'/);
});

test('persistência usa IDs determinísticos e regras Firestore estritas', async () => {
  const [app, rules] = await Promise.all([
    readFile('src/App.tsx', 'utf8'),
    readFile('firestore.rules', 'utf8'),
  ]);
  assert.match(app, /function productStorageId/);
  assert.doesNotMatch(app, /addDoc\(/);
  assert.match(rules, /keys\(\)\.hasOnly/);
  assert.match(rules, /data\.marketplace in \[/);
});

test('deploy é determinístico e Firebase usa authDomain oficial estável', async () => {
  const [vercelText, firebase] = await Promise.all([
    readFile('vercel.json', 'utf8'),
    readFile('src/lib/firebase.ts', 'utf8'),
  ]);
  const vercel = JSON.parse(vercelText);
  assert.equal(vercel.buildCommand, 'npm ci && npm run build');
  assert.doesNotMatch(firebase, /isProductionHost/);
  assert.match(firebase, /gen-lang-client-0772285066\.firebaseapp\.com/);
  assert.doesNotMatch(firebase, /VITE_FIREBASE_AUTH_DOMAIN/);
  assert.doesNotMatch(firebase, /filiados-phi\.vercel\.app/);
});

test('extensão permite imagens somente em hosts oficiais dos marketplaces', async () => {
  const [background, manifestText] = await Promise.all([
    readFile('chrome-extension/background.js', 'utf8'),
    readFile('chrome-extension/manifest.json', 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.match(background, /media-amazon\\\.com/);
  assert.match(background, /alicdn\\\.com/);
  assert.ok(manifest.host_permissions.includes('https://*.media-amazon.com/*'));
  assert.ok(manifest.host_permissions.includes('https://*.alicdn.com/*'));
  assert.equal(manifest.minimum_chrome_version, '121');
});

test('CSP de produção não permite unsafe-eval', async () => {
  const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));
  const headers = vercel.headers.find((entry: { source: string }) => entry.source === '/(.*)').headers;
  const csp = headers.find((entry: { key: string }) => entry.key === 'Content-Security-Policy').value;
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(csp, /script-src 'self'/);
});
