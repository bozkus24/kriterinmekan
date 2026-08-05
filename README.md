# Kriterin Mekan ☕

**Kriterine göre kafe bulma sitesi** — ziyaretçi kendi kriterlerinin (wifi, dış mekân, paket servis, erişilebilirlik, sigara alanı, yakınlık) önemini ayarlar; site İstanbul'daki **2.932 gerçek kafeyi** bu ağırlıklara göre puanlayıp %eşleşme skoruyla sıralar.

Veriler OpenStreetMap'ten alınmıştır (© OpenStreetMap katkıcıları).

## Çalıştırma

Derleme adımı yoktur — düz HTML/CSS/JS:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Veya dosyaları doğrudan hostinge (Greaterine.com, GitHub Pages, Netlify vb.) yükleyin.

**Tek dosyalık sürüm** (tüm site + veri tek HTML içinde, `file://` ile bile açılır):

```bash
python3 scripts/build_single.py dist/kriterinmekan-single.html --full
```

## Veri Hattı

```
data/source/export.geojson   (OSM ham verisi, 3.099 nokta)
        │  python3 scripts/convert.py
        ▼
data/cafes.json              (2.932 isimli kafe, normalize edilmiş)
```

Dönüştürücünün yaptıkları:

- İsimsiz mekanları atlar (167 adet).
- Semt adlarını normalize eder (`kadıköy` → `Kadıköy`).
- **Semti eksik ~2.000 mekana**, semti bilinen en yakın 5 mekanın çoğunluk semtini atar (kNN). Bu tahminler `"semtTahmini": true` ile işaretlenir ve arayüzde `*` ile gösterilir.
- OSM niteliklerini `yes / no / null (bilinmiyor)` üçlüsüne indirger.
- Mutfak etiketlerini Türkçeleştirir (`coffee_shop` → `Kahve`).

Veriyi güncellemek için: yeni bir OSM dışa aktarımını `data/source/export.geojson` üzerine yazıp `python3 scripts/convert.py` çalıştırmanız yeterli.

## Puanlama

```
nitelik puanı  : var = 1 · bilinmiyor = 0.35 · yok = 0
yakınlık puanı : 1 − (uzaklık / 5 km)        (konum izniyle etkinleşir)
Eşleşme %      = Σ(ağırlık × puan) / Σ(ağırlık) × 100
```

Bilinmeyen nitelikler cezalandırılmaz ama ödüllendirilmez; kartlarda dürüstçe `?` olarak gösterilir. "Şu an açık" filtresi OSM `opening_hours` gösterimini çözümler (`24/7`, `Mo-Fr 09:00-18:00; Sa 10:00-14:00`, gece taşan aralıklar).

## Dosya Yapısı

```
index.html                → Tek sayfalık arayüz (Türkçe)
css/style.css             → Claude organik stili: fildişi zemin, terrakota vurgu,
                            serif başlıklar; açık + koyu tema
js/app.js                 → Puanlama motoru, filtreler, "şu an açık" çözümleyici
data/cafes.json           → İşlenmiş veritabanı
data/source/export.geojson→ OSM ham verisi
scripts/convert.py        → GeoJSON → cafes.json dönüştürücü
scripts/build_single.py   → Tek dosyalık sürüm üretici
```
