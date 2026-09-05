import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const page = 'https://shopee.com.br/product/1081892586/40971673156';
const endpoint = 'https://shopee.com.br/api/v4/pdp/get_pc?item_id=40971673156&shop_id=1081892586';
async function observer(value: unknown, request = endpoint, overrides: any = {}, transport = 'fetch') {
  const messages: any[] = [];
  let calls = 0;
  const payload = { data: {
    product_price: { price: { single_value: value } },
    item: { shop_id: 1081892586, item_id: 40971673156, currency: 'BRL', ...overrides }
  }};
  const response = { ok: true, clone: () => ({ ok: true, json: async () => payload }) };
  class Xhr {
    responseType = 'json';
    response = payload;
    listeners: Function[] = [];
    addEventListener(type: string, fn: Function) { if (type === 'load') this.listeners.push(fn); }
    open() {}
    send() { calls++; for (const fn of this.listeners) fn(); }
  }
  const win: any = { fetch: async () => { calls++; return response; }, postMessage: (m: any) => messages.push(m) };
  runInNewContext(await readFile('chrome-extension/shopee-main.js', 'utf8'), {
    window: win, location: { href: page, origin: new URL(page).origin },
    document: { querySelector: () => null }, URL, Request, XMLHttpRequest: Xhr,
  });
  if (transport === 'xhr') {
    const xhr: any = new Xhr(); xhr.open('GET', request); xhr.send();
  } else {
    assert.equal(await win.fetch(request), response);
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.equal(calls, 1, 'observer must not create a second network request');
  return messages[0]?.payload;
}

test('Shopee: decimal dot, comma, thousands and sub-real fixed-point prices', async () => {
  for (const [input, expected] of [['49.99',49.99],['49,99',49.99],['1.249,90',1249.9],[4999000,49.99],['4999000',49.99],[99000,0.99]]) {
    assert.equal((await observer(input))?.price, expected, String(input));
  }
});
test('Shopee: malformed, negative, ambiguous and non-BRL prices are rejected', async () => {
  for (const value of [null, true, [], -10, 0, '49.99abc', '4.999', 49.99, Infinity]) {
    assert.equal(await observer(value), undefined, String(value));
  }
  assert.equal(await observer(4999000, endpoint, { currency: 'USD' }), undefined);
});
test('Shopee: ignores foreign origins and mismatched request product IDs', async () => {
  assert.equal(await observer(4999000, endpoint.replace('shopee.com.br','example.com')), undefined);
  assert.equal(await observer(4999000, endpoint.replace('40971673156','222')), undefined);
});
test('Shopee: selected variant takes precedence over aggregate starting price', async () => {
  const result = await observer(4999000, endpoint, { selected_modelid: 7, models: [{ modelid: 7, price: 7999000 }] });
  assert.equal(result.price,79.99);
  assert.equal(result.priceMax,79.99);
});
test('Shopee: XHR response is captured without additional request', async () => {
  assert.equal((await observer('49.99',endpoint,{},'xhr')).price,49.99);
});

async function background(initial: any = {}) {
  const storage: any = structuredClone(initial);
  const listeners: Function[] = [];
  const context: any = {
    URL, setTimeout, clearTimeout, console,
    chrome: {
      runtime: { onMessage: { addListener: (fn: Function) => listeners.push(fn) } },
      storage: { local: {
        get: async (keys: string | string[]) => {
          await Promise.resolve();
          return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k=>[k,structuredClone(storage[k])]));
        },
        set: async (value: any) => { await Promise.resolve(); Object.assign(storage,structuredClone(value)); },
        remove: async (keys: string[]) => { for (const k of keys) delete storage[k]; },
      }},
    },
  };
  runInNewContext(await readFile('chrome-extension/background.js','utf8'),context);
  return {
    storage,
    call: (type: string, fields: any = {}, tabId = 1) => context.handleSendGuard({
      type, fingerprint: 'v3-aaaaaaaa-bbbbbbbb-100', queueId: 'q1', index: 0, ...fields,
    }, { tab: { id: tabId, url: 'https://web.whatsapp.com/' }}),
  };
}

test('send guard: concurrent tabs reserve only once', async () => {
  const bg = await background();
  const results = await Promise.all([bg.call('ML_SEND_GUARD_RESERVE'), bg.call('ML_SEND_GUARD_RESERVE',{},2)]);
  assert.equal(results.filter(r=>r.reserved).length,1);
  assert.equal(results.filter(r=>r.duplicate).length,1);
});
test('send guard: wrong tab, product, queue or index cannot clear reservation', async () => {
  const bg = await background();
  await bg.call('ML_SEND_GUARD_RESERVE');
  const reserved = structuredClone(bg.storage.mlInFlightSendV2);
  for (const [fields,tab] of [[{},2],[{fingerprint:'v3-cccccccc-dddddddd-100'},1],[{queueId:'q2'},1],[{index:1},1]] as const) {
    await assert.rejects(bg.call('ML_SEND_GUARD_COMMIT',fields,tab),/reserva correspondente/);
    assert.deepEqual(bg.storage.mlInFlightSendV2,reserved);
  }
  assert.equal((await bg.call('ML_SEND_GUARD_COMMIT')).committed,true);
  assert.equal((await bg.call('ML_SEND_GUARD_RESERVE')).duplicate,true);
});
test('send guard: service-worker restart preserves completed protection', async () => {
  const first = await background();
  await first.call('ML_SEND_GUARD_RESERVE');
  await first.call('ML_SEND_GUARD_COMMIT');
  const restarted = await background(first.storage);
  assert.equal((await restarted.call('ML_SEND_GUARD_RESERVE')).duplicate,true);
});
test('send guard: unreserved confirmation is rejected', async () => {
  const bg = await background();
  await assert.rejects(bg.call('ML_SEND_GUARD_COMMIT'), /reserva correspondente/);
  assert.equal(bg.storage.mlSentHistoryV2,undefined);
});
