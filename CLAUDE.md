# Proje kuralları (Claude için)

- **README iki dillidir ve her zaman birlikte güncellenir.** `README.md` Türkçe (ana), `README.en.md` İngilizce karşılığıdır. README'de (sayılar, tablolar, bölümler, bağlantılar, "Sonraki aşamalar", "Açık sorular" dahil) yapılan her değişiklik **aynı PR'da iki dosyaya** da yapılır; biri güncellenip diğeri unutulmuş bir PR tamamlanmış sayılmaz.
  - Yapı aynı kalır: aynı bölümler, aynı sıra, aynı tablolar, aynı görüntüler. İngilizce başlıklardan türeyen yerel bağlantılar (`#...`) İngilizce dosyada ayrıca doğru olmalıdır.
  - Komut satırı argümanları, dosya adları, tanımlayıcılar ve URL parçaları (`#cizelgeleyici`, `?sentetik=1`, `scripts/asama*-sonuclar.ts [kapsama|...]`) çevrilmez, olduğu gibi kalır.
  - Ondalık ayracı: Türkçede virgül (3,66), İngilizcede nokta (3.66); binlik ayraç Türkçede nokta/boşluk, İngilizcede virgül.
  - Doğrulama: iki dosyadaki sayısal simgeler (rakam dizileri) aynı olmalı; başlık, tablo satırı ve görüntü sayıları eşleşmeli; tüm `](#...)` bağlantıları ilgili dosyada bir başlığa çözülmeli; `docs/` görüntüleri var olmalı.
  - Bu denetimler `npm run check-readme` ile çalışır (`scripts/check-readme.mjs`); README değişikliklerinden sonra çalıştırın.
- Gerçek/varsayım ayrımı iki dilde de korunur ("Varsayımsal değerler" / "Hypothetical values"). Sonuçlar gerçek bir görev sonucu değildir.
- Site arayüzü şu an yalnız Türkçedir; İngilizce README arayüz etiketlerini okunabilirlik için çevirir (README.en.md başındaki not).
