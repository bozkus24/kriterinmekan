# Kriterin Mekan ☕

**Kriterine göre kafe bulma sitesi** — ziyaretçi kendi kriterlerinin (wifi, dış mekân, paket servis, erişilebilirlik, sigara alanı, yakınlık) önemini ayarlar; site İstanbul'un 39 ilçesindeki **15.217 gerçek kafeyi** bu ağırlıklara göre puanlayıp %eşleşme skoruyla sıralar.

Veri kaynakları: OpenStreetMap (© OSM katkıcıları, ODbL) + Overture Maps
Foundation (CDLA-Permissive-2.0 / ODbL).

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
data/source/export.geojson              (OSM ham verisi, 3.099 nokta)
        │  python3 scripts/convert.py
        ▼
data/cafes.json                         (2.932 isimli OSM kafesi)
        │  python3 scripts/merge_overture.py   ← pip install pyarrow
        │  + data/source/overture_istanbul.parquet (Overture İstanbul kesiti)
        ▼
data/cafes.json                         (15.217 mekan, birleşik)
```

Overture birleştiricisi: güven skoru ≥ 0.5 kayıtları alır, kendi içindeki ve
OSM'deki mükerrerleri (normalize ad + ≤200 m) teker indirir, eşleşen OSM
kayıtlarına eksik telefon/web ekler (+707 tel, +406 web), yenilerin ilçesini
adresten (11.005) veya kNN ile (1.280, `*` imli) atar. Overture kesitini
tazelemek için `scripts/merge_overture.py` başındaki açıklamaya bakın.

Dönüştürücünün yaptıkları:

- İsimsiz mekanları atlar (167 adet).
- İlçe adlarını resmî 39 ilçe listesine eşler: her yazım varyantı tek kayıtta
  birleşir (`kadıköy`, `Kadikoy`, `KADIKÖY` → `Kadıköy`; `Bakirköy` → `Bakırköy`;
  `Eyüp` → `Eyüpsultan`), ilçe sanılan semtler düzeltilir (`Karaköy` → `Beyoğlu`).
- **Semti eksik ~2.000 mekana**, semti bilinen en yakın 5 mekanın çoğunluk semtini atar (kNN). Bu tahminler `"semtTahmini": true` ile işaretlenir ve arayüzde `*` ile gösterilir.
- OSM niteliklerini `yes / no / null (bilinmiyor)` üçlüsüne indirger.
- Mutfak etiketlerini Türkçeleştirir (`coffee_shop` → `Kahve`).

Veriyi güncellemek için: yeni bir OSM dışa aktarımını `data/source/export.geojson` üzerine yazıp `python3 scripts/convert.py` çalıştırmanız yeterli.

## Puanlama

Her kriter üç düzeyden birine ayarlanır:

- **Fark etmez** — hesaba katılmaz.
- **Önemli** — eşleşme yüzdesine ağırlığıyla katılır.
- **Olmazsa olmaz** — filtre gibi çalışır: özelliği "var" olmayan mekanlar
  listeden çıkarılır (yakınlıkta ≤ 2 km, genel puanda ★4 ve üzeri demektir).

```
nitelik puanı  : var = 1 · bilinmiyor = 0.35 · yok = 0
yakınlık puanı : 1 − (uzaklık / 5 km)        (konum izniyle etkinleşir)
genel puan     : (yıldız ortalaması − 1) / 4
Eşleşme %      = Σ(ağırlık × puan) / Σ(ağırlık) × 100
```

Bilinmeyen nitelikler cezalandırılmaz ama ödüllendirilmez; kartlarda dürüstçe `?` olarak gösterilir. "Şu an açık" filtresi OSM `opening_hours` gösterimini çözümler (`24/7`, `Mo-Fr 09:00-18:00; Sa 10:00-14:00`, gece taşan aralıklar).

## Topluluk Puanları

Kriterler iki gruptur: **Kayıtlı veriler** (OSM'den gelen wifi, dış mekân vb.)
ve **Topluluk puanları** (genel yıldız + priz + sessizlik + çalışma ortamı).
Ziyaretçi her kartta "☆ Puanla" ile oy verir:

- Oy, ziyaretçinin tarayıcısında (`localStorage`) saklanır ve kendi
  sıralamasına anında yansır.
- `data/puanlar.json` sahibin doğruladığı **kalıcı** oyları tutar; buraya
  eklenen oylar herkese gösterilir ve ortalamaya katılır.
- **Ortak oy havuzu** (isteğe bağlı): Firebase yapılandırılırsa oylar tüm
  ziyaretçilerde toplanır — aşağıya bakın.

### Ortak oy havuzu: Firebase kurulumu (~10 dk)

Oyların tüm ziyaretçilerde ortak toplanması için ücretsiz bir Firebase
projesi yeterlidir (SDK yüklenmez; site Firestore REST API ile konuşur):

1. [console.firebase.google.com](https://console.firebase.google.com) →
   **Add project** (Analytics gereksiz, kapatabilirsiniz).
2. Sol menü **Build → Firestore Database → Create database** →
   *Start in production mode* → bölge seçin (ör. `europe-west1`).
3. Firestore'un **Rules** sekmesine bu depodaki `firestore.rules`
   dosyasının içeriğini yapıştırıp **Publish** deyin.
4. **Project settings (⚙) → Your apps → Web (`</>`)** ile bir web
   uygulaması ekleyin; çıkan config'ten yalnızca `projectId` ve `apiKey`
   değerlerini `js/firebase-config.js` içine yazın.
5. Yayınlayın. Artık "☆ Puanla" oyları `oylar` koleksiyonunda toplanır,
   sayfa açılışında çekilir ve herkesin ortalamasına katılır. Ziyaretçi
   oyunu değiştirirse aynı belge güncellenir (mükerrer oy oluşmaz).

Notlar: `apiKey` gizli değildir (istemci kimliği; erişimi `firestore.rules`
sınırlar). v1 anonim oy modelidir — kötüye kullanım görülürse bir sonraki
adım Firebase Anonymous Authentication eklemektir. Claude Artifact
önizlemesinde dış ağ engellendiği için havuz yalnızca gerçek hostingde
çalışır.

### Örnek (demo) puanlar

Site yayına girmeden arayüzün dolu görünmesi için gerçekçi örnek oylar
üretilebilir; bu durumda arayüz **"★ puanlar örnek veridir"** rozeti gösterir:

```bash
python3 scripts/gen_demo_votes.py            # 647 mekana ~2.300 örnek oy
python3 scripts/gen_demo_votes.py --temizle  # lansman: tümünü sil
```

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
