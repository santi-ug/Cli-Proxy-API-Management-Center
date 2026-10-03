import { describe, expect, test } from 'bun:test';
import en from '../src/i18n/locales/en.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import ru from '../src/i18n/locales/ru.json';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** key → interpolation tokens, with plural variants folded into their base key. */
function flatten(value: unknown, prefix = '', out = new Map<string, string[]>()) {
  if (typeof value === 'string') {
    const key = prefix.replace(PLURAL_SUFFIX, '');
    out.set(key, (value.match(/\{\{\w+\}\}/g) ?? []).sort());
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

const reference = flatten({ pools: en.pools, sidebar: en.sidebar, nav: en.nav });

describe('account pools translations', () => {
  for (const [locale, document] of Object.entries({ zhCN, zhTW, ru })) {
    test(`${locale} has every pools, drawer and nav key with the same placeholders`, () => {
      const messages = flatten({
        pools: document.pools,
        sidebar: document.sidebar,
        nav: document.nav,
      });
      for (const [key, tokens] of reference) {
        expect({ key, tokens: messages.get(key) }).toEqual({ key, tokens });
      }
    });
  }

  test('copy has no em dashes', () => {
    for (const document of [en, zhCN, zhTW, ru]) {
      expect(JSON.stringify(document.pools)).not.toContain('—');
    }
  });
});
