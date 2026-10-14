# Duyuru taslakları / Announcement drafts

Canlı demo: https://mastartm.github.io/solar-system-data-network/
Kod (MIT): https://github.com/mastartm/solar-system-data-network

Önemli: Konumlar ve ışık gecikmeleri gerçek NASA/JPL Horizons verisidir. Ay/Mars aktarma uydusu ağı, veri hızları, tamponlar ve çizelgeleyici sonuçları **varsayımsaldır**; gerçek bir görev sonucu değildir. Paylaşırken bunu atlamayın.
Important: positions and light delays are real NASA/JPL Horizons data. The Moon/Mars relay network, data rates, buffers and scheduler results are **hypothetical**, not a real mission result. Do not omit this when sharing.

## Türkçe kısa metin (X / LinkedIn)
Güneş sistemi haritası + Ay/Mars aktarma uydusu ağı simülasyonu: gerçek NASA Horizons konumlarıyla ışık gecikmesi ve Mars kavuşumu kesintisini gösteriyor, varsayımsal bir veri ağında kuyruk/akış kontrolü stratejilerini karşılaştırıyor. Türkçe/İngilizce, tarayıcıda çalışır, açık kaynak (MIT). Ağ değerleri uydurmadır; amaç eğitim ve görselleştirme.
Demo: https://mastartm.github.io/solar-system-data-network/

## English short text
An interactive solar-system map with real NASA Horizons positions, light delays and Mars solar-conjunction blackouts, plus a simulation of a hypothetical Moon/Mars relay network comparing queueing and flow-control strategies. Runs in the browser, Turkish/English UI, open source (MIT). Network parameters are invented; it is an educational visualization, not a mission result.
Demo: https://mastartm.github.io/solar-system-data-network/

## Show HN
Başlık / Title: Show HN: Solar system map with real Horizons data and a hypothetical Moon/Mars relay-network simulator

Body:
I built a browser-based solar-system map (TypeScript + Canvas, no backend) using real JPL Horizons ephemerides for 2020–2040, showing one-way light delays and the Mars solar-conjunction communication blackout. On top of it is a simulation of a *hypothetical* Moon/Mars relay-satellite network: vehicles -> relay satellite -> Earth, with ground-station visibility, lossy links with retransmission, finite buffers, and several schedulers (FIFO, priority, conjunction-aware, rolling-horizon, adaptive, value-aware) compared on drop/loss/delivery.
Everything about the network (vehicles, data rates, buffers, thresholds, orbits, value weights) is made up and marked "Hypothetical values" in the UI; only the positions, light delays and link geometry are real. The README documents each stage's method, measurements and negative results (including "no effect" cases).
Demo: https://mastartm.github.io/solar-system-data-network/
Source (MIT): https://github.com/mastartm/solar-system-data-network
Feedback welcome, especially on the scheduling model and what would make it more realistic.

## Reddit (r/space, r/dataisbeautiful, r/webdev — each sub's rules apply)
Title: I made an interactive solar-system map with real Horizons data and a hypothetical Moon/Mars relay-network simulator (open source)
Text: use the Show HN body; add a screenshot from docs/ (real-data screenshots only).

## Nereye (gerçekçi hedefler / realistic targets)
Hacker News (Show HN), Reddit (r/space, r/dataisbeautiful, r/webdev, r/sideproject), LinkedIn, X, Türk üniversite uzay/havacılık kulüpleri, Webrazzi/ekşi sözlük tarzı topluluklar. NASA/SpaceX'e doğrudan gönderim yanıt getirmesi zor; topluluk geri bildirimi geldikten sonra bağlantıyla yazmak daha anlamlı.
