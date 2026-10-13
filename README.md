# solar-system-data-network

Gerçek gezegen konumlarını gösteren etkileşimli bir güneş sistemi haritası. İlerleyen aşamalarda Ay ve Mars yüzeyindeki araçların aktarma uyduları üzerinden Dünya'ya veri gönderdiği bir haberleşme ağı simülasyonu eklenecek.

> **Durum: Aşama 4 (Mars kavuşumu stratejisi, duyarlılık analizi, gerçek veriyle doğrulama).** Ağdaki araç/uydu/veri hızı/paket/tampon/strateji değerleri **varsayımsaldır**; çizelgeleyici sonuçları **gerçek bir görev sonucu değildir**. Gerçek olan yalnızca Horizons konumları, bunlardan çıkan ışık gecikmeleri ve bağlantı geometrisidir. Aşama 3 ve 4 artık depodaki **gerçek Horizons verisiyle** (2020–2040) tarayıcıda denendi; sonuçlar ve sentetik veriyle farklar [Aşama 4](#aşama-4-kavuşum-stratejisi-duyarlılık-analizi-gerçek-veri-doğrulaması) bölümünde.

**Canlı site:** GitHub Pages açıldıktan sonra `https://mastartm.github.io/solar-system-data-network/` (Settings → Pages → Source: *GitHub Actions*).

Ekran görüntüleri **gerçek Horizons verisiyle** alınmıştır (`?sentetik=1` kullanılmadı); 2028 Mars kavuşumu:

![Harita, 2028-03-21, Mars kavuşumu kesintisi](docs/harita-kavusum-gercek-veri.png)

Çizelgeleyici sekmesinin görüntüleri [Aşama 4](#aşama-4-kavuşum-stratejisi-duyarlılık-analizi-gerçek-veri-doğrulaması) bölümünde.

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
- Tekerlek ve +/− düğmeleri yakınlaştırır; zoom imlecin altındaki noktaya sabit kalır. **2B** modda sürükleme kaydırır; kaydırma ve uzaklaşma sınırlıdır (harita sahneden çıkmaz) ve yakınlaşınca ağ ayrıntısı (araç/uydu etiketleri, bağlantılar) görünür (PR [#5](https://github.com/mastartm/solar-system-data-network/pull/5)).
- **3B** düğmesi eğik görünüme geçer: sürükleyerek döndürün (Shift+sürükleme kaydırır). 3B'de gezegenlerin ekliptik düzlemden sapması 3 kat abartılır (görünsün diye).
- **Tutulmalar:** kaydırıcının üstündeki noktalar tutulmaları gösterir (sarı: güneş, mavi: Ay; dolu: tam/halkalı, boş: kısmi/yarıgölge). Noktaya veya "Tutulmalar" listesine tıklayınca o tarihe gider; ◀ ▶ düğmeleri önceki/sonraki tutulmaya atlar.

## Aşama 2: veri ağı (varsayımsal)

- **Varsayımsal değerler tek dosyada:** `src/config/hypothetical.ts` (araçlar, aktarma uyduları, yörünge yükseklikleri, veri hızları, kesinti eşiği, animasyon). Ekranda başlıkta ve ağ panelinde, haritada ise "Varsayımsal değerler" yazar. Gerçek bir görev değildir.
- **Varlıklar:** Ay'da 2, Mars'ta 2 yüzey aracı; Ay ve Mars için birer aktarma uydusu (dairesel, ekvatoral yörünge).
- **Işık gecikmesi:** uydu→Dünya mesafesi Horizons konumlarından (cisim merkezli vektör − uydu konumu), araç→uydu mesafesi yüzey-yörünge geometrisinden hesaplanır; tek yönlü gecikme = toplam mesafe / c. Dünya'nın merkezine ölçülür (yer istasyonu yok).
- **Mars kavuşumu:** Dünya'dan bakınca Güneş–Mars açısı eşiğin (varsayılan 3°) altına inince Mars bağlantıları kesilir; paketler aktarma uydusunda bekler. Alttaki "Mars kavuşumu" düğmeleri kesinti penceresinin başına atlar; pencereler veri aralığı taranarak bulunur.
- **Görüş koşulları:** araç, uydu ufkun altındayken bağlanamaz; uydu Dünya'dan cismin arkasında kalırsa ("occulted") bağlantı kesilir.
- **Animasyon:** araç → uydu → Dünya paketleri; hızı üsluptur (ölçekli değil), gecikme panelde sayı olarak verilir. Bağlantı yoksa beyaz noktalar olarak birikir.
- **Basitleştirmeler:** cisim eksenleri ekliptiğe paralel varsayıldı (gerçek kutup yönleri yok); Ay'ın çizim mesafesi abartılı olduğu için Ay çevresindeki yerleşim şematiktir; yer istasyonu, bant genişliği/batarya modeli ve Güneş koronası etkisi yok. Bu aşamada Horizons verisine erişemeyen bir ortamdaydım: ağ modeli birim testlerle (sentetik geometri) doğrulandı, ekranda gerçek veriyle **görsel olarak denenmedi**.

## Aşama 3: çizelgeleyici ve karşılaştırma grafikleri (varsayımsal)

Üstteki **Çizelgeleyici** sekmesini açın (harita gizlenir, geri dönünce kaldığı yerden devam eder). `#cizelgeleyici` adresiyle doğrudan açılır. Sekme ilk açılışta hesaplar (Chart.js o anda yüklenir, harita paketini şişirmez).

- **Model** (`src/network/scheduler.ts`, saf fonksiyon, rastgelelik yok): araç → aktarma uydusu → Dünya. Araçlar veri hızlarının bir kısmını (`dutyCycle`) iki sınıfta üretir: telemetri (öncelik 0, küçük paket) ve bilim verisi (öncelik 1, büyük paket). Her araçta ve her uyduda sınırlı tampon vardır. Bağlantı pencereleri `computeNetwork`'ten gelir: uydunun ufkun altında olması, Dünya görüşü (cisim arkasında kalma), Mars kavuşumu kesintisi. Teslim süresi = kuyruk bekleme + ışık yolu; ışık yolu Horizons mesafelerinden hesaplanır.
- **İki çizelgeleyici:** *FIFO* (geliş sırası; tampon doluysa yeni gelen düşer) ve *öncelikli* (en önemli sınıf önce gider; tampon doluysa daha düşük sınıfın en yeni paketi atılarak yer açılır). Uydu tamponu doluysa araç göndermez, verisini kendi tamponunda tutar (geri basınç).
- **Sayaçlar:** üretilen, teslim, **tamponlanan** (bir adımdan uzun tamponda bekleyen), **gecikmeli** (kuyrukta `delayedAfterSec`'ten uzun bekleyen), **düşen** (tampon taşması), simülasyon sonunda tamponda kalan. Her zaman üretilen = teslim + düşen + kalan (testle doğrulanır).
- **Grafikler:** (a) Ay ve Mars için tek yön ışık gecikmesi, 2020–2040 (iki ayrı grafik; ölçekler çok farklı, çift eksen yok); (b) FIFO ve öncelikli: teslim süresi (%95), tampon doluluğu (tepe), kayıp; sayaç tablosuyla birlikte; (c) seçilen Mars kavuşumu çevresinde Mars aktarma uydusu tamponunun dolup boşalması. (a) gerçek Horizons konumlarına dayanır (Dünya merkezi – cisim merkezi); (b) ve (c) varsayımsal değerlerle çalışır ve panelde öyle yazar.
- **Okuma uyarısı:** teslim süresi yalnızca teslim edilenlerden hesaplanır. Paketi düşüren çizelgeleyicinin ortalaması iyi görünebilir (hayatta kalma yanlılığı); süreyi kayıp ve teslim sayısıyla birlikte okuyun. Ayrıca kavuşum sırasında üretilen telemetri her iki çizelgeleyicide de kesintinin bitmesini beklemek zorundadır; öncelik farkı asıl birikmiş veri boşalırken ve tampon taşarken görülür.
- **Testler:** `src/network/scheduler.test.ts` sentetik veriyle çalışır (uydurma tek araçlı topoloji, uydurma hızlar, sabit konumlu izler); gerçek bir görevi temsil etmez.
- **Gerçek veriyle denenmedi:** bu ortamda Horizons'a erişim yoktu (HTTP 403). Arayüz yalnızca `?sentetik=1` ile açılan **sentetik dairesel yörüngelerle** (`src/data/synthetic.ts`, sayfada kırmızı uyarı çıkar) görsel olarak doğrulandı. Gerçek kavuşum tarihleri, gecikme eğrileri ve sayaç değerleri gerçek veriyle **görülmedi**. Sentetik veriyle çıkan sayılar hiçbir şeyi temsil etmez.
- **Kararlar:** simülasyon adımı 300 sn (kavuşum penceresi çevresi ~16 bin adım, tarayıcıda yaklaşık yarım saniye); paketler "toplu veri parçası"dır (gerçek protokol paketi değil) ki sayılar yönetilebilir kalsın; tüm sayılar `src/config/hypothetical.ts` içindeki `scheduler` bölümündedir.

## Aşama 4: kavuşum stratejisi, duyarlılık analizi, gerçek veri doğrulaması

> Her şey **varsayımsaldır** (`src/config/hypothetical.ts`; ekranda "Varsayımsal değerler" yazar). Sonuçlar **gerçek bir görev sonucu değildir.** Gerçek olan: Horizons konumları, ışık gecikmesi, bağlantı geometrisi.

### Nasıl kullanılır

**Çizelgeleyici** sekmesinde (veya `#cizelgeleyici` adresinde):

- **Kavuşum penceresi** seçin (2020–2040'ta 9 pencere). Ekranın geri kalanı bu pencereyi, 5 gün öncesinden 30 gün sonrasına, **Mars aktarma hattı** (uydu + 2 araç) için üç çizelgeleyiciyle çalıştırır: FIFO, öncelikli, **strateji**.
- **Kaydırıcılar:** Mars uydu tamponu, Mars uydu → Dünya hat hızı, görev döngüsü. Başlangıç değerleri `hypothetical.ts`'ten gelir; aralıkları `HYPOTHETICAL.sensitivity` belirler. **Varsayılana dön** düğmesi hepsini sıfırlar. Kaydırıcıyı bıraktıktan ~0,5 sn sonra yeniden hesaplanır; hızlı art arda hareket eden hesabı iptal eder.
- **(d) Duyarlılık taraması:** her grafikte bir parametre taranır (diğerleri kaydırıcı değerinde); düşey kesikli çizgi kaydırıcının değeridir. Kayıp ve teslim süresi ölçütleri açılır kutuyla değişir.

![Senaryo ve kaydırıcılar](docs/cizelgeleyici-ayarlar.png)
![FIFO, öncelikli, strateji karşılaştırması ve sayaç tablosu (2028 kavuşumu, gerçek veri)](docs/cizelgeleyici-karsilastirma.png)
![Kavuşumda uydu tamponu](docs/cizelgeleyici-tampon.png)
![Duyarlılık taraması](docs/cizelgeleyici-duyarlilik.png)
![Işık gecikmesi, 2020–2040 (gerçek Horizons)](docs/cizelgeleyici-gecikme.png)

### Strateji: "bütçeli kısma"

`simulate(..., 'strategy', cfg)` = öncelikli çizelgeleyici + **bilim verisi üretimini kısma**. Telemetri (en önemli sınıf) hiç kısılmaz. Kesinti takvimi (başlangıç ve bitiş) **önceden bilinir varsayılır** (Güneş–Mars geometrisi öngörülebilirdir; gerçek bir görevin bunu nasıl yaptığını bilmiyorum). Kesintiye `lookaheadDays` kala ve kesinti boyunca, her araç için:

```
bütçe  = margin × (aracın tamponu boşluğu + uydu tamponu boşluğunun hız oranındaki payı) − telemetri × kesintinin kalan süresi
çarpan = clamp(bütçe / (kısılabilir üretim × kalan süre), minFactor, 1)
```

Her adımda yeniden hesaplanır (geri besleme). Parametreler: `HYPOTHETICAL.strategy` (`lookaheadDays: 1`, `margin: 0.9`, `minFactor: 0`). İlk denediğim strateji (yalnızca uydu tamponunun doluluk eşiğine göre kısma + kavuşum öncesi sabit çarpan) bırakıldı: 2028 penceresinde teslim edilen paketi öncelikliye göre ~%13 azalttı (127,7 bin / 146,6 bin), çünkü araç tamponlarını kullanmadan kısıyordu ve kavuşumdan önce (tampon boşken, hat tam kapasiteyle boşaltırken) kısmanın bir faydası yoktu. Bu yüzden tampon boşluğuna dayalı bütçeli kısmaya geçtim.

### Kayıp mı, üretilmeyen mi? (karşılaştırmanın adaleti)

- **Düşen (kayıp):** üretilmiş ama tampon taşması yüzünden atılan veri.
- **Üretilmeyen:** strateji yüzünden hiç üretilmeyen veri. Tampona girmediği için *düşen sayılmaz*; ayrı sütunda gösterilir. FIFO ve öncelikli çizelgeler üretimi kısmaz (üretilmeyen = 0).
- **Talep** = üretilen + üretilmeyen. Karşılaştırma talep üzerinden yapılır; tablo ve grafikler hem **"düşen %"** (= düşen / talep) hem **"düşen + üretilmeyen %"** gösterir, böylece strateji kısarak kayıptan kurtulmuş sayılmaz. **Teslim %** = teslim edilen hacim / talep.
- Denklemler (testle korunur): üretilen = teslim + düşen + kalan (her sınıf için); talep = üretilen + üretilmeyen (stratejinin talebi öncelikli çizelgenin üretimine ±1 paket eşittir). Tabloda "korunum denetimi" satırı bunu her çalıştırmada kontrol eder.

### Gerçek veri doğrulaması (Playwright/Chromium, `?sentetik=1` yok)

Depodaki `public/data/planets.json` ve `moon.json` (2020-01-01 – 2039-12-31/2040-01-01) kullanıldı; **veriye dokunulmadı, Horizons'a erişilmedi.** `vite preview` ile derlenmiş site açıldı.

- **Veri sağlığı:** 9 gövde için sayı/uzunluk kontrolü geçti (yeni `validateTracks`; sorun olursa harita başlamaz, panel "Veri bozuk ya da eksik" yazar). NaN yok. Konsol hatası/uyarısı yok.
- **Mars kavuşum pencereleri** (Güneş–Mars < 3°, 0,25 gün taramayla): 2021-09-29→10-17 (17,5 gün), 2023-11-08→11-28 (19,5), 2025-12-29→2026-01-21 (22,8), 2028-03-08→04-03 (26,5), 2030-05-13→06-06 (23,3), 2032-07-01→07-20 (18,8), 2034-08-10→08-27 (16,8), 2036-09-15→10-02 (17,0), 2038-10-23→11-10 (18,8). En yakın geçişler 2021-10-08, 2023-11-18, **2026-01-09**, 2028-03-21, 2030-05-25, 2032-07-11, 2034-08-19, 2036-09-23, 2038-11-01; bildiğim Mars kavuşum tarihleriyle (2021-10-08, 2023-11-18, 2026-01-09) uyuşuyor; diğerlerini bağımsız bir kaynakla karşılaştırmadım. Pencere süresi 3° eşiğine ve Mars'ın görünür hızına bağlıdır, en kısa/uzun fark büyük (16,8–26,5 gün).
- **Işık gecikmesi:** Ay 1,19–1,36 sn, Mars **3,2–22,2 dk**: beklenen aralıkta. Mars eğrisi her kavuşumda tepe yapıyor (~21–22 dk). 2028-03-21'de panel: araç→uydu ~5 bin km + uydu→Dünya 357,2 milyon km → 19,9 dk. (Ay: 1,34–1,38 sn.)
- **(c) grafiği:** gerçek kavuşumda anlamlı: kesinti başında (gölgeli alan) FIFO/öncelikli tamponu ~5 günde doldurup %100'de bekliyor, kesinti bitince ~9 günde boşalıyor; strateji doğrusal ve yavaş dolduruyor.
- **Sayaçlar mantıklı:** korunum denetimi tüm satırlarda tamam; telemetri teslim süresi (%95) kesinti uzunluğuna yakın (15–26 gün); tamponlanan/gecikmeli sayıları da bunu yansıtıyor. 9 pencerenin hepsinde (varsayılan ayarlar, Mars hattı) FIFO telemetri hacminin %19–32'sini düşürüyor, öncelikli ve strateji telemetriyi hiç düşürmüyor.

**Gerçek ve sentetik veri arasındaki farklar** (aynı kod, `?sentetik=1` / `src/data/synthetic.ts`): Ay gecikmesi sentetikte sabit 1,28 sn (gerçekte 1,19–1,36); Mars 4,4–21,0 dk (gerçekte 3,2–22,2); sentetikte tüm kavuşum pencereleri tam 21,3 gün ve düzenli aralıklıdır (gerçekte 16,8–26,5 gün, ardışık en yakın geçişler arası 25,6–26,4 ay). Yani sentetik veriyle alınan sayılar gerçek verinin yerine geçmez (Aşama 3'ün sentetik denemeleri bu nedenle yalnızca arayüz doğrulamasıydı).

### Sonuçlar (varsayılan ayarlar, Mars hattı, yüzde = talebin %'si; **varsayımsal**, gerçek görev sonucu değil)

Kavuşum penceresi başına, tarama adımı 1800 sn: düşen % / düşen+üretilmeyen % / teslim %.

| Pencere (gün) | FIFO | Öncelikli | Strateji |
|---|---|---|---|
| 2021-09-29 (17,5) | 20,4 / 20,4 / 79,4 | 20,4 / 20,4 / 79,3 | 1,2 / 21,8 / 78,0 |
| 2023-11-08 (19,5) | 23,4 / 23,4 / 76,3 | 23,4 / 23,4 / 76,3 | 1,1 / 24,7 / 75,0 |
| 2025-12-29 (22,8) | 27,7 / 27,7 / 72,2 | 27,7 / 27,7 / 72,1 | 1,3 / 28,9 / 71,0 |
| 2028-03-08 (26,5) | 32,3 / 32,3 / 67,6 | 32,3 / 32,3 / 67,5 | 1,3 / 33,3 / 66,5 |
| 2030-05-13 (23,3) | 27,9 / 27,9 / 72,0 | 27,9 / 27,9 / 71,9 | 1,1 / 29,1 / 70,7 |
| 2032-07-01 (18,8) | 22,2 / 22,2 / 77,6 | 22,2 / 22,2 / 77,6 | 1,2 / 23,5 / 76,3 |
| 2034-08-10 (16,8) | 19,1 / 19,1 / 80,6 | 19,1 / 19,1 / 80,6 | 1,1 / 20,6 / 79,1 |
| 2036-09-15 (17,0) | 19,6 / 19,6 / 80,0 | 19,6 / 19,6 / 80,0 | 1,1 / 21,1 / 78,5 |
| 2038-10-23 (18,8) | 21,7 / 21,7 / 78,0 | 21,8 / 21,8 / 77,9 | 1,0 / 23,2 / 76,5 |

**Okuma (varsayımsal modelde):**

- Toplam hacim açısından üç çizelgeleyici de **neredeyse aynı** hacmi teslim eder (iş korumalıdırlar; hat dolu olduğu sürece hat ne taşıyorsa onu teslim eder). Strateji teslim edilen hacmi **artırmaz**, %1–1,5 puan azaltır (tamponun %10'unu bilerek boş bırakır ve bütçeyi hafif tutucu hesaplar).
- Farklar *neyin* kaybolduğundadır: FIFO telemetriyi de düşürür (2028 penceresinde telemetrinin %32'si), öncelikli ve strateji telemetriyi korur. Strateji, düşen veriyi (%32 → %1,3) hiç üretilmeyene (%32) çevirir: aynı kayıp, ama üretilip taşınıp atılmadan (strateji kesinti boyunca bilim verisini seyreltir; bunun bilimsel olarak daha değerli olup olmadığı bu modelde ölçülmüyor, bilmiyorum).
- Duyarlılık (2028 penceresi): tampon büyüdükçe kayıp doğrusala yakın azalır (8 Gbit ≈ %42 → 160 Gbit ≈ %19); hat hızı ~180 kbit/sn'nin altında kayıp keskin artar, üstünde düzleşir (kayıp tampondan değil kesinti süresinden gelir); görev döngüsü arttıkça kayıp artar ve yüksek döngüde (≳%10) telemetri tek başına tamponu aştığı için strateji de düşürmeye başlar (telemetri kısılmaz).
- Telemetri %95 teslim süresi tampona/hat hızına/üretime neredeyse **bağımsızdır** (~kesinti uzunluğu): kesintide üretilen telemetri kesinti bitmeden Dünya'ya gidemez. Öncelik bunu kısaltmaz, yalnızca telemetriyi düşmekten korur.

### Beklenmedik ve dikkat edilecekler (gerçek veri / yeni aşama bulguları)

1. **"Sonraki/Önceki Mars kavuşumu" düğmeleri aynı pencerede takılıyordu** (Aşama 2 hatası): düğme pencere başının 3 gün öncesine atlıyor, ikinci basışta aynı pencereyi tekrar buluyordu. `src/main.ts`'te düzeltildi (hedef tarihe göre karşılaştırılıyor); 9 pencerenin hepsine sırayla gidilebildiği tarayıcıda doğrulandı.
2. **Ay Aracı A (−85° enlem) ekvator yörüngeli Ay uydusunu hiç göremez** (geometri: uydu hiçbir zaman ufkun üstüne çıkmaz; yüzeyden görüş %0). Verisi hiç teslim edilmez, tamponu dolar ve telemetri/bilim düşer. Bu **varsayımsal yerleşimin** bir sonucu, gerçek veriyle ilgisi yok (sentetikte de aynı); Aşama 3'ün "tüm ağ" toplamı bundan etkileniyordu. Konfigürasyona dokunmadım (varsayımsal değer, bana ait değil); onun yerine **Aşama 4 bölümü yalnızca Mars hattını** simüle eder. Ay Aracı A'nın enlemi/uydu eğimi istenirse `hypothetical.ts`'ten değiştirilebilir.
3. **Mars tarafı toplamları artık Aşama 3'ten farklı:** Aşama 3 tüm ağı (Ay dahil) simüle ediyordu; sayılar (ör. düşen paket) bu yüzden eski çıktılarla karşılaştırılamaz.
4. **Harita paket animasyonundaki "ulaşan" sayacı yüksek hızlarda 0 kalır** (1 gün/sn ve üstü): Mars uydusunun dönemi ~6 saat, animasyon paketi ise gerçek zamanda ~4 sn sürer; bağlantı bu sürede açılıp kapandığı için paket tamamlanmaz. Sayaç yalnızca animasyon üslubudur; gerçek hesap Çizelgeleyici sekmesindedir. Düzeltilmedi (bu aşamanın işi değil).
5. **Ay gecikme grafiği (a) dolu bir bant gibi görünür:** günlük örneklemeyle 27,3 günlük salınım 20 yıl boyunca sıkışıyor; aralık doğru (1,19–1,36 sn), yalnızca görsel.
6. **Strateji kesintinin başı/sonunu önceden bilir** ve bunu modelde bedava sayar (varsayım). Gerçekte tahmin hatası, kısmanın maliyeti (bilim kaybı) ve operasyonel kararlar var.
7. **Hesap süresi:** ilk açılışta senaryo ~0,5 sn, taramalar ~8 sn (tek parça değil; her çizelgeleyici ayrı `setTimeout` parçasında, en uzun görev ~150 ms, ilk çizimde ~280 ms; sayfa donmaz). Kaydırıcı değişince yalnızca diğer iki parametrenin taraması yeniden hesaplanır (~5 sn). Not: zaman çizelgesi 17 bin adımda ~0,1 sn; asıl maliyet paket sayısıdır, adım sayısı değil.
8. **Tarama adımı 1800 sn, ana senaryo 300 sn:** küçük sayısal farklar (<%0,5) normaldir.

### Testler

`npm test` (35 test, **hepsi sentetik**: uydurma tek araçlı topoloji, uydurma hızlar, sabit konumlu izler; gerçek bir göreve ait değil). Yeni: strateji (kesinti işareti yokken öncelikliyle birebir aynı; kesintide üretimi kısar, düşen azalır; telemetri kısılmaz ve düşmez; korunum denklemleri; deterministiklik), tarama yardımcıları (`sweepValues`, `sweepPoint`, tampon büyüdükçe kayıp tekdüzeliği), `withParams`/`restrictToRelay` (girdiyi değiştirmeme).

### Kararlar

- Strateji ve tarama saf fonksiyondur (`scheduler.ts`, `sweep.ts`; DOM ve rastgelelik yok). Arayüz uzun hesabı her çizelgeleyici için ayrı `setTimeout` parçasına böler ve iptal belirteci kullanır.
- Yeni dış bağımlılık, Web Worker veya GitHub Actions iş akışı eklenmedi.
- Kaydırıcılar yalnızca Mars tarafını değiştirir (Ay hattı sabit); yeni varsayımsal değerlerin hepsi `hypothetical.ts` içindedir (`strategy`, `sensitivity`).
- Veri bozuk/eksikse: yükleme sırasında `validateTracks`, panelde `try/catch` + "Hesaplama durdu" mesajı; sayfa çökmez.

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
src/ui/      kontroller, bilgi paneli, ağ paneli
src/network/ ağ modeli (gecikme, bağlantı durumu, kavuşum), çizelgeleyici + strateji, tarama, zaman çizelgesi
src/config/  varsayımsal değerler (tek dosya)
scripts/     Horizons veri çekme betiği
public/data/ Horizons JSON dosyaları (gerçek veri, depoda)
docs/        gerçek veriyle alınmış ekran görüntüleri
.github/workflows/  GitHub Pages yayını
```

## Açık sorular (varsayımla devam edildi)

0. **3B:** Three.js yerine Canvas'ta kendi perspektif projeksiyonumuz kullanıldı (ağır framework yasağı nedeniyle).
1. **Ölçek:** karekök sıkıştırma varsayıldı. Gerçek ölçekli (doğrusal) görünüm istenirse eklenebilir.
2. **Tarih aralığı:** 2020–2040 varsayıldı. Aralık `scripts/fetch-horizons.mjs` içindeki `START`/`STOP` ile değişir.
3. **CORS:** doğrudan tarayıcı çağrısı test edilemedi (yukarıya bakın). Betikle çekmek bu yüzden seçildi.
4. **Ekran görüntüsü:** gerçek Horizons verisiyle alındı, `docs/` altında (Aşama 4'te kapandı). Sentetik görüntü konmadı.
5. **Chart.js:** Aşama 3'te eklendi (tek yeni bağımlılık, sekme açılınca dinamik yüklenir).
6. **Çizelgeleyici varsayımları:** yer istasyonu, yeniden iletim, hata ve kodlama yok; tek bağlantı hızı; uydu tamponu doluyken araç tutar (geri basınç); uydudaki araçlar sırayla (ilk araç önce) kaynağa erişir. Gerçekçi tampon boyutları ve sınıf payları için gerçek bir görev profili gerekir, bilmiyorum.
7. **Kavuşum sırasında telemetri:** öncelik, kesinti sırasında üretilen telemetriyi öne alamaz (hat kapalı). Aşama 4'teki strateji bilim verisini kısar ama telemetriyi hızlandıramaz; telemetri gecikmesi kesinti uzunluğuna eşit kalır. Telemetriyi de kısan ya da daha sık/küçük paketlere bölen bir strateji denenmedi.
8. **Gerçek veriyle doğrulama:** Aşama 4'te yapıldı (yukarıya bakın).
9. **Strateji varsayımları:** kesintinin başı/sonu önceden bilinir (hatasız); bütçe tamponun %90'ı (`margin`), 1 gün önceden başlar. Gerçekçi bir görev bu parametreleri bilmez; sonuçlar kavramsaldır.
10. **Üretilmeyen veri "kayıp" sayılmaz** (ayrı sütun); bunu tanım olarak seçtim ve karşılaştırmada hem "düşen" hem "düşen + üretilmeyen" gösteriyorum. Sizin için "üretilmeyen" farklı bir maliyete denk geliyorsa (ör. bilimsel değeri olan kısma) bu tanımı birlikte gözden geçirelim.
11. **Ay Aracı A görüş sorunu** (yukarıda, madde 2): dokunulmadı, Aşama 4 yalnızca Mars hattını kapsıyor. Ay hattı için aynı analiz istenirse önce yerleşim/eğim düzeltilmeli.
12. **Mars aktarma uydusunun Mars gölgesi (tutulma) ve güç modeli** yok; yalnızca "Dünya cismin arkasında" kesintisi var.

## Kullanılan dış kaynaklar

- [NASA/JPL Horizons System](https://ssd.jpl.nasa.gov/horizons/) — gezegen ve Ay konumları (kamuya açık veri).
- [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT) — tutulma hesabı (yalnızca geliştirme aşamasında).
- [Chart.js](https://www.chartjs.org) (MIT) — karşılaştırma grafikleri.
- Araçlar: [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev).

## Sonraki aşamalar

Aşama 5 adayları: yer istasyonu görüşü ve hata/yeniden iletim (bu aşamanın dışında bırakıldı). Değerler **varsayımsaldır** ve `src/config/hypothetical.ts` içinde kalır; sonuçlar gerçek bir görev sonucu değildir.
