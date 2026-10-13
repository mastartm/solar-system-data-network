# solar-system-data-network

Gerçek gezegen konumlarını gösteren etkileşimli bir güneş sistemi haritası. İlerleyen aşamalarda Ay ve Mars yüzeyindeki araçların aktarma uyduları üzerinden Dünya'ya veri gönderdiği bir haberleşme ağı simülasyonu eklenecek.

> **Durum: Aşama 1 (etkileşimli harita, 2B/3B görünüm, tutulmalar).** Ağ modeli ve çizelgeleyici henüz yok.

**Canlı site:** GitHub Pages açıldıktan sonra `https://mastartm.github.io/solar-system-data-network/` (Settings → Pages → Source: *GitHub Actions*).

<!-- Ekran görüntüsü: gerçek Horizons verisiyle alınınca buraya eklenecek (docs/screenshot.png). Açık soru 4'e bakın. -->

## Kurulum

Node.js 20 veya üstü gerekir.

```bash
git clone https://github.com/mastartm/solar-system-data-network
cd solar-system-data-network
npm install
npm run dev      # ilk çalıştırmada Horizons'tan veriyi çeker (internet gerekir)
```

Diğer komutlar: `npm run build` (yayın derlemesi), `npm test` (birim testler), `npm run fetch-data -- --force` (veriyi yeniden çek).

## Nasıl kullanılır

- **Oynat/Durdur** ve **hız** seçimi: zamanı ilerletir.
- **Kaydırıcı / tarih kutusu / Bugün**: 2020–2040 arasında tarih seçin.
- **Gezegene (veya Güneş/Ay'a) tıklayın**: Dünya'ya uzaklığı (km) ve ışık gecikmesi (dakika) sağ panelde görünür.
- Tekerlek ve +/− düğmeleri yakınlaştırır. **2B** modda sürükleme kaydırır.
- **3B** düğmesi eğik görünüme geçer: sürükleyerek döndürün (Shift+sürükleme kaydırır). 3B'de gezegenlerin ekliptik düzlemden sapması 3 kat abartılır (görünsün diye).
- **Tutulmalar:** kaydırıcının üstündeki noktalar tutulmaları gösterir (sarı: güneş, mavi: Ay; dolu: tam/halkalı, boş: kısmi/yarıgölge). Noktaya veya "Tutulmalar" listesine tıklayınca o tarihe gider; ◀ ▶ düğmeleri önceki/sonraki tutulmaya atlar.

## Veri kaynağı ve kararlar

- **Kaynak:** NASA/JPL Horizons API (`ssd.jpl.nasa.gov/api/horizons.api`), anahtar gerektirmez. Güneş merkezli, ekliptik düzlemde konum ve hız vektörleri (gezegenler 2 günde bir, Ay Dünya merkezli günde bir).
- **Karar: veri bir betikle çekilip `public/data/` altına JSON olarak yazılır, site bu dosyalardan okur** (`scripts/fetch-horizons.mjs`). Neden: hız sınırı ve CORS riski yok, site hızlı açılır, sunucu gerekmez. Ayrıca bu aşamayı yazarken Horizons'a erişemeyen bir ortamdaydım, bu yüzden tarayıcıdan doğrudan çağrının (CORS) çalışıp çalışmadığını **test edemedim**.
- `npm run dev` ve `npm run build` veri yoksa betiği otomatik çalıştırır. GitHub Actions da yayından önce çeker. İsterseniz çektiğiniz JSON'ları commit edebilirsiniz; böylece betik tekrar çalışmaz.
- **Ara günler** Hermite interpolasyonu ile hesaplanır (konum + hız kullanılır), bu yüzden dosyalar küçüktür.
- **Harita ölçeği:** çizim yarıçapı gerçek mesafenin karekökü ile orantılıdır (Neptün ile Merkür aynı ekrana sığsın diye). Açılar gerçektir. **Ay'ın çizim mesafesi abartılıdır** (yönü gerçek). Panelde gösterilen km ve ışık dakikası ise gerçek değerlerdir.
- **Yörünge izleri** 2020 başından itibaren bir dönem (veya veri sonuna kadar) çizilir; Satürn ve ötesinde tam daire değil 2020–2040 yayıdır.
- Zaman: Horizons JD (TDB) kullanılır, ekranda UTC gösterilir. Aradaki ~69 saniye fark bu harita için önemsizdir.

- **Tutulmalar** (2020–2040, 91 adet) [astronomy-engine](https://github.com/cosinekitty/astronomy) kütüphanesiyle hesaplanıp `public/data/eclipses.json` dosyasına yazılmıştır (`npm run build-eclipses`, internet gerekmez). Bu NASA kataloğunun kendisi değil, hesaplanmış bir listedir; saat farkı olabilir. Bilinen tarihlerle (örn. 2024-04-08 tam güneş, 2025-03-14 tam Ay) kontrol edilmiştir.

## Klasörler

```
src/data/    veri okuma ve tipler
src/map/     interpolasyon (ephemeris) ve Canvas çizimi
src/ui/      kontroller ve bilgi paneli
scripts/     Horizons veri çekme betiği
public/data/ üretilen JSON dosyaları
.github/workflows/  GitHub Pages yayını
```

## Açık sorular (varsayımla devam edildi)

0. **3B:** Three.js yerine Canvas'ta kendi perspektif projeksiyonumuz kullanıldı (ağır framework yasağı nedeniyle).
1. **Ölçek:** karekök sıkıştırma varsayıldı. Gerçek ölçekli (doğrusal) görünüm istenirse eklenebilir.
2. **Tarih aralığı:** 2020–2040 varsayıldı. Aralık `scripts/fetch-horizons.mjs` içindeki `START`/`STOP` ile değişir.
3. **CORS:** doğrudan tarayıcı çağrısı test edilemedi (yukarıya bakın). Betikle çekmek bu yüzden seçildi.
4. **Ekran görüntüsü:** henüz yok. Gerçek veri çekilince eklenecek, sahte veriyle görüntü koymadım.
5. **Chart.js:** Aşama 1'de grafik olmadığı için eklenmedi, karşılaştırma grafiklerinde eklenecek.

## Kullanılan dış kaynaklar

- [NASA/JPL Horizons System](https://ssd.jpl.nasa.gov/horizons/) — gezegen ve Ay konumları (kamuya açık veri).
- [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT) — tutulma hesabı (yalnızca geliştirme aşamasında).
- Araçlar: [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev).

## Sonraki aşamalar

Aşama 2: Ay/Mars yüzey araçları, aktarma uyduları, ışık gecikmesi ve Mars kavuşumunda iletişim kesintisi, veri akışı animasyonu. Bu aşamadaki araç sayısı, batarya, bant genişliği gibi değerler **varsayımsaldır** ve tek bir config dosyasında tutulacak; sonuçlar gerçek bir görev sonucu değildir.
