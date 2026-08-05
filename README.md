# KriterinMekan ☕

**Kriterine göre kafe bulma sitesi** — ziyaretçi kendi kriterlerinin (kahve kalitesi, wifi, sessizlik, fiyat vb.) önemini ayarlar, site tüm mekanları bu ağırlıklara göre puanlayıp en uygun olanları %eşleşme skoruyla sıralar.

## Çalıştırma

Derleme adımı yoktur — düz HTML/CSS/JS. Herhangi bir web sunucusuyla açın:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Veya dosyaları doğrudan hostinge (Greaterine.com, GitHub Pages, Netlify vb.) yükleyin.

## Veritabanını Bağlama

Tüm mekan verisi tek dosyada: **`data/cafes.json`**. Kendi veritabanınızı bağlamak için bu dosyayı aynı formatta güncellemeniz yeterli:

```jsonc
{
  "criteria": [
    { "key": "kahve", "label": "Kahve Kalitesi", "icon": "☕", "desc": "..." }
    // kriter ekleyip çıkarabilirsiniz — arayüz otomatik uyum sağlar
  ],
  "cafes": [
    {
      "id": 1,
      "ad": "Mekan Adı",
      "semt": "Kadıköy",
      "fiyat": 2,                    // 1 = ₺, 2 = ₺₺, 3 = ₺₺₺
      "puanlar": { "kahve": 5, "wifi": 4 /* her kriter için 1–5 */ },
      "etiketler": ["Nitelikli kahve"],
      "saat": "08:00 – 23:00",
      "aciklama": "Kısa açıklama."
    }
  ]
}
```

- **Kriterler dinamiktir:** `criteria` listesine yeni bir kriter eklerseniz kaydırıcısı otomatik oluşur; mekanların `puanlar` nesnesine aynı `key` ile puan vermeniz yeterli.
- **Semt filtresi** verideki semtlerden otomatik oluşturulur.

## Puanlama

```
Eşleşme % = Σ(kullanıcı ağırlığı × mekan puanı) / Σ(kullanıcı ağırlığı × 5) × 100
```

Kullanıcı tüm kriterleri "Önemsiz" yaparsa eşit ağırlık varsayılır.

## Dosya Yapısı

```
index.html        → Tek sayfalık arayüz
css/style.css     → Tasarım (kahve temalı)
js/app.js         → Puanlama motoru + arayüz mantığı
data/cafes.json   → Mekan veritabanı (örnek veri)
```
