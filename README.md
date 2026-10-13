# solar-system-data-network

Gerçek gezegen konumlarını gösteren etkileşimli bir güneş sistemi haritası. İlerleyen aşamalarda Ay ve Mars yüzeyindeki araçların aktarma uyduları üzerinden Dünya'ya veri gönderdiği bir haberleşme ağı simülasyonu eklenecek.

> **Durum: Aşama 8 (kayan ufuklu akış kontrolü, tahmin hatası, hata modeli duyarlılığı; [ayrıntı](#aşama-8-kayan-ufuklu-akış-kontrolü-tahmin-hatası-hata-modeli-duyarlılığı)); önceki: Aşama 7 (kapsama bilen strateji, kümelenmiş hata modeli, Ay hattı senaryosu arayüzde, dar ekran düzeni); önceki: Aşama 6 (3B görünüm ve harita arayüzü: sol "Cisimler" paneli, dönen küre kartı, etiket yerleştirici, katman aç/kapa); ondan önce Aşama 5 (yer istasyonu görüşü, hat hatası ve yeniden iletim, Ay Aracı A düzeltmesi; kendinden önce Aşama 4: Mars kavuşumu stratejisi, duyarlılık analizi, gerçek veriyle doğrulama).** Ağdaki araç/uydu/veri hızı/paket/tampon/strateji değerleri **varsayımsaldır**; çizelgeleyici sonuçları **gerçek bir görev sonucu değildir**. Gerçek olan yalnızca Horizons konumları, bunlardan çıkan ışık gecikmeleri ve bağlantı geometrisidir. Aşama 3 ve 4 artık depodaki **gerçek Horizons verisiyle** (2020–2040) tarayıcıda denendi; sonuçlar ve sentetik veriyle farklar [Aşama 4](#aşama-4-kavuşum-stratejisi-duyarlılık-analizi-gerçek-veri-doğrulaması) bölümünde.

**Canlı site:** GitHub Pages açıldıktan sonra `https://mastartm.github.io/solar-system-data-network/` (Settings → Pages → Source: *GitHub Actions*).

Ekran görüntüleri **gerçek Horizons verisiyle** alınmıştır (`?sentetik=1` kullanılmadı); 2028 Mars kavuşumu:

![Harita, 2028-03-21, Mars kavuşumu kesintisi](docs/harita-kavusum-gercek-veri.png)

Çizelgeleyici sekmesinin görüntüleri [Aşama 4](#aşama-4-kavuşum-stratejisi-duyarlılık-analizi-gerçek-veri-doğrulaması) ve [Aşama 7](#aşama-7-kapsama-bilen-strateji-kümelenmiş-hata-ay-hattı-dar-ekran) bölümlerinde.

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
- **Sol panel (Aşama 6):** "Cisimler" listesi ve "Katmanlar"; ayrıntı için [Aşama 6](#aşama-6-3b-görünüm-ve-harita-arayüzü).
- **Dar ekran (≤ 700 px, Aşama 7):** alt kontroller tek satırdır (oynat, tarih çubuğu, tarih); **⋯** düğmesi hız, Bugün, 2B/3B, zoom, tutulma ve Mars kavuşumu düğmelerini açar. Sağdaki bilgi/ağ paneli **"Bilgi ve ağ durumu ▸"** çubuğuyla katlanır (başlangıçta kapalı); sol "Cisimler" paneli eskisi gibi katlanır. Ayrıntı: [Aşama 7](#4-dar-ekran-düzeni).
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
2. **(Aşama 5'te düzeltildi: enlem −40°.) Ay Aracı A (−85° enlem) ekvator yörüngeli Ay uydusunu hiç göremezdi** (geometri: uydu hiçbir zaman ufkun üstüne çıkmaz; yüzeyden görüş %0). Verisi hiç teslim edilmez, tamponu dolar ve telemetri/bilim düşer. Bu **varsayımsal yerleşimin** bir sonucu, gerçek veriyle ilgisi yok (sentetikte de aynı); Aşama 3'ün "tüm ağ" toplamı bundan etkileniyordu. Konfigürasyona dokunmadım (varsayımsal değer, bana ait değil); onun yerine **Aşama 4 bölümü yalnızca Mars hattını** simüle eder. Ay Aracı A'nın enlemi/uydu eğimi istenirse `hypothetical.ts`'ten değiştirilebilir.
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

## Aşama 5: yer istasyonu, hat hatası ve yeniden iletim, Ay Aracı A

> Her şey **varsayımsaldır** (`src/config/hypothetical.ts`); sonuçlar **gerçek bir görev sonucu değildir.** Gerçek olan: Horizons konumları, ışık gecikmeleri, geometri. Birim testler **sentetiktir**; sayılar aşağıda gerçek veriyle (depodaki Horizons dosyaları, `?sentetik=1` yok) tarayıcıda ve betikle alınmıştır.

### Ay Aracı A düzeltmesi
Aşama 4 bulgusu: −85° enlemdeki araç, ekvator yörüngeli Ay uydusunu hiç göremiyordu (yüzey görüşü %0). `hypothetical.ts`'te enlem **−40°**'ye alındı (yalnızca bu sayı; uydu ve diğer araçlar aynı). Artık görüş %34 (Ay İniş Aracı B %38, Mars araçları %35–36). Testle korunur (sentetik). Not: gerçek bir Ay görevi kutupları eğimli/eliptik yörüngelerle kapsar; burada yörünge ekvatoral olduğu için yerleşim yörüngeye uydurulmuştur, kutup bölgesi **modellenmedi**.

### Yer istasyonu görüşü
- **Model** (`src/network/stations.ts`, saf fonksiyon): küresel Dünya, GMST ile dönüş, ekliptik çerçeveye dönüştürme; yükseklik = istasyondan uyduya (Dünya merkezli konum − istasyon konumu) bakış açısı. Eşik **10°** (`minElevationDeg`). Uydunun Dünya hattı artık: cisim arkasında değil **ve** (Mars) kavuşumda değil **ve** en az bir istasyon uyduyu eşik üstünde görüyor. Yeni bağlantı durumu `nostation`. Devir anlıktır, tek hat varsayılır (aynı anda iki istasyon indirme yapmaz).
- **İstasyonlar (varsayımsal):** 3 adet, konumları derin uzay istasyonlarına *benzer seçildi* (Kaliforniya, İspanya, Avustralya benzeri); gerçek tesis verisi değildir. Sayı arayüzden 0–3 seçilir (0 = ideal, Aşama 2–4 davranışı).
- **Ağ paneli** (harita sekmesi) her araç için uyduyu gören istasyonu ve yüksekliğini gösterir.
- **Gerçek veriyle kapsama** (2028 penceresi ± pay, 30 dk adım; Çizelgeleyici sekmesindeki tablo):

| İstasyon | Ay: uyduyu görüyor | Ay: Dünya hattı açık | Mars: uyduyu görüyor | Mars: Dünya hattı açık |
|---|---|---|---|---|
| Yok (ideal) | — | %88,1 | — | %48,3 |
| 1 | %42,9 | %37,7 | %44,3 | %21,4 |
| 2 | %73,3 | %64,7 | %75,6 | %36,8 |
| 3 | %98,6 | %87,0 | %100,0 | %48,3 |

  Üç istasyon neredeyse tam kapsar; bu yüzden **varsayılan (3) Aşama 4 sonuçlarını değiştirmez**. 1–2 istasyonda hat açık süresi ve teslim keskin düşer.

### Hat hatası ve yeniden iletim (ARQ)
- **Model** (`scheduler.ts`, saf fonksiyon): **rastgelelik yok**; kayıp oranı belirleyici bir biriktiriciyle uygulanır (her hatta, her iletim denemesi için oran birikir; 1'i geçince o deneme kaybolur → belirli aralıklarla periyodik kayıp, "ortalama %p" davranışı). Yüzey hattı kaybı %1, Dünya hattı %5 (`HYPOTHETICAL.arq`).
- **Yüzey hattı** (araç → uydu): RTT adımdan çok kısa varsayılır; kaybolan deneme bant genişliği harcar, paket tamponda kalır ve yeniden denenir.
- **Dünya hattı** (uydu → Dünya): gönderici paketi **RTT (= 2 × ışık gecikmesi)** boyunca tamponunda tutar (Mars'ta ~40 dk, Ay'da ~3 sn). Başarılıysa ACK ile kopyayı bırakır, kaybolduysa NAK sonrası aynı sınıfın başına koyup yeniden gönderir. Kopyalar tampon doluluğuna sayılır (öncelikli çizelge onları atamaz).
- **Denemeler** en çok `maxAttempts` (4); aşan paket **"hatta kayıp"** (`abandoned`) sayılır. `maxAttempts = 1` yeniden iletimsiz moddur.
- **Hat modları** (arayüzde seçilir): *Kayıpsız hat* (Aşama 3–4) · *Hatalı hat, yeniden iletimsiz* · *Hatalı hat + yeniden iletim* (**varsayılan**).
- **Yeni sayaçlar / denklemler (testle korunur):** hatta kayıp, kaybolan deneme, yeniden gönderilen. **Üretilen = teslim + düşen + hatta kayıp + tamponda kalan; talep = üretilen + üretilmeyen.** "Düşen" yalnızca tampon taşmasıdır; "hatta kayıp" ayrı sütundur ve kayıp ölçütlerine (düşen + hatta kayıp [+ üretilmeyen]) birlikte girer. Dünya hat kaybı kaydırıcısı ve tarama grafiği (4. parametre) eklendi; kayıp/ süre ölçütü listesine "hatta kayıp" ve "yeniden gönderilen" eklendi.

![Yer istasyonu kapsaması](docs/asama5-yer-istasyonu.png)
![Ayarlar: istasyon sayısı, hat modu, hat kaybı](docs/asama5-ayarlar.png)
![1 istasyon: karşılaştırma tablosu](docs/asama5-karsilastirma-1-istasyon.png)
![1 istasyon: kavuşumda uydu tamponu hiç boşalmıyor](docs/asama5-tampon-1-istasyon.png)
![Duyarlılık taraması (dört parametre)](docs/asama5-duyarlilik.png)

### Gerçek veriyle sonuçlar (2028-03-08 penceresi, Mars hattı, 300 sn adım, **varsayımsal**)

| Yapılandırma | FIFO teslim % | Öncelikli teslim % | Strateji teslim % | Strateji düşen % |
|---|---|---|---|---|
| 3 istasyon, kayıpsız hat (= Aşama 4) | 67,6 | 67,6 | 66,5 | 1,3 |
| 3 istasyon, hatalı hat, yeniden iletimsiz | 63,7 | 63,7 | 62,8 | 1,2 |
| 3 istasyon, hatalı hat + yeniden iletim (varsayılan) | 67,6 | 67,6 | 66,5 | 1,3 |
| 1 istasyon, hatalı hat + yeniden iletim | 41,0 | 41,1 | 41,1 | 13,4 |

Hatta kayıp (yeniden iletimsiz mod, öncelikli): Mars'ta talebin %4,0'ı, Ay'da %6,0'ı (yüzey %1 + Dünya %5 kayıp denemesi; Mars'ta bir kısmı zaten taşmaya giden veridir). Yeniden iletimle ≈ %0 (tüm kayıplar kurtarıldı; örn. öncelikli: 8,7 bin yeniden gönderilen paket, 0 kalıcı kayıp).

**Ay hattı** (aynı pencere, 300 sn, öncelikli çizelge; Ay'da kavuşum yok, strateji = öncelikli; betikle alındı, arayüzde Ay senaryosu yok):

| İstasyon | Hat modu | Teslim % | Düşen % | Hatta kayıp % | Telemetri ort. süre |
|---|---|---|---|---|---|
| 3 | kayıpsız | 99,8 | 0,0 | 0,0 | 1,9 sa |
| 3 | hatalı, yeniden iletimsiz | 93,8 | 0,0 | 6,0 | 1,9 sa |
| 3 | hatalı + yeniden iletim | 99,8 | 0,0 | 0,0 | 1,9 sa |
| 1 | kayıpsız | 78,1 | 19,4 | 0,0 | 6,4 sa |
| 1 | hatalı + yeniden iletim | 73,8 | 23,6 | 0,0 | 6,4 sa |

**Okuma (varsayımsal modelde):**
- **Yer istasyonu sayısı bu modelde en etkili parametredir:** 1 istasyonla hem Ay hem Mars'ta hat açık süresi indirme ihtiyacının altına düşer; tampon kavuşum sonrası da boşalmaz (Mars teslim %67,6 → %41; Ay %99,8 → %78).
- **Yeniden iletim kaybı neredeyse tamamen kurtarır** (%4–6 hatta kayıp → ≈ %0), süre maliyeti küçüktür çünkü Mars'ta bile RTT (~40 dk) kavuşum kesintisinin (~26 gün) yanında önemsizdir; bu senaryoda süre kesintiye bağlıdır, yeniden iletime değil.
- **Maliyet tampondadır:** gönderici kopyayı RTT boyunca tuttuğu için tampon darken (1 istasyonlu Ay) yeniden iletim **düşeni artırır** (%19,4 → %23,6): kayıp kurtarma, taşma kaybına dönüşür.
- 3 istasyonla Mars'ta ARQ'nun etkisi kayıpsız moda göre ihmal edilebilir (teslim farkı < %0,1).

### Beklenmedik ve dikkat edilecekler
1. **Strateji yer istasyonu kapsamasını bilmez:** bütçeyi yalnızca boş tampondan hesaplar, kavuşum sonrası boşaltma kapasitesini (hat açık oranı) hesaba katmaz. 1 istasyonda (hat %21 açık) kavuşum sonrası yine taşar (strateji düşeni %1,3 → %13,4). Düzeltilmedi; sonraki aşama adayı. **→ Aşama 7'de ele alındı** (kapsama bilen strateji; düşen %13,4 → %2,8, ama toplam kayıp/teslim iyileşmedi).
2. **Belirleyici kayıp periyodiktir:** her 20. deneme kaybolur (%5). Gerçek hatalar rastgele ve kümelidir (kümelenmiş, art arda kayıplar); bu yüzden burada `maxAttempts` aşımı gerçekçi olandan çok daha az görülür ve yeniden iletimin kayıp kurtarma başarısı iyimserdir. **→ Aşama 7'de kümelenmiş model eklendi; tahmin doğrulandı** (aynı ortalama kayıpla hatta kayıp 0–2 → 122–267 paket).
3. **Yüzey hattında RTT yok sayıldı** (5–9 bin km ≈ 20–30 ms ≪ adım 300 sn); uydu → Dünya hattında ise tam RTT var. ACK/NAK kendi hattında kayıpsız ve anlıktır (varsayım).
4. **Kapsama tablosu 30 dk adımlıdır;** kısa (<30 dk) görüş boşlukları kaçabilir.
5. **Dünya küresel,** GMST UT1≈TDB varsayımıyla (~1 dk ≈ 0,3° fark); istasyon görüşü için yeterli, yükseklik eşiğinde 0,3° belirsizlik var. Atmosfer, kırılma, anten kısıtları, hava, bakım ve zamanlama çakışmaları yok; üç istasyon sürekli kullanılabilir varsayılır.
6. **Sweep süresi arttı** (4 parametre; tarama 5 nokta + varsayılan): ilk açılışta ~10 sn (parçalı, sayfa donmaz).
7. Aşama 4'ün sayıları (kayıpsız hat, ideal Dünya) **hâlâ geçerlidir**: arayüzde "Yok (ideal)" + "Kayıpsız hat" seçilerek ya da 3 istasyonla (neredeyse tam kapsama) yeniden üretilir.

## Aşama 6: 3B görünüm ve harita arayüzü

> Ağ değerleri **varsayımsaldır** (`src/config/hypothetical.ts`; ekranda "Varsayımsal değerler"), sonuçlar gerçek bir görev sonucu değildir. Gezegen kartındaki fiziksel bilgiler **genel bilgidir, Horizons verisi değildir, kaynağı doğrulanmamıştır** (hafızadan yazıldı). Dünya'ya uzaklık ve ışık gecikmesi satırları gerçek Horizons verisidir (ekranda "Horizons" etiketi). Ekran görüntüleri depodaki **gerçek veriyle** (`vite preview`, `?sentetik=1` yok) alındı. Çizelgeleyici sekmesine ve simülasyon mantığına dokunulmadı; PR [#5](https://github.com/mastartm/solar-system-data-network/pull/5)'teki kaydırma/zoom davranışı ve 3B'de Güneş'e göre referans değişmedi.

![Sol panel, Satürn kartı](docs/asama6-sol-panel-kart.png)

### 1. Sol panel "Cisimler"
- Güneş, gezegenler ve Ay (Dünya'nın altında girintili). Satırda renk noktası, ad ve **Uydu / Araç / İst.** sayıları (aktarma uydusu, yüzey aracı, Dünya için yer istasyonu); sayılar `hypothetical.ts`'ten türetilir (`countsFor`), panelde "Varsayımsal değerler" yazar.
- Satıra tıklayınca cisim seçilir (haritadaki tıklamayla aynı seçim: harita ve bilgi paneli birlikte güncellenir) ve satır açılır: uydular (ad, yükseklik, Dünya hattı durumu, görünen yer istasyonu ve yüksekliği), araçlar (ad, enlem/boylam, veri hızı, canlı bağlantı durumu), Dünya'da istasyonlar. Seçili satıra tekrar tıklamak açar/kapatır.
- Durum metinleri DOM yeniden kurulmadan güncellenir (yalnızca `textContent`, 250 ms'de bir), bu yüzden tıklamalar bozulmaz. Panel katlanabilir (başlıktaki ▾/▸); dar ekranda (≤ 700 px) başlangıçta katlıdır.

### 2. 3 boyutlu gezegen kartı
- Bilgi panelinde seçili cisim için dönen, ışıklandırılmış küre (küçük canvas, kendi kodumuz, Three.js yok). Altında "Şematik görünüm; gerçek yüzey dokusu değildir".
- **Dokular prosedürel ve belirleyici** (`src/map/planetTextures.ts`): sabit karma işlevli değer gürültüsü + fraktal/Worley gürültü, `Math.random` yok. Dünya (okyanus, kıta, kutup buzu, bulut), Mars, Ay, Merkür (kraterli), Venüs, Jüpiter (bantlar + Büyük Kırmızı Leke), Satürn (halka, Cassini aralığı, küre gölgesi), Uranüs (yan yatık eksen), Neptün, Güneş. Birim testlerle belirlilik doğrulanır.
- **Verimlilik:** kamera, ışık ve eksen sabit olduğundan piksel başına geometri cisim seçilince bir kez hazırlanır (`src/map/sphereRender.ts`); her karede yalnızca boylam kayması ve doku okuması yapılır. Kart en çok ~30 kare/sn, kendi `requestAnimationFrame`'inde; harita sekmesi dışında ve sayfa gizliyken durur; `prefers-reduced-motion` ise durağan kare çizer.
- **Bilgi paneli iskeleti** seçim değişince bir kez kurulur, 250 ms'lik güncelleme yalnızca sayıları değiştirir (kart canvas'ı DOM'da aynı kalır, titremez; tarayıcıda doğrulandı).
- **Kartın yanındaki bilgiler:** yarıçap, yörünge dönemi, Güneş'e ortalama uzaklık, dönme periyodu, bilinen uydu sayısı (dev gezegenlerde "≥"). Ekranda "Genel bilgidir; Horizons verisi değildir, kaynağı doğrulanmamıştır" yazar. Değerler `src/data/bodyFacts.ts` içindedir.
- **Haritadaki küreler:** Güneş'e bakan yüz aydınlık, karşı yüz belirgin gölgede (kesin terminatör; önceki yumuşak degrade yerine).

![Kartlar: Güneş, Merkür, Venüs, Dünya, Ay / Mars, Jüpiter, Satürn, Uranüs, Neptün](docs/asama6-kartlar.png)

### 3. Etiket yerleştirici
`src/map/labels.ts` (saf, DOM/Canvas yok). `MapView` ve `NetworkLayer` etiketleri doğrudan çizmez, `LabelSink`'e **istek** olarak verir; `MapView.render` sonunda `placeLabels` çalışır ve çizer (tek istisna: sol üstteki sabit "Varsayımsal değerler" yazısı, nesneye bağlı değil).
- **Öncelik:** seçili (0) > Güneş/gezegenler (1) > Ay (2) > aktarma uydusu (3) > araç (4) > gecikme (5); eşitlikte istek sırası (belirleyici).
- **Aday arama:** önce en yakın mesafede 8 yön, sonra sonraki mesafe (4 mesafe: 3, 12, 28, 52 px, nesne kenarından). **Tercih edilen yön** cisim merkezinden nesneye doğru (dışa); gezegenlerde merkez Güneş, Ay'da Dünya, uydu/araçlarda ilgili cisim.
- Çakışmayan, sınır içinde, nesne işaretlerine (cisim diskleri, araç/uydu işaretleri) binmeyen ilk aday seçilir. 3. ve 4. mesafede (uzağa giden) **çıkıntı çizgisi** çizilir. Yer yoksa etiket **atlanır**; yalnızca zorunlu (seçili cisim) çakışarak da olsa yerleştirilir.
- Testler (`labels.test.ts`, sentetik): çakışmama, öncelik, sınır, belirlilik, tercih edilen yön, engel, çıkıntı çizgisi, zorunlu etiket.
- Gerçek veride: yakınlaşıp Dünya–Ay ve Mars çevresinde etiketler (Ay, Ay Aktarma Uydusu, Ay Aracı A/B, gecikme, Venüs vb.) **çakışmıyor** (tarayıcıda her karede çakışma sayısı 0 ölçüldü).

![Dünya–Ay, yakınlaşınca etiketler](docs/asama6-etiketler-ay.png)
![Mars çevresi (2028 kavuşum öncesi)](docs/asama6-etiketler-mars.png)

### 4. Katmanlar
Sol panelde 5 anahtar: **Ağ katmanı** (uydular, araçlar, bağlantılar, kavuşum uyarısı), **Veri akışı** (paketler), **Gezegen adları** (Güneş ve Ay dahil; seçili cismin adı her zaman görünür), **Ağ etiketleri** (ad, gecikme), **Yörünge çizgileri** (gezegen izleri, Ay yörüngesi, 3B başvuru halkaları). Kapalıyken ilgili şey çizilmez. Tercihler `localStorage`'da (`ssdn.layers.v1`) saklanır; yoksa/engelliyse/bozuksa varsayılan (hepsi açık) ile çalışır (try/catch, testli). Veri akışı ve ağ etiketleri ağ katmanına bağlı olduğundan, ağ kapalıyken soluk ve devre dışı görünür (tercihleri korunur).

![Ağ katmanı ve yörünge çizgileri kapalı](docs/asama6-katmanlar-kapali.png)
![3B görünüm, Jüpiter seçili](docs/asama6-3b.png)

### Gerçek veriyle doğrulama (Playwright/Chromium, `vite preview`, `?sentetik=1` yok)
Sol panel, kart (10 cisim), etiketler (Dünya–Ay ve Mars bölgesinde yakınlaşarak), her katmanın aç/kapa'sı (ve `localStorage` içeriği), 2B/3B (sürükleme dahil), tarih değişimi (Mars kavuşumu düğmesi), Çizelgeleyici sekmesine gidip dönme, dar ekran denendi. **Konsolda hata/uyarı yok.**
- Ana döngü: 60 kare/sn (kart canlı, 2B/3B, 100 gün/sn oynatmada da); `MapView.render` ortalama ~1,1 ms, p95 ~1,6 ms. Kart karesi (`putImageData`) ~0,05 ms; ilk seçimde doku üretimi 30–100 ms.
- 3B: kamera/projeksiyon koduna dokunulmadı (Güneş'e göre referans aynı).

### Beklenmedik ve dikkat edilecekler
1. **Etiket yüksekliği hatası (bulundu, düzeltildi):** `600 12px` gibi yazı tipi dizisinden boyut ayrıştırırken ağırlık (600) boyut sanılıyordu; seçili cismin etiketi 750 px yüksek ölçülüp "zorunlu" yerleştirilip ekranın dışına itiliyordu. Düzenli ifadeyle düzeltildi.
2. **Doku, gerçek yüzey değildir:** Dünya'daki kıtalar gerçek haritayı değil gürültüyü izler; Jüpiter'in Büyük Kırmızı Leke'si ve Neptün'ün koyu lekesinin konumu sabit, gerçek boylamla ilgisiz. Dönme hızı üsluptur (gerçek dönme periyodunun karekökü ile ölçeklenir; 20–80 sn/tur). Ters dönenler (Venüs 177°, Uranüs 98°) eşdeğer eğikliğe indirgenip dönüş yönü çevrilerek çizilir; kuzey/güney çizimde ters görünebilir.
3. **Uydu sayıları (≥ 95 / 274 / 28 / 16) hafızadan** yazıldı ve zamanla artar; kaynağı doğrulanmadı. Diğer değerler de öyle (ekranda belirtilir). Ay için "Güneş'e uzaklık" Dünya'nınkiyle aynıdır (ekranda belirtilir).
4. **Haritadaki gölge** ekran düzleminde Güneş yönünü kullanır (3B'de derinlik bileşeni yok sayılır); şematiktir.
5. **Dar ekran** düzeni önceki aşamalardaki gibi sıkışık: sol panel katlanır ama alt kontroller yüksek olduğundan harita küçük kalır. İyileştirilmedi. **→ Aşama 7'de düzeltildi** (asıl neden canvas `min-height:auto`; ayrıntı Aşama 7, bölüm 4).
6. **Yörünge çizgileri anahtarı** 3B başvuru halkalarını da kapatır (ayrı anahtar yapılmadı; karar).
7. **Etiket yerleştirici çıkıntı çizgileri** pratikte nadiren görünür (yakın adaylar çoğu zaman yeter); testte zorlanarak doğrulandı.
8. Sol panelde seçim değişince satır görünür alana kaydırılır; bu yüzden "Katmanlar" kutusu yukarı kayabilir.

### Kararlar
- Yeni bağımlılık, Web Worker veya GitHub Actions iş akışı eklenmedi; Three.js yok.
- Yeni varsayımsal değer eklenmedi (sayılar mevcut `hypothetical.ts`'ten türetilir); fiziksel bilgiler `bodyFacts.ts`'te, varsayımsal değildir ama doğrulanmamıştır.
- Unit testler sentetiktir (testte yazılı). `npm test`: 75 test.

## Aşama 7: kapsama bilen strateji, kümelenmiş hata, Ay hattı, dar ekran

> Her şey **varsayımsaldır** (`src/config/hypothetical.ts`; ekranda "Varsayımsal değerler" yazar); sonuçlar **gerçek bir görev sonucu değildir.** Gerçek olan: Horizons konumları, ışık gecikmeleri, geometri. Birim testler **sentetiktir** (testte yazılı). Aşağıdaki sayılar depodaki **gerçek Horizons dosyalarıyla** (`public/data/`, dokunulmadı; Horizons'a erişilmedi; `?sentetik=1` kullanılmadı) tarayıcıda ve `scripts/asama7-sonuclar.ts` betiğiyle (`npx vite-node scripts/asama7-sonuclar.ts [kapsama|tum-pencereler|ufuk|havuz|hata|hat-ayrimi|ay]`) alındı; ikisi aynı sayıları verir. Kaydırma/zoom (PR [#5](https://github.com/mastartm/solar-system-data-network/pull/5)), 3B'de Güneş'e göre referans, Aşama 6 sol paneli, küre kartı, etiket yerleştirici ve katmanlar ile Aşama 3–5'in çizelgeleyicileri (FIFO, öncelikli, strateji) ve sayıları **değişmedi** (Aşama 5 tablosundaki 1 istasyon/strateji sayıları — düşen %13,4, teslim %41,1 — birebir yeniden üretildi).

### Nasıl kullanılır (Çizelgeleyici sekmesi)
- **Hat:** *Mars aktarma hattı (kavuşum penceresi)* ya da yeni **Ay aktarma hattı (tarih aralığı, kavuşum yok)**. Ay'da başlangıç tarihi (veri aralığı içinde) ve süre (7/14/30/60 gün) seçilir; varsayılan 2028-03-03, 60 gün. Kaydırıcılar seçili hattın uydu tamponunu ve Dünya hat hızını değiştirir (Ay için ayrı aralıklar, `HYPOTHETICAL.sensitivity.moon*`).
- **Hat modu:** dördüncü seçenek **Kümelenmiş hata + yeniden iletim** (aynı ortalama kayıp, iki durumlu dağılım).
- Karşılaştırma tabloları ve grafikler artık **dört** çizelgeleyiciyi gösterir (Ay'da ikisini: kavuşum yok, stratejiler kısma yapmaz): FIFO, öncelikli, strateji (Aşama 4, değişmedi) ve **kapsama bilen strateji** (mor).
- Yeni bölümler: **(d) Yer istasyonu sayısına göre karşılaştırma** (1, 2, 3 istasyon; düşen ve düşen+üretilmeyen sütunları + tablo) ve **(e) Hata modeli: periyodik ve kümelenmiş**. Duyarlılık taraması **(f)** oldu (eski (d)).

![Mars: istasyon sayısına göre karşılaştırma](docs/asama7-istasyon-karsilastirma-mars.png)
![Mars, 1 istasyon: kavuşumda uydu tamponu (dört çizelgeleyici)](docs/asama7-tampon-1-istasyon.png)
![Mars, 1 istasyon: sınıf tablosu](docs/asama7-karsilastirma-1-istasyon.png)

### 1. Kapsama bilen strateji (`'coverage'` politikası)

**Varsayım (öncelikle):** bağlantı takvimi **önceden bilinir**: yörünge, Dünya dönüşü, yer istasyonu görüşü, kavuşum öngörülebilir; ayrıca hattın ortalama kaybı bilinir. Gerçek bir görevin bunu ne kadar doğru bildiğini bilmiyorum; tahmin hatası modellenmedi. Eski strateji de kesinti takvimini biliyordu; yeni olan **kapsamanın** (uyduyu gören istasyonlar, hat açık süresi) önceden bilinmesidir.

**Nasıl çalışır** (`scheduler.ts`): kesintiye `lookaheadDays` (1) kala, kesinti boyunca ve bittikten sonra `recoveryDays` (30) boyunca, her araç için tampon "havuzu" (araç tamponu + uydu tamponunun hız oranındaki payı) **ileriye doğru izlenir**: Dünya hattı açıkken hat hızı × payı × (1 − ortalama kayıp) hızıyla boşalır, kapalıyken (kavuşum, istasyon görmüyor, cisim arkası) boşalmaz; tepe doluluk havuzun `margin` (0,9) oranını aşmayacak en büyük bilim verisi üretim çarpanı ikili aramayla bulunur. Telemetri kısılmaz; kısılan veri "üretilmeyen"dir (kayıp değil). Eski strateji (`'strategy'`) olduğu gibi durur; yalnızca boşaltma terimi ve toparlanma ufku yenidir. Çarpan 1800 sn'de bir yenilenir (yalnızca hesap maliyeti için; sonuçlar her adımda yenilemeyle aynı çıktı).

Parametreler `HYPOTHETICAL.coverageStrategy`: `lookaheadDays`, `recoveryDays`, `margin`, `minFactor`, `assetBufferShare` (araç tamponunun havuza katılan oranı; 1 = Aşama 4 ile aynı havuz, böylece karşılaştırma yalnızca boşaltma kapasitesi terimini ölçer).

**Sonuçlar** (2028-03-08 penceresi, Mars hattı, hatalı hat + yeniden iletim [periyodik], 300 sn adım; hücre: düşen % / düşen + üretilmeyen % / teslim %; **varsayımsal**):

| İstasyon | Hat açık % | FIFO | Öncelikli | Strateji (Aşama 4) | Kapsama bilen strateji |
|---|---|---|---|---|---|
| 1 | 21,6 | 47,0 / 47,0 / 41,0 | 47,1 / 47,1 / 41,1 | 13,4 / 47,1 / 41,1 | **2,8** / 48,9 / 41,1 |
| 2 | 36,9 | 32,4 / 32,4 / 67,2 | 32,6 / 32,6 / 67,0 | 1,6 / 33,7 / 65,9 | **0,8** / 34,6 / 65,0 |
| 3 | 48,2 | 32,2 / 32,2 / 67,6 | 32,2 / 32,2 / 67,6 | 1,3 / 33,3 / 66,5 | **0,7** / 34,3 / 65,5 |

Üretilmeyen %: strateji 33,7 / 32,0 / 32,0, kapsama bilen 46,1 / 33,7 / 33,6 (1 / 2 / 3 istasyon).

Aynı karşılaştırma 9 kavuşum penceresinde, **1 istasyon**, düşen % (öncelikli → strateji → kapsama bilen) ve kapsama bilen stratejinin düşen + üretilmeyen %'si (öncelikli/strateji: aynı değer):

| Pencere | Öncelikli düşen | Strateji düşen | Kapsama bilen düşen | Kapsama bilen düşen+üretilmeyen (diğerleri) | Teslim % |
|---|---|---|---|---|---|
| 2021-09-29 | 44,7 | 22,3 | 2,5 | 46,8 (44,7) | 41,8 |
| 2023-11-08 | 52,8 | 26,8 | 2,9 | 54,8 (52,8) | 34,2 |
| 2025-12-29 | 54,3 | 24,5 | 3,2 | 56,1 (54,3) | 33,7 |
| 2028-03-08 | 47,1 | 13,4 | 2,8 | 48,9 (47,1) | 41,1 |
| 2030-05-13 | 38,3 | 9,6 | 2,2 | 39,6 (38,3) | 50,3 |
| 2032-07-01 | 33,4 | 10,4 | 2,0 | 35,2 (33,4) | 53,3 |
| 2034-08-10 | 35,7 | 15,0 | 2,3 | 37,7 (35,7) | 50,3 |
| 2036-09-15 | 40,9 | 19,9 | 2,3 | 42,9 (40,9) | 45,3 |
| 2038-10-23 | 49,9 | 25,8 | 2,8 | 52,0 (49,9) | 36,7 |

**Duyarlılık** (2028, düşen % / düşen + üretilmeyen % / teslim %):

| Parametre | 1 istasyon | 3 istasyon |
|---|---|---|
| Toparlanma ufku 0 / 3 / 7 / 14 / 21 / **30** gün | 11,9 / 47,1 · 10,6 / 47,4 · 9,1 / 47,6 · 6,5 / 47,6 · 4,6 / 47,9 · **2,8 / 48,9** (teslim hepsinde 41,1) | 0,7 / 34,2–34,3 hepsinde (teslim 65,5) |
| Araç tamponu payı 0 / 0,5 / **1** | 0,0 / 50,3 · 0,3 / 49,6 · **2,8 / 48,9** (teslim 41,1) | 0,0 / 36,5 / 63,3 · 0,2 / 35,5 / 64,3 · **0,7 / 34,3 / 65,5** |

**Okuma (varsayımsal modelde):**
- Kapsamayı bilmek **düşeni 3–5 kat azaltır** (1 istasyonda 13,4 → 2,8; 2–3 istasyonda ≈ yarıya) ve düşenin neredeyse tamamını "üretilmeyen"e çevirir. **Ama toplam kaybı ve teslim edilen hacmi iyileştirmez:** 1 istasyonda teslim aynıdır (41,1; hat kapasitesi sınırlayıcı), 2–3 istasyonda toplam kayıp ≈ 1 puan *artar* (34,3 vs 33,3) ve teslim ≈ 1 puan *azalır* (65,5 vs 66,5), çünkü taşmayı daha sıkı önleyip daha çok kısar. Aşama 4'ün sonucu burada da geçerlidir: strateji hangi verinin ve hangi aşamada kaybolduğunu değiştirir, hacmi artırmaz.
- Neden **1 istasyonda** eski strateji yetmedi: kavuşumdan sonra hat zamanın %21,6'sında açık; ortalama boşaltma (~52 kbit/sn) üretimin (125 kbit/sn) altındadır, yani kavuşumdan sonra da tampon dolu kalır. Kapsama bilen strateji bunu gördüğü için kavuşumdan *sonra* da kısmaya devam eder (toparlanma ufku büyüdükçe düşen azalır: 11,9 → 2,8); ufuk 30 günden (senaryonun sonu) uzun tutulmadı.
- **Kalan düşen** (%0,7–2,8) uydu tamponu doyunca telemetri paketinin daha düşük sınıfı **atarak** girmesinden gelir (öncelikli kural; Aşama 4'te de böyleydi). `assetBufferShare = 0` (yalnızca uydu tamponu bütçelenir) düşeni 0'a indirir ama ≈ 2 puan daha çok kısar; varsayılan 1 seçildi çünkü Aşama 4 ile aynı havuzla adil karşılaştırma verir. Hangisinin tercih edileceği bir maliyet kararıdır (bilmiyorum).

### 2. Kümelenmiş hata modeli (Gilbert–Elliott benzeri, belirleyici)
- **Model:** her hat (her araç→uydu yüzey hattı, her uydu→Dünya hattı) için adım adım iki durumlu (iyi/kötü) bir zincir üretilir (`genLinkStates`). **Rastgelelik yok:** durum geçişleri ve kayıp çekilişleri kendi yazdığım, sabit tohumlu `mulberry32` üretecinden gelir (`HYPOTHETICAL.arq.burst.seed`); aynı girdi aynı sonucu verir (testli). Kötü durumun uzun dönem oranı, hattın **ortalama kaybı** (yüzey %1, Dünya kaydırıcısı %5) iyi/kötü durum kayıplarının karışımı olacak şekilde seçilir; yani **ortalama kayıp periyodik modelle aynıdır, yalnızca dağılımı farklıdır**. Zincir **zamana** bağlıdır (denemeye değil): kaybolan bir paketin yeniden denemesi RTT kısaysa büyük olasılıkla aynı kötü durumda kalır — periyodik modelde bu hiç olmuyordu.
- **Parametreler** (`HYPOTHETICAL.arq.burst`, uydurma): iyi durum kaybı %0,5, kötü durum kaybı %80, kötü durumun ortalama süresi 30 dk, tohum 20281031. Başlangıç durumu iyi.
- **Hat modu** olarak seçilir ("Kümelenmiş hata + yeniden iletim"); `maxAttempts` 4 aynı. (e) bölümü seçili senaryo ve istasyon sayısı için *yeniden iletimsiz*, *periyodik* ve *kümelenmiş* modları yan yana verir (öncelikli çizelge).

**Sonuçlar** (3 ve 1 istasyon, öncelikli, 300 sn adım; **varsayımsal**). "Hatta kayıp paket" = `maxAttempts` (4) denemede iletilemeyen:

| Senaryo | İst. | Mod | İletim denemesi | Kaybolan deneme % (iki hat) | En uzun art arda kayıp | Yeniden gönderilen | **Hatta kayıp paket** | Teslim % |
|---|---|---|---|---|---|---|---|---|
| Mars 2028 | 3 | periyodik | 288.296 | 3,03 | 1 | 8.732 | **0** | 67,6 |
| Mars 2028 | 3 | kümelenmiş | 289.372 | 3,56 | 30 | 10.042 | **267** (%0,06) | 67,5 |
| Mars 2028 | 1 | periyodik | 275.591 | 2,99 | 1 | 8.245 | **2** | 41,1 |
| Mars 2028 | 1 | kümelenmiş | 274.130 | 2,67 | 30 | 7.060 | **266** (%0,06) | 41,0 |
| Ay 2028-03-03, 60 g | 3 | periyodik | 45.749 | 3,04 | 1 | 1.390 | **0** | 99,9 |
| Ay 2028-03-03, 60 g | 3 | kümelenmiş | 46.380 | 4,73 | 28 | 2.046 | **146** (%0,28) | 99,6 |
| Ay 2028-03-03, 60 g | 1 | periyodik | 43.859 | 3,02 | 1 | 1.324 | **0** | 73,2 |
| Ay 2028-03-03, 60 g | 1 | kümelenmiş | 44.133 | 3,88 | 28 | 1.592 | **122** (%0,35) | 73,3 |

**Okuma:**
- **Aynı ortalama kayıpla `maxAttempts` aşımı 0–2 pakette → 122–267 pakete çıktı:** periyodik modelde her 20. deneme kaybolduğu için aynı paket art arda 4 kez hiç kaybolmaz (en uzun art arda kayıp 1); kümelenmiş modelde 28–30 deneme art arda kaybolur. Yani Aşama 5'teki "yeniden iletim kaybı neredeyse tamamen kurtarır" sonucu **iyimserdi** (Aşama 5, "Beklenmedik" 2'deki tahmin doğrulandı), ama büyüklüğü küçük kalır (%0,06–0,35).
- **Kaybın hangi hattan geldiği RTT'ye bağlı** (betik `hat-ayrimi`, 3 istasyon): Mars'ta 267 paketin **250'si yüzey hattından** (RTT ≈ 0, yeniden deneme aynı adımda, aynı kötü durumda) ve yalnızca **17'si Dünya hattından** (RTT ~40 dk ≳ kötü durumun ortalama süresi 30 dk, yeniden deneme çoğu zaman kötü durumdan sonra); 1 istasyonda 260 / 6. Ay'da 146 paketin **121'i Dünya hattından** (RTT ~3 sn ≪ 30 dk: yeniden deneme aynı kötü durumda), 25'i yüzeyden; 1 istasyonda 31 / 91. Arayüzde (e) tablosundaki "…yüzey / Dünya hattı" sütunu bunu gösterir.
- Kaybolan deneme oranı nominalden sapar (2,7–4,7 %, periyodik %3,0; oranlar iki hattın tüm denemelerinin payıdır, Dünya hattı %5 nominal): kötü durumda kaybolan paketler yeniden denendiği için denemeler kötü durumda aşırı temsil edilir, ve 60 günde yalnızca ~100–170 kötü durum dönemi örneklenir (deterministik sapma).
- Teslim edilen hacim neredeyse değişmez (Mars 67,6 → 67,5; Ay 99,9 → 99,6): hata modeli bu varsayımlarda hacmi değil, *hangi paketlerin kalıcı kaybolduğunu* etkiler.

![Mars: hata modeli karşılaştırması](docs/asama7-hata-modeli-mars.png)
![Ay: hata modeli karşılaştırması](docs/asama7-ay-hata-modeli.png)

### 3. Ay hattı senaryosu (arayüz)
- Çizelgeleyici sekmesinde **Hat → Ay aktarma hattı**. Ay'da kavuşum yok; senaryo, seçilen **tarih aralığı** (başlangıç + 7/14/30/60 gün) boyunca Ay aktarma uydusu + 2 araçtır. Yer istasyonu kapsama tablosu, istasyon karşılaştırması, hata modeli ve duyarlılık taraması Ay için de çalışır; tampon grafiğinde gölgeli alanlar Dünya hattının kapalı olduğu zamanlardır (istasyon görmüyor ya da Ay'ın arkasında). Stratejiler Ay'da kısma yapmaz (öncelikliyle birebir aynı, testli) ve gösterilmez.
- **Gerçek veriyle** (2028-03-03, 60 gün, hatalı hat + yeniden iletim, 300 sn; **varsayımsal**). Aşama 5'in README tablosuyla uyumludur (pencere 61 → 60 gün olduğundan küçük fark):

| İstasyon | Uyduyu görüyor % | Dünya hattı açık % | FIFO düşen / teslim % | Öncelikli düşen / teslim % | Telemetri %95 süre (FIFO / öncelikli) |
|---|---|---|---|---|---|
| 1 | 42,6 | 37,4 | 24,2 / 72,8 | 23,9 / 73,2 | 4,9 gün / 0,7 gün |
| 2 | 73,2 | 64,6 | 0,0 / 99,9 | 0,0 / 99,9 | 0,5 / 0,4 gün |
| 3 | 98,5 | 87,0 | 0,0 / 99,9 | 0,0 / 99,9 | 0,2 / 0,2 gün |

- **Okuma:** Ay hattında belirleyici olan **yer istasyonu kapsamasıdır**: 1 istasyonda hat %37 açık, tampon (2 Gbit) her boşlukta dolup taşar (düşen ≈ %24), 2 istasyonda kayıp ortadan kalkar. Öncelikli çizelge burada FIFO'ya göre yalnızca telemetri süresini düşürür (4,9 → 0,7 gün) ve düşenden telemetriyi korur. ARQ etkisi küçüktür ama (e) bölümünde görülür: kümelenmiş hatada hatta kayıp %0,28–0,35.
- **Tarih aralığına duyarlıdır:** aynı hat 2030-06-01, 30 gün, 1 istasyon: teslim %74,6, düşen %20,3 (2028'de 73,2 / 23,9). Tek bir aralıktan genelleme yapmayın.

![Ay: ayarlar](docs/asama7-ay-ayarlar.png)
![Ay: istasyon sayısına göre karşılaştırma](docs/asama7-ay-istasyon-karsilastirma.png)
![Ay: Dünya hattı kapalıyken tampon](docs/asama7-ay-tampon.png)
![Ay: yer istasyonu kapsaması](docs/asama7-ay-yer-istasyonu.png)

### 4. Dar ekran düzeni
- **Asıl neden Aşama 6'da yazdığımdan farklıydı** ("alt kontroller yüksek"): ≤ 700 px'te `#map` canvas'ının `height` niteliği (kendi ölçüsüne eşitlenir) flex `min-height:auto` yüzünden **haritanın küçülmesini engelliyordu**. 420×860'da `main` 324 px iken canvas 667 px kalıyor, alt çubuğun arkasına taşıyor (Güneş ve iç gezegenler görünmüyordu) ve bilgi/ağ paneli (`#side`) ekranın dışına itiliyordu: **bilgi paneli ve küre kartı dar ekranda hiç erişilemiyordu.** `#map { min-height:0 }` ile çözüldü.
- **Düzen (≤ 700 px):** alt kontroller **tek satır** (▶ Oynat · tarih çubuğu · tarih · **⋯**); **⋯** hız, Bugün, 2B/3B, zoom, tutulma ve Mars kavuşumu düğmelerini açar/kapar (başlangıçta kapalı). Başlık küçüldü (Konumlar notu dar ekranda gizli; "Varsayımsal değerler" rozeti duruyor). Bilgi/ağ paneli **"Bilgi ve ağ durumu ▸"** çubuğuyla katlanır (başlangıçta kapalı). Sol "Cisimler" paneli eskisi gibi başlangıçta katlı ve ▸/▾ ile açılır. Tarih etiketi bilgi paneli açıkken gizlenir (örter). 701 px ve üstünde masaüstü düzeni **değişmedi**.
- **Ölçü (420×860, gerçek veri):** harita yüksekliği görünür ≈ 280 px → **681 px**; alt çubuk 415 → **43 px**; başlık 121 → 60 px. ⋯ açıkken harita 509 px, bilgi açıkken 350 px. 360×740'ta harita 539 px; 700/701 sınırı denendi.
- Dar ekranda Çizelgeleyici sekmesinin başlığı sığıyor; sayfa yatay taşmıyor (`scrollWidth` = 420), geniş tablolar kendi içinde kayıyor.

![420 px, kapalı kontroller](docs/asama7-dar-ekran-kapali.png)
![420 px, ⋯ ile açılan kontroller](docs/asama7-dar-ekran-kontroller.png)
![420 px, bilgi ve ağ paneli açık](docs/asama7-dar-ekran-bilgi.png)
![420 px, sol Cisimler paneli açık](docs/asama7-dar-ekran-sol-panel.png)
![420 px, Çizelgeleyici](docs/asama7-dar-ekran-cizelgeleyici.png)

### Gerçek veriyle doğrulama (Playwright/Chromium, `vite preview`, `?sentetik=1` yok)
Denendi: kapsama bilen strateji (1/2/3 istasyon, 2028 penceresi), kümelenmiş hata modu (Mars ve Ay), Ay hattı senaryosu (başlangıç tarihi/süre değişimi dahil), dar ekran (420, 360, 700/701), harita sekmesinde Aşama 6 özellikleri (10 cisim satırı, kart, 5 katman anahtarı ve `localStorage`, zoom, 2B/3B sürükleme, Mars kavuşumu düğmeleri ardışık pencerelere gidiyor, Çizelgeleyici sekmesine gidip dönme, 60 kare/sn). **Konsolda hata/uyarı yok** (tüm akışlarda).
- **Hesap süresi** (tarayıcıda, parçalı: her çizelgeleyici/istasyon/mod/tarama noktası ayrı `setTimeout` parçası, sayfa o sırada girdiye yanıt verir; `PerformanceObserver` `longtask` ile ölçüldü):
  - **Mars, ilk açılış** (3 istasyon, hatalı hat + yeniden iletim): toplam ≈ **14–15 sn** (senaryo 0,5–0,8 sn [4 çizelgeleyici], kapsama tablosu 0,06 sn, **istasyon karşılaştırması 1,7–2,2 sn**, **hata modeli 0,4–0,5 sn**, duyarlılık taraması 10,8–11,8 sn). Aşama 5'te ilk açılış ≈ 10 sn idi; artışın nedeni dördüncü çizelgeleyici (taramada 5 → 6 sonuç/nokta) ve iki yeni bölüm. Önbellek: istasyon sayısı seçimi değişince istasyon karşılaştırması yeniden hesaplanmaz (9 ms; zaten 1/2/3'ü kapsar), hat modu değişince hata modeli tablosu yeniden hesaplanmaz (1 ms; üç modu zaten içerir); kaydırıcı değişince ikisi de yeniden hesaplanır.
  - **En uzun tek görev: 229–396 ms** (çoğunlukla 300 sn adımlı tek bir çizelgeleyici çalıştırması ya da ilk çizim; ilk açılışta 396 ms, Chart.js'in ilk yüklenmesi dahil); Aşama 4–5'te ≈ 150–280 ms'ydi. Sayfa donmuyor ama kısa takılmalar (~0,3–0,4 sn) olabilir. Kapsama bilen stratejinin ileri projeksiyonu 1800 sn'de bir yenilenir; yenilenmeseydi tek çalıştırma ≈ 0,7 sn olurdu.
  - **Ay hattı:** toplam 1,3–2,6 sn, en uzun görev 51–114 ms.
- Harita ekran görüntüleri (masaüstü, 3B): ![](docs/asama7-harita-masaustu.png) ![](docs/asama7-harita-3b.png)

### Testler
`npm test`: **89 test** (önce 75). Yeni (hepsi **sentetik**: uydurma tek araçlı topoloji, uydurma hızlar ve kayıplar, testte yazılı): kapsama bilen strateji (kesinti işareti yokken öncelikliyle birebir aynı; zayıf kapsamada eski strateji taşarken yenisi çok daha az düşürür ve daha çok kısar; tam kapsamada aşırı kısmaz; telemetri kısılmaz/düşmez; **korunum ve talep denklemleri**; toparlanma ufku tekdüzeliği; belirleyicilik, girdiyi değiştirmeme; ARQ varken korunum; `runPolicies` kısayolunun gerçek hesapla aynılığı), üreteç ve durum zinciri (belirleyicilik, kötü oran ve ortalama süre hedefe yakın), kümelenme (periyodik modelde en uzun art arda kayıp ≤ 1, kümelenmişte çok daha uzun; `maxAttempts` aşımı; uzun RTT'nin yeniden denemeyi kurtarması; kaybın yüzey/Dünya ayrımı; tohum değişince dizi değişir), ARQ + küçük tampon + kapsama stratejisi + kümelenmiş hata birlikte korunum. Mevcut testlere dokunulmadı; yalnızca `SweepParams` alan adları değişti (aşağıda).

### Beklenmedik ve dikkat edilecekler
1. **Dar ekran sorunu başka bir yerdeydi** (yukarıda): Aşama 6'daki teşhisim ("alt kontroller yüksek") eksikti; canvas'ın `min-height:auto` davranışı haritayı alt çubuğun arkasına itiyor ve bilgi panelini erişilemez yapıyordu.
2. **Kapsama bilen strateji toplam kaybı iyileştirmedi:** düşeni azaltır, üretilmeyeni artırır; 2–3 istasyonda toplam kayıp ≈ +1 puan, teslim ≈ −1 puan (yukarıda). "Düşen" tek başına bakılırsa strateji çok başarılı görünür; **"düşen + üretilmeyen"** ve teslim sütunlarıyla birlikte okuyun.
3. **Kalan düşenin kaynağı** uydu tamponu doygunluğunda telemetrinin düşük sınıfı atmasıdır (öncelikli kural); `assetBufferShare = 0` bunu 0'a indirir ama daha çok kısar.
4. **Kümelenmiş modelde gerçekleşen kayıp oranı nominalden sapar** (yukarıda): "ortalama kayıp aynı" parametre düzeyinde doğrudur, gerçekleşen oran değil. Ayrıca zincir adım zamanıyla (300 sn; taramada 1800 sn) ayrıklaştırılır; meanBadSec ≥ adım olduğu sürece ortalama doğrudur, sayılar iki adım arasında küçük sapabilir.
5. **`maxAttempts` aşımı yüzey hattında baskındır** (Mars): yüzey hattında yeniden deneme aynı adımda yapıldığından (RTT ≈ 0 varsayımı, Aşama 5) kötü durumda kalır. Gerçek bir yüzey hattında yeniden deneme aralığı ve kısa süreli bozulmalar farklı olabilir; bilmiyorum.
6. **Hesap süresi arttı:** ilk açılış ≈ 10 → 14–15 sn, en uzun tek görev ≈ 280 → 396 ms (dört çizelgeleyici + istasyon karşılaştırması + hata modeli); parçalı olduğu için sayfa donmuyor. Ay hattı çok daha hafif (≈ 2 sn). Web Worker eklenmedi (kural gereği sorulmadan eklenmez); gerekirse bir sonraki adımda önerilir.
7. **Ay senaryosunda strateji yok:** `strategy` ve `coverage` yalnızca kavuşum kesintisini (`earthBlackout`) kullanır; Ay'da istasyon boşlukları (öngörülebilir kapalı hat) için akış kontrolü yapmaz. Bu bir sınırlama; sonraki aşama adayı.
8. **`SweepParams` alanları yeniden adlandırıldı** (`marsRelayBufferMb` → `relayBufferMb`, `marsRelayDownlinkKbps` → `relayDownlinkKbps`; `defaultParams`/`withParams`/`runPolicy`/`sweepPoint` hangi uydu için kullanılacağını isteğe bağlı `relayId` ile alır, varsayılan Mars): davranış aynı, Mars sayıları aynı; yalnızca testlerde anahtar adları güncellendi.
9. **Bölüm harfleri değişti:** duyarlılık taraması (d) → (f); eski bölümlerdeki "(d)" anılar Aşama 4–5 metinlerinde tarihsel olarak kaldı.
10. **Kapsama bilen strateji ortalama kaybı bilir** (periyodik ya da kümelenmiş; aynı ortalama) ve ARQ kopyalarının RTT boyunca tamponda yer tutmasını yok sayar (iyimser).
11. **Sentetik veriyle ekran görüntüsü konmadı;** birim testler sentetiktir ve testte yazılıdır.

### Kararlar
- Yeni dış bağımlılık, Web Worker veya GitHub Actions iş akışı eklenmedi; Chart.js dışında bağımlılık yok. `scripts/asama7-sonuclar.ts` yalnızca `public/data/` dosyalarını okur (Horizons'a erişmez), `vite-node` (vitest ile birlikte gelir) ile çalışır.
- Yeni varsayımsal değerlerin hepsi `hypothetical.ts` içindedir: `coverageStrategy`, `arq.burst`, `moonScenario`, `sensitivity.moon*`. Strateji (Aşama 4) olduğu gibi korundu; yeni politika ayrı bir ad (`'coverage'`).
- Kapsama bilen strateji için araç tamponu havuza dahil (Aşama 4 ile karşılaştırılabilirlik); toparlanma ufku 30 gün (senaryo sonu); pay 0,9 (Aşama 4 ile aynı).
- Kümelenmiş hata zamana bağlı, ortalama kayıp periyodik modelle eşit, tohum sabit.
- Dar ekranda bilgi paneli başlangıçta kapalı; harita seçimiyle otomatik açılmaz (haritanın aniden küçülmemesi için).

## Aşama 8: kayan ufuklu akış kontrolü, tahmin hatası, hata modeli duyarlılığı

> Her şey **varsayımsaldır** (`src/config/hypothetical.ts`; ekranda "Varsayımsal değerler" yazar); sonuçlar **gerçek bir görev sonucu değildir.** Gerçek olan: Horizons konumları, ışık gecikmeleri, geometri. Birim testler **sentetiktir** (testte yazılı). Sayılar depodaki **gerçek Horizons dosyalarıyla** (`public/data/`, dokunulmadı; Horizons'a erişilmedi; `?sentetik=1` yok) `npx vite-node scripts/asama8-sonuclar.ts [ay|mars|ufuk|tum-pencereler|tahmin|capraz|hata]` betiğiyle ve tarayıcıda (Playwright/Chromium, `vite preview`) alındı. **Aşama 3–7'nin çizelgeleyicileri ve sayıları değişmedi** (Aşama 7 tablosundaki Mars 1/2/3 istasyon sayıları betikle birebir yeniden üretildi: 13,4 / 47,1 / 41,1 · 2,8 / 48,9 / 41,1 vb.); PR #5 kaydırma/zoom, 3B referansı, Aşama 6 sol paneli/kart/etiket/katmanlar, Aşama 7 dar ekran düzeni korundu (tarayıcıda denendi, aşağıda).

### Ne eklendi
- **`'rolling'` politikası** (Kayan ufuklu strateji): `'coverage'` ile aynı havuz projeksiyonu, ama **kavuşum işaretine bağlı değil**. Her 1800 sn'de, her araç için önümüzdeki `rollingDays` boyunca bağlantı takviminden öngörülen **her** kapalı hat dönemi (yer istasyonu boşluğu, cisim arkası, kavuşum) boyunca havuz (araç + uydu tamponu payı) ileri izlenir; tepe doluluğu `margin × kapasite`yi aşmayacak en büyük bilim verisi çarpanı ikili aramayla seçilir. Telemetri kısılmaz. Böylece **Ay'da çalışır**. `strategy` ve `coverage` kodu aynı (ortak projeksiyon fonksiyonu, aritmetik aynı; sayılar birebir tuttu). Parametreler `HYPOTHETICAL.rollingStrategy` (`rollingDays` 3, seçenekler 0,5–45 gün, `margin` 0,9, `assetBufferShare` 1, `refreshSec` 1800).
- **Tahmin hatası** (`SchedConfig.forecast`): stratejilerin bildiği takvim/kayıp sapar, **gerçek simülasyon değişmez**. (1) her açık pencerenin başı/sonu ±N dk (+ iyimser: uzun sanılır; − kötümser), (2) pencerelerin tümü ±N dk ötelenir, (3) ortalama kayıp tahmini ±% sapar. Belirleyici, rastgelelik yok; adıma yuvarlanır (tarama adımı 600 sn); veri aralığının kenarına değen pencere uçları kenar kaymasından etkilenmez. Hata verilmezse sonuç birebir aynı (testli). `strategy`, `coverage`, `rolling` hata alır; öncelikli/FIFO almaz.
- **Yüzey hattı yeniden deneme aralığı:** `HYPOTHETICAL.arq.surfaceRetrySec` (varsayılan **0 = aynı adımda**, Aşama 5–7 davranışı; sayılar korunur). > 0 ise kaybolan paket kuyruktan çıkar, tamponda yer tutarak bekler, süre dolunca başa döner (bu sırada hat başka paketlere devam eder).
- **Arayüz** (Çizelgeleyici): "Kayan ufuk" seçici; kayan ufuklu strateji Mars'ta 5, Ay'da 3 çizelgeleyicili karşılaştırmada; **(g) Tahmin hatası** ve **(h) Hata modeli duyarlılığı** bölümleri (**düğmeyle** hesaplanır; senaryo/seçim değişince silinir). Mars taramaları (f) eski dört çizelgeleyiciyle kaldı (hesap süresi), Ay taramalarına kayan ufuklu eklendi.

![Ay 1 istasyon: karşılaştırma](docs/asama8-ay-karsilastirma.png)
![Ay 1 istasyon: tampon](docs/asama8-ay-tampon.png)
![Ay: istasyon sayısına göre](docs/asama8-ay-istasyon-karsilastirma.png)
![Mars 1 istasyon: karşılaştırma](docs/asama8-mars-karsilastirma-1-istasyon.png)
![Mars 1 istasyon: tampon](docs/asama8-mars-tampon-1-istasyon.png)
![Mars: istasyon sayısına göre](docs/asama8-mars-istasyon-karsilastirma.png)

### 1. Kayan ufuklu strateji sonuçları (300 sn, hatalı hat + yeniden iletim [periyodik], ufuk 3 gün; hücre: düşen+hatta kayıp % / toplam kayıp (düşen+hatta kayıp+üretilmeyen) % / teslim % [üretilmeyen %]; **varsayımsal**)

| Hat | İst. | Hat açık % | Öncelikli | Aşama 4 strateji | Kapsama bilen | Kayan ufuklu |
|---|---|---|---|---|---|---|
| Ay 2028-03-03, 60 g | 1 | 37,5 | 23,9 / 23,9 / 73,2 | = öncelikli | = öncelikli | **7,4** / 24,1 / 73,2 [16,7] |
| Ay | 2 | 64,6 | 0,0 / 0,0 / 99,9 | = | = | 0,0 / 0,0 / 99,9 [0,0] |
| Ay | 3 | 86,8 | 0,0 / 0,0 / 99,9 | = | = | 0,0 / 0,0 / 99,9 [0,0] |
| Mars 2028 | 1 | 21,6 | 47,1 / 47,1 / 41,1 | 13,4 / 47,1 / 41,1 [33,7] | 2,8 / 48,9 / 41,1 [46,1] | 7,1 / 48,9 / 41,1 [41,8] |
| Mars | 2 | 36,9 | 32,6 / 32,6 / 67,0 | 1,6 / 33,7 / 65,9 | 0,8 / 34,6 / 65,0 | 4,7 / 33,6 / 66,1 [28,8] |
| Mars | 3 | 48,2 | 32,2 / 32,2 / 67,6 | 1,3 / 33,3 / 66,5 | 0,7 / 34,3 / 65,5 | 4,6 / 33,2 / 66,5 [28,6] |

**Açık sonuç: toplam kayıp ve teslim açısından fayda yok.** Kayan ufuklu strateji "düşen"i çok azaltır (Ay 1 istasyon 23,9 → 7,4; Mars 1 istasyon 47,1 → 7,1) ama bunu "üretilmeyen"e çevirir: Ay 1 istasyonda toplam kayıp 23,9 → 24,1 (+0,2 puan), teslim 73,2 → 73,2 (aynı; hat kapasitesi sınırlayıcı); Mars'ta toplam kayıp +1–1,8 puan, teslim 3 istasyonda −1,1 puan. Ay 2–3 istasyonda zaten kayıp yok, strateji bir şey kazandırmaz. Aşama 7 sonucu burada da geçerli: strateji *neyin* ve *ne zaman* kaybolduğunu değiştirir, hacmi artırmaz. (Mars 3 istasyonda "düşen" bakımından Aşama 4 stratejisinden de **daha kötü**: 4,6 vs 1,3; ufuk 3 gün kavuşumun tamamını görmediği için kısmayı geç başlatıyor.)

**Kayan ufuk duyarlılığı** (düşen+hatta / toplam / teslim [üretilmeyen]):

| Ufuk (gün) | Ay 1 ist. | Mars 1 ist. | Mars 3 ist. |
|---|---|---|---|
| 0,5 | 7,5 / 24,1 / 73,2 [16,6] | 8,5 / 48,9 / 41,1 [40,5] | 5,1 / 33,2 / 66,5 [28,1] |
| 1 | 7,5 / 24,1 / 73,2 | 7,7 / 48,9 / 41,1 | 5,0 / 33,2 / 66,5 |
| **3 (varsayılan)** | 7,4 / 24,1 / 73,2 [16,7] | 7,1 / 48,9 / 41,1 [41,8] | 4,6 / 33,2 / 66,5 [28,6] |
| 10 | 4,8 / 24,1 / 73,2 [19,3] | 4,3 / 48,9 / 41,1 [44,7] | 2,0 / 34,2 / 65,6 [32,2] |
| 30 | 3,6 / 27,5 / 69,8 [23,9] | 2,5 / 51,7 / 38,3 [49,1] | 0,7 / 38,9 / 60,8 [38,2] |
| 45 | 3,6 / 27,5 / 69,9 | 2,5 / 51,7 / 38,3 | 0,7 / 39,0 / 60,8 |

Uzun ufuk "düşen"i daha çok azaltır ama toplam kaybı ve teslimi **kötüleştirir** (ufuk boyunca üretimin hep kısılmış hızda süreceğini varsayan tutucu projeksiyon fazla kısar). 3 gün varsayılan çünkü toplam kayıpta ufuk ≤ 10 günde neredeyse ücretsizdir; bu bir seçimdir.

9 Mars penceresi, 1 istasyon, 1800 sn adım, ufuk 30 gün (düşen / toplam / teslim [üretilmeyen]): kayan ufuklu düşen %1,9–2,9 (kapsama bilen %2,0–3,3), ama toplam kayıp kapsama bilenden her pencerede 2,2–4,4 puan yüksek, teslim 1,9–4,4 puan düşük (ör. 2028-03-08: öncelikli 47,6 / 47,6 / 40,6; kapsama bilen 2,8 / 49,4 / 40,6; kayan 2,5 / 52,1 / 37,9). (`tum-pencereler`)

### 2. Tahmin hatası (tarama adımı 600 sn; kayan ufuk 3 gün; (g) bölümü ve `tahmin`/`capraz` betiği)

Ölçüt: "kayan ufuklu strateji karşılaştırılan çizelgenin altına düştü" = 0,1 puandan fazla kötü (düşen+hatta kayıp daha yüksek, toplam kayıp daha yüksek, teslim daha düşük).

| Senaryo | Düşen+hatta kayıp: öncelikli / Aşama 4'e göre (hata yokken fark) | Toplam kayıp: öncelikli | Teslim: öncelikli |
|---|---|---|---|
| Ay 1 ist. | −17,2 puan (daha iyi); **−480…+480 dk'da hiç kötüleşmez** | hata yokken zaten **+0,24** kötü | −120 dk'da kötüleşir (72,3 vs 73,2); + yönde taranan aralıkta yok |
| Ay 2 ist. | 0 (zaten kayıp yok) | hata yokken 0; **−60 dk**'da kötüleşir (0,7), −120'de 4,5 | −60 dk'da (99,2 vs 99,9), −120'de 95,4 |
| Mars 1 ist. | −40,0 / −6,3 puan; hiç kötüleşmez | hata yokken zaten **+1,9** | kötüleşmez |
| Mars 3 ist. | −27,7 puan; Aşama 4'e göre hata yokken **+3,3 (zaten kötü)** | hata yokken **+1,0** | hata yokken **−1,0** |

**Okuma:**
- **Düşen** bakımından kayan ufuklu strateji, öncelikli çizelgenin altına **hiçbir taranan hata düzeyinde düşmedi** (±480 dk). Aşama 4 stratejisinin altına yalnızca Mars 3 istasyonda (hata yokken bile) düşer (kavuşumu görmeyen kısa ufuk).
- **Toplam kayıp ve teslim** bakımından zaten hata yokken öncelikliden iyi değildir (bölüm 1); yani "altına düşme eşiği" hata yokken sıfırdır. Hatanın bunu *ek olarak* kötüleştirdiği yön **kötümser** hatadır (pencereler kısa sanılır → fazla kısma): Ay 2 istasyonda hiçbir şey kaybedilmezken −60 dk'da %0,7, −120 dk'da %4,5 üretilmeyen (teslim 99,9 → 95,4); Ay 1 istasyonda toplam kayıp 24,2 → 26,5 (−120 dk). Mars'ta kapsama bilen strateji bu hataya daha duyarlı: 1 istasyonda −120 dk'da toplam kayıp 49,1 → 58,5, teslim 40,9 → 38,0; 3 istasyonda 34,3 → 45,7, teslim 65,5 → 54,1.
- **İyimser** hata (pencere uzun sanılır) bu modelde ucuzdur: Ay 1 istasyonda +120 dk'da düşen 6,7 → 6,8; Mars kapsama bilen 2,8 → 4,4 (kayan ufuklu 7,2 → 8,5). Tamponun ve hat boşluklarının zaten geniş olması bunu açıklıyor olabilir; bilmiyorum.
- **Ötelemenin** etkisi ihmal edilebilir (±120 dk'da ≤ 0,2 puan). **Ortalama kayıp sapması** küçük etkili: kayıp %5 olduğu için ±%100 sapma kapasite tahminini ≈ %5 oynatır (Mars 1 ist. kapsama bilen düşen 3,0 → 1,5, kayan ufuklu 7,3 → 6,5; toplam kayıp ≤ 0,2 puan).
- Bu sonuçlar tahmin hatasının **bu varsayımlarla** küçük olduğunu söyler; gerçek istasyon takvimi/bakım belirsizlikleri bu modelin dışındadır.

![Ay: tahmin hatası taraması](docs/asama8-ay-tahmin-hatasi.png)
![Mars: tahmin hatası taraması](docs/asama8-mars-tahmin-hatasi.png)

### 3. Hata modeli duyarlılığı (kümelenmiş model, 3 istasyon, öncelikli, 600 sn; (h) bölümü ve `hata` betiği)
Hatta kayıp paket (yüzey / Dünya hattı); periyodik referans (aynı ortalama kayıp): Mars 2 (0 / 2), Ay 0. Varsayılan: kötü durum kaybı %80, süre 30 dk, yeniden deneme aralığı 0.

| Parametre | Mars 2028 | Ay 2028-03-03, 60 g |
|---|---|---|
| Kötü durum kaybı %20 / 40 / 60 / **80** / 100 | 4 (3/1) · 42 (41/1) · 147 (147/0) · **323 (322/1)** · 568 (568/0) | 4 (1/3) · 10 (3/7) · 41 (21/20) · **85 (53/32)** · 163 (91/72) |
| Kötü durum süresi 10 / 20 / **30** / 60 / 120 dk | 181 (181/0) · 257 (257/0) · **323 (322/1)** · 494 (491/3) · 1.283 (760/523) | 74 (74/0) · 59 (54/5) · **85 (53/32)** · 245 (44/201) · 579 (83/496) |
| Yüzey yeniden deneme aralığı **0** / 10 / 30 / 60 / 120 dk | **323 (322/1)** · 20 (19/1) · **2 (0/2)** · 1 (0/1) · 1 (0/1) | **85 (53/32)** · 52 (22/30) · 35 (0/35) · 30 (0/30) · 29 (0/29) |

**Okuma:** (i) Kayıp, kötü durum kaybı ve süresiyle hızla artar; teslim ve düşen % neredeyse değişmez (Mars teslim %67,6 → 67,4; Ay %99,8 → 99,3) — etki *hangi paketlerin kalıcı kaybolduğunda*. (ii) **Mars'ta kaybın baskın kısmı yüzey hattındandır** (RTT ≈ 0, yeniden deneme aynı kötü durumda); yüzey yeniden deneme aralığı 10 dk'ya çıkınca 323 → 20, **30 dk'da 2** (periyodik modelin seviyesi) olur, yani yüzeyden gelen kayıp kötü durumun ortalama süresine eşit bir aralıkla yok olur. Dünya hattı kaybı Mars'ta RTT'den (~40 dk) dolayı düşüktür, kötü durum süresi 120 dk'ya çıkarsa (RTT'yi aşarsa) 523'e sıçrar. (iii) Ay'da yüzey kaybı yeniden denemeyle 0'a iner (30 dk) ama **Dünya hattı kaybı (RTT ~3 sn) 29–35'te kalır**: yeniden deneme aralığı yüzey hattını düzeltir, Dünya hattını düzeltmez. (iv) Bekleyen kopya tamponda yer tutar; bu senaryoda (3 istasyon) düşen etkisi görülmedi, tampon dar olsaydı görünürdü (testle korunumu doğrulandı).

![Ay: hata modeli taraması](docs/asama8-ay-hata-modeli.png)
![Mars: hata modeli taraması](docs/asama8-mars-hata-modeli.png)

### 4. Hesabın Web Worker'a taşınması (onayla eklendi)

Aşama 8'in dördüncü maddesi, onay beklediği için ilk PR'da yoktu; onay gelince ayrı PR ile yapıldı. Yeni bağımlılık ve GitHub Actions iş akışı yok (Vite'ın yerleşik Worker desteği; `npm run build` Worker'ı `dist/assets/compute.worker-*.js` olarak üretir, Pages yayını değişmedi).

- **Mimari:** `src/network/compute.ts` (saf işleyici, DOM yok: bağlantı çizelgesi üretimi, çizelgeleyici çalıştırma, tarama noktası, yer istasyonu kapsaması), `compute.worker.ts` (ince Worker girişi), `computeClient.ts` (**Worker havuzu**: en çok 4, `hardwareConcurrency − 1` işçi; her biri izlerin kendi kopyasını ve bağlantı çizelgesi önbelleğini tutur; Worker kurulamazsa aynı işleyici ana iş parçacığında çalışır). Panel (`schedulerPanel.ts`) yalnızca iş verir ve sonucu çizer; kapsama tablosu, senaryo, istasyon karşılaştırması, hata modeli, tarama ve (g)/(h) taramaları **işçi havuzunda birlikte** hesaplanır, her bölüm bitince çizilir. Hesap sonuçları ana iş parçacığındaki hesapla **aynıdır** (testle doğrulanır; tarayıcıda da aynı sayılar: örn. Mars 1 istasyon kayan ufuklu düşen %6,7 / üretilmeyen %40,1).
- **İptal belirteci:** kaydırıcı, senaryo, istasyon, hat modu ya da kayan ufuk değişince `bump()` hem belirteci hem havuzu iptal eder: bekleyen işler **hiç başlamaz**, sürmekte olanın sonucu atılır (işçi o işi bitirince serbest kalır; tek iş ≤ ~0,3 sn). Atılan işlerin sözleri sonuçlanmaz (reddedilmez de): "yakalanmamış söz reddi" gürültüsü olmasın diye; kimse tutunmadığı için çöp toplanır. Tarama sürerken senaryo değiştirmek de denendi (konsolda hata yok).
- **Ölçüm** (gerçek veri, `vite preview`, 4 çekirdekli kapta, 3 işçi; `longtask` ile; Aşama 8'in ilk PR'ındaki ana iş parçacığı sürümüyle karşılaştırma):

| | Aşama 7 / ilk Aşama 8 PR'ı (ana iş parçacığı, parçalı `setTimeout`) | Web Worker havuzu |
|---|---|---|
| Mars ilk açılış, tüm bölümler | ≈ 14,5–16,5 sn | **≈ 6,1–6,5 sn** (en yavaş bölüm: duyarlılık taraması) |
| Senaryo (5 çizelgeleyici) ilk çizim | ≈ 0,8–1,0 sn | ≈ 0,75–0,85 sn (ilk açılış), 0,4 sn (sonraki) |
| `longtask` sayısı / toplamı (açılış) | ≈ 115–120 / ≈ 14–15 sn | **3 / ≈ 0,25 sn** |
| **En uzun görev (ana iş parçacığı)** | 279–324 ms | **124–138 ms** (Aşama 7: 229–396 ms; hedefin altında) |
| Mars istasyon/mod değişince (önbellekli bağlantı) | ≈ 10–12 sn | ≈ 4–4,7 sn |
| Mars (g) tahmin hatası taraması / (h) | ≈ 7 sn / ≈ 2 sn | ≈ 2,8 sn / ≈ 0,9 sn |
| Ay ilk açılış | ≈ 2,9 sn | ≈ 1,4 sn |

Kalan üç ana iş parçacığı görevi (≈ 80–140 ms) Chart.js'in ilk yüklenmesi ve ilk grafik çizimleridir (hesap değil); bunların altına inmek için çizimin bölünmesi gerekir, yapılmadı. Sayfa hesap sırasında hiç takılmadı (hesap ana iş parçacığında değil). İlk açılışta toplam süre çekirdek sayısına bağlıdır: tek çekirdekte işçiler paylaşır, kazanç yalnızca "sayfa takılmaz" olur (ölçülmedi, bilmiyorum).

- **Beklenmedik (madde 4):** (1) **İptal edilen işin sözünü reddetmek** ilk denemede hem yakalanmamış söz hatalarına hem de önbellekteki bekleyen sözün sonsuza dek asılı kalmasına yol açtı (bağlantı çizelgesi özeti önbelleğe *söz* olarak alınmıştı; iptalden sonra yeniden kullanılınca hesap hiç bitmedi); düzeltme: yalnızca tamamlanmış özetler önbelleğe alınıyor. (2) (g) taramasında bir `async` döngüsünün henüz atanmamış diziye eriştiği hata (yalnızca tarayıcıda, Mars (g)) bulundu ve düzeltildi. (3) Her işçi kendi bağlantı çizelgesi önbelleğini kurar (aynı çizelge işçi sayısı kadar kez üretilebilir; ≈ 0,1–0,5 sn).
![Worker ile hesaplanan senaryo ve durum satırı](docs/asama8-worker-ayarlar.png)

- **Testler:** `npm test` **114 test** (önce 108). `src/network/compute.test.ts` (**sentetik**: uydurma dairesel yörüngeli konum izleri): işleyici sonucu doğrudan çağrıyla birebir aynı (`sim`, `tlInfo`, `policy`, `coverage`), başlatılmadan hata, bozuk aralıkta hata; havuz (1 ve 3 işçi) sonucu aynı; iptalde bekleyen işlerin hiç başlamadığı ve sonuçların atıldığı; hatadan sonra havuzun çalışmaya devam etmesi.

### Gerçek veriyle doğrulama (Playwright/Chromium, `vite preview`, `?sentetik=1` yok)
Denendi: Ay 1/2/3 ve Mars 1/2/3 istasyon (kayan ufuklu strateji, kayan ufuk 30 gün seçimi), (g) ve (h) taramaları (Ay ve Mars), dar ekran (420 px; sayfa yatay taşmıyor, `scrollWidth` 420), harita sekmesi: 10 cisim satırı, kart canvas'ı, katman anahtarları + `localStorage`, zoom/sürükleme, 2B/3B, tutulma ve Mars kavuşumu düğmeleri; dar ekranda ⋯, bilgi paneli, harita 681 px / alt çubuk 43 px (Aşama 7 ile aynı). **Konsolda hata/uyarı yok** (tüm akışlarda).

![Harita](docs/asama8-harita-masaustu.png)
![Harita 3B](docs/asama8-harita-3b.png)
![420 px](docs/asama8-dar-ekran-kapali.png) ![420 px, ⋯](docs/asama8-dar-ekran-kontroller.png) ![420 px, bilgi](docs/asama8-dar-ekran-bilgi.png) ![420 px, (g)](docs/asama8-dar-ekran-cizelgeleyici.png)

**Hesap süresi** (aynı kapta, aynı betikle, `main` ve bu dal art arda ölçüldü; `longtask` ile): Mars ilk açılış toplam **14,5–16,5 sn** (main: 15,1–16,1; bu dal: 14,5–16,2; tek seferlik 15,8 sn / 537 ms aykırı değer), en uzun tek görev **279–324 ms** (main 287–324, bu dal 279–315). **Aşama 7'nin altına inemedi:** hesap hâlâ ana iş parçacığında, `setTimeout` ile parçalı; tek bir 300 sn'lik çizelgeleyici çalıştırması ≈ 0,25–0,3 sn ve Chart.js'in ilk çizimi bu tabanı belirliyor. Beşinci çizelgeleyici senaryo ve (d) bölümüne ≈ 0,2–0,4 sn ekledi, toplam gürültü içinde kaldı (Mars taramaları (f) beşinci politikayı kapsamıyor). Yeni (g)/(h) taramaları isteğe bağlıdır: Mars (g) ≈ 7 sn, (h) ≈ 2 sn; Ay (g) ≈ 0,9 sn, (h) ≈ 0,6 sn; en uzun görev 61–231 ms. Ay ilk açılış ≈ 2,9 sn (en uzun görev 131 ms). **Hesabı Web Worker'a taşıma (madde 4) onay beklediği için bu ölçümde yoktu; sonradan onayla yapıldı, bölüm 4.**

### Testler
`npm test`: **108 test** (önce 89; yeni 19, `src/network/rolling.test.ts`, hepsi **sentetik**: uydurma tek araçlı topoloji ve uydurma periyodik hat boşlukları): kayan ufuklu strateji (kapalı dönem yokken öncelikliyle birebir aynı; kavuşum işareti olmadan boşluklarda kısar, Aşama 4/7 stratejileri aynı desende hiçbir şey yapmaz; telemetri kısılmaz/düşmez; **korunum ve talep denklemleri**, düşen/üretilmeyen ayrımı; kısma teslim edilen hacmi artırmaz; kavuşumda da çalışır; deterministik, girdiyi değiştirmez; ayar yoksa kısmaz), tahmin hatası (`forecastFlags`; hata yok = kusursuzla birebir; öncelikli etkilenmez; iyimser/kötümser yönler; kayıp sapması; öteleme), yüzey yeniden deneme aralığı (0 = eski davranış birebir; korunum, bekleyen paket "kalan"; uzun aralık yüzey kaybını azaltır; deterministik; küçük tamponla korunum). Mevcut testlere dokunulmadı.

### Beklenmedik ve dikkat edilecekler
1. **Toplam kayıp/teslim iyileşmedi** (yukarıda): Aşama 7'nin bulgusu üçüncü kez doğrulandı; "düşen" tek başına yanıltıcıdır.
2. **Uzun ufuk kötüleştirir**: ufuk 30–45 gün toplam kaybı 3–6 puan artırır (tutucu projeksiyon). Mars kavuşumunu görmek için uzun ufuk gerekir ama bedeli var; varsayılan 3 gün Mars 3 istasyonda Aşama 4'ten daha çok düşürür.
3. **Kapsama bilen strateji kötümser takvim hatasına en duyarlı politikadır** (Mars 3 ist. toplam kayıp 34,3 → 45,7 @ −120 dk); iyimser hata ucuz çıktı, nedeni tam anlaşılmadı.
4. **Havuz yaklaşımı yüzey hattını modellemez:** boşalma yalnızca Dünya hattı açıklığına bağlı; araç yüzey hattı kapalıyken araç tamponundaki veri boşalmaz. Ay'da yüzey görüşü %34–38 olduğundan projeksiyon iyimser olabilir (varsayım).
5. **ARQ kopyalarının RTT boyunca tampon tutması ve yüzeydeki bekleyen kopyalar** projeksiyonda yok sayılır (iyimser).
6. **Tarama 600 sn adımlı**; ±N dk kayması adıma yuvarlanır, 10 dk altı sapma ayırt edilemez. Kümelenmiş zincir 600 sn adımlıdır (meanBadSec ≥ adım seçildi); 10 dk'lık kötü süre adım sınırındadır.
7. **Kötü durum kaybı ortalama kayıptan küçükse** (örn. Dünya kaybı kaydırıcıyla %40 iken kötü durum %20) ortalama kırpılır; taramada ortalama sabit kalmaz.
8. **Sonuçlar tek senaryo aralığıdır** (Ay 2028-03-03/60 g, Mars 2028 penceresi); Ay 1 istasyonda başka aralık denenmedi (Aşama 7'de aralığa duyarlılık görülmüştü).
9. **(g)/(h) isteğe bağlı** (düğmeyle): ilk açılış süresi artmasın diye. Web Worker ile (bölüm 4) artık ucuz (Mars ≈ 3 sn / 1 sn); otomatik çalıştırmak bir tasarım kararıdır, yapılmadı.
10. **Hesap süresi hedefi ilk PR'da tutmadı** (ilk açılış ≈ 15 sn, en uzun görev ≈ 0,3 sn); Web Worker onayıyla bölüm 4'te giderildi (≈ 6 sn, en uzun görev ≈ 0,13 sn).

### Kararlar
- Yeni dış bağımlılık ve GitHub Actions iş akışı eklenmedi (Web Worker: onay beklediği için ilk PR'da yoktu, sonradan onayla eklendi, bölüm 4); yeni politika ayrı ad (`'rolling'`), `strategy`/`coverage` aynen.
- Yeni varsayımsal değerler yalnızca `hypothetical.ts`: `rollingStrategy`, `forecastScan`, `errorScan`, `arq.surfaceRetrySec` (varsayılan 0).
- `scripts/asama8-sonuclar.ts` yalnızca `public/data/` okur (Horizons'a erişmez), `vite-node` ile çalışır.
- Tahmin hatası yalnızca stratejilerin bildiği takvime uygulanır; gerçek bağlantılar ve kayıplar değişmez.

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
src/data/    veri okuma, tipler, genel fiziksel bilgiler (bodyFacts)
src/map/     interpolasyon (ephemeris), Canvas çizimi, etiket yerleştirici (labels), gezegen dokuları ve küre kartı hesabı
src/ui/      kontroller, bilgi paneli + küre kartı, sol panel (Cisimler, katmanlar), ağ paneli
src/network/ ağ modeli (gecikme, bağlantı durumu, kavuşum), çizelgeleyici + stratejiler + hata modeli, tarama, zaman çizelgesi; compute.ts / compute.worker.ts / computeClient.ts (uzun hesabı Web Worker havuzunda çalıştıran işleyici ve istemci)
src/config/  varsayımsal değerler (tek dosya)
scripts/     Horizons veri çekme betiği; asama7-sonuclar.ts, asama8-sonuclar.ts (README sayılarını gerçek veriyle üreten betikler, Horizons'a erişmez)
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
6. **Çizelgeleyici varsayımları:** (yer istasyonu ve yeniden iletim Aşama 5'te eklendi) kodlama yok; tek bağlantı hızı; uydu tamponu doluyken araç tutar (geri basınç); uydudaki araçlar sırayla (ilk araç önce) kaynağa erişir. Gerçekçi tampon boyutları ve sınıf payları için gerçek bir görev profili gerekir, bilmiyorum.
7. **Kavuşum sırasında telemetri:** öncelik, kesinti sırasında üretilen telemetriyi öne alamaz (hat kapalı). Aşama 4'teki strateji bilim verisini kısar ama telemetriyi hızlandıramaz; telemetri gecikmesi kesinti uzunluğuna eşit kalır. Telemetriyi de kısan ya da daha sık/küçük paketlere bölen bir strateji denenmedi.
8. **Gerçek veriyle doğrulama:** Aşama 4'te yapıldı (yukarıya bakın).
9. **Strateji varsayımları:** kesintinin başı/sonu önceden bilinir (hatasız); bütçe tamponun %90'ı (`margin`), 1 gün önceden başlar. Gerçekçi bir görev bu parametreleri bilmez; sonuçlar kavramsaldır.
10. **Üretilmeyen veri "kayıp" sayılmaz** (ayrı sütun); bunu tanım olarak seçtim ve karşılaştırmada hem "düşen" hem "düşen + üretilmeyen" gösteriyorum. Sizin için "üretilmeyen" farklı bir maliyete denk geliyorsa (ör. bilimsel değeri olan kısma) bu tanımı birlikte gözden geçirelim.
11. **Ay Aracı A görüş sorunu:** Aşama 5'te enlem −40°'ye alınarak giderildi (kutup bölgesi modellenmedi, yukarıya bakın). Aşama 7'de arayüze Ay hattı senaryosu eklendi (seçilebilir tarih aralığı).
12. **Mars aktarma uydusunun Mars gölgesi (tutulma) ve güç modeli** yok; yalnızca "Dünya cismin arkasında" kesintisi var.
13. **3B görünüm:** Aşama 6'da arayüz işleri yapıldı (sol panel, kart, etiketler, katmanlar); projeksiyon değişmedi.
14. **Yer istasyonu ve ARQ varsayımları:** konumlar derin uzay istasyonlarına benzer seçilmiş varsayımsal değerlerdir; kayıp modeli belirleyici (periyodik ya da, Aşama 7'den beri, sabit tohumlu kümelenmiş); Aşama 4'ün stratejisi kapsamayı bilmez, Aşama 7'deki yeni strateji bilir (kapsama takvimi önceden bilinir varsayımıyla).
15. **Kapsama takvimi önceden bilinir mi?** (Aşama 7) Yörünge ve Dünya dönüşü öngörülebilirdir, ama gerçek bir görevin istasyon çizelgesini, bakım ve çakışmaları ne kadar önceden bildiğini bilmiyorum; tahmin hatası modellenmedi. Ortalama hat kaybının önceden bilindiği varsayımı da aynı sınırlamayı taşır.
16. **Kümelenmiş hata parametreleri** (kötü durumda %80 kayıp, ortalama 30 dk, iyi durumda %0,5) uydurmadır; gerçek hat ölçümüne dayanmaz. Sonuçlar (özellikle `maxAttempts` aşımı) bu parametrelere ve RTT'ye çok duyarlıdır.
17. **Havuz tanımı (kapsama bilen strateji):** araç tamponu havuza dahil (`assetBufferShare` = 1) varsayıldı; 0 yapılırsa düşen sıfıra iner ama daha çok kısar. Hangisinin doğru maliyet olduğu bir tasarım kararıdır, sizinle gözden geçirilmeli.

## Kullanılan dış kaynaklar

- [NASA/JPL Horizons System](https://ssd.jpl.nasa.gov/horizons/) — gezegen ve Ay konumları (kamuya açık veri).
- [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT) — tutulma hesabı (yalnızca geliştirme aşamasında).
- [Chart.js](https://www.chartjs.org) (MIT) — karşılaştırma grafikleri.
- Araçlar: [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev).

## Sonraki aşamalar

Aşama 9 adayları (değerler **varsayımsal** kalır; sonuçlar gerçek bir görev sonucu değildir):
- **Kalan ana iş parçacığı görevleri** (Chart.js yüklemesi ve ilk çizimler ≈ 0,1 sn) ve (g)/(h) taramalarının açılışta otomatik çalıştırılması (Worker ile artık ucuz).
- **Toplam kaybı gerçekten azaltan strateji:** kısma yalnızca kaybı "üretilmeyen"e çeviriyor; telemetriyi de ele alan (daha sık/küçük paket, telemetri kısma) ya da bilim verisi değerine göre kısan strateji; ufuk seçimini (kısa/uzun) uyarlamalı yapmak.
- **Yüzey hattı kapalılığını havuz projeksiyonuna katmak** ve ARQ kopyalarının tampon payını hesaba katmak.
- **Ay'da kutup bölgesi ve eğimli/eliptik yörünge**, Mars aktarma uydusu gölgesi ve güç modeli.
- **Başka Ay aralıkları ve 1 istasyon dışında tahmin hatası taraması** (tek senaryodan genelleme yapılmadı).
