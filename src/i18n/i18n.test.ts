import { describe, expect, it } from 'vitest';
import { resolveLang, t, tr } from './index';

// BU TESTLER SENTETİKTİR: uydurma ortam değerleri ve uydurma çeviri anahtarları.
describe('arayüz dili (i18n)', () => {
  it('dil çözümü: URL > hatırlanan tercih > tarayıcı dili > Türkçe', () => {
    expect(resolveLang({ search: '?lang=en', stored: 'tr', nav: 'tr-TR' })).toBe('en');
    expect(resolveLang({ search: '?x=1&lang=tr', stored: 'en', nav: 'en-US' })).toBe('tr');
    expect(resolveLang({ search: '?lang=xx', stored: 'en', nav: 'tr' })).toBe('en'); // geçersiz URL değeri yok sayılır
    expect(resolveLang({ stored: 'tr', nav: 'en-US' })).toBe('tr');
    expect(resolveLang({ stored: 'zz', nav: 'tr-TR' })).toBe('tr');
    expect(resolveLang({ nav: 'tr' })).toBe('tr');
    expect(resolveLang({ nav: 'de-DE' })).toBe('en');
    expect(resolveLang({ nav: 'EN-gb' })).toBe('en');
    expect(resolveLang({})).toBe('tr'); // tarayıcısız ortam (testler, betikler): Türkçe
  });
  it('test ortamında dil Türkçedir: t() metni olduğu gibi döner; yer tutucular doldurulur, bilinmeyenler korunur', () => {
    expect(t('Oynat')).toBe('Oynat');
    expect(t('Hesaplanıyor… {n}/{toplam}', { n: 3, toplam: 9 })).toBe('Hesaplanıyor… 3/9');
    expect(t('{a} ve {b}', { a: 'x' })).toBe('x ve {b}');
  });
  it('İngilizcede çeviri yoksa Türkçe kaynak metne düşer', () => {
    expect(tr('hiçbir yerde çevrilmemiş uydurma metin', 'en')).toBe('hiçbir yerde çevrilmemiş uydurma metin');
    expect(tr('hiçbir yerde çevrilmemiş uydurma metin', 'tr')).toBe('hiçbir yerde çevrilmemiş uydurma metin');
  });
});
