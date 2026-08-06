#!/usr/bin/env python3
"""
OSM GeoJSON (data/source/export.geojson) → site veritabanı (data/cafes.json)

- İsimsiz mekanlar atlanır (öneri sitesinde işe yaramaz).
- Semt adları normalize edilir (kadıköy → Kadıköy).
- Semti eksik mekanlara, semti bilinen en yakın 5 mekanın çoğunluk semti
  atanır (kNN); bu atamalar "semtTahmini": true ile işaretlenir.
- Nitelikler yes/no/None (bilinmiyor) olarak sadeleştirilir.

Çalıştırma:  python3 scripts/convert.py
"""

import json
import math
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "source" / "export.geojson"
DST = ROOT / "data" / "cafes.json"

KNN_K = 5

# OSM cuisine → Türkçe etiket (en sık geçenler; bilinmeyenler olduğu gibi kalır)
CUISINE_TR = {
    "coffee_shop": "Kahve",
    "coffee": "Kahve",
    "cafe": "Kahve",
    "turkish": "Türk Mutfağı",
    "breakfast": "Kahvaltı",
    "tea": "Çay",
    "sandwich": "Sandviç",
    "cake": "Pasta & Kek",
    "dessert": "Tatlı",
    "regional": "Yöresel",
    "burger": "Burger",
    "kebab": "Kebap",
    "ice_cream": "Dondurma",
    "pasta": "Makarna",
    "chicken": "Tavuk",
    "international": "Dünya Mutfağı",
    "pizza": "Pizza",
    "italian": "İtalyan",
    "juice": "Meyve Suyu",
    "waffle": "Waffle",
    "bubble_tea": "Bubble Tea",
    "donut": "Donut",
    "bakery": "Fırın",
    "crepe": "Krep",
    "brunch": "Brunch",
    "seafood": "Deniz Ürünleri",
    "vegan": "Vegan",
    "vegetarian": "Vejetaryen",
}


def norm_yes_no(v):
    """OSM değerini yes/no/None üçlüsüne indirger."""
    if v is None:
        return None
    v = v.strip().lower()
    if v in ("yes", "wlan", "wired", "only", "designated", "garden", "terrace"):
        return "yes"
    if v in ("no", "none"):
        return "no"
    if v == "limited":
        return "yes"  # sınırlı erişim: var say
    return None


# İstanbul'un resmî 39 ilçesi — her yazım varyantı bunlara eşlenir
DISTRICTS = [
    "Adalar", "Arnavutköy", "Ataşehir", "Avcılar", "Bağcılar", "Bahçelievler",
    "Bakırköy", "Başakşehir", "Bayrampaşa", "Beşiktaş", "Beykoz", "Beylikdüzü",
    "Beyoğlu", "Büyükçekmece", "Çatalca", "Çekmeköy", "Esenler", "Esenyurt",
    "Eyüpsultan", "Fatih", "Gaziosmanpaşa", "Güngören", "Kadıköy", "Kağıthane",
    "Kartal", "Küçükçekmece", "Maltepe", "Pendik", "Sancaktepe", "Sarıyer",
    "Silivri", "Sultanbeyli", "Sultangazi", "Şile", "Şişli", "Tuzla",
    "Ümraniye", "Üsküdar", "Zeytinburnu",
]

_FOLD = str.maketrans("ıöüşçğâî", "iouscgai")


def _fold(s):
    """Türkçe karakterleri sadeleştirip küçük harfe indirger: 'KADIKÖY' → 'kadikoy'"""
    return s.strip().lower().replace("i̇", "i").translate(_FOLD)


_DISTRICT_BY_FOLD = {_fold(d): d for d in DISTRICTS}
# İlçe sanılan semt/eski adlar → gerçek ilçe
_DISTRICT_BY_FOLD.update({
    "eyup": "Eyüpsultan",
    "karakoy": "Beyoğlu",
    "sefakoy": "Küçükçekmece",
    "yakacik": "Kartal",
})


def norm_district(v):
    if not v or not v.strip():
        return None
    folded = _fold(v)
    if folded in _DISTRICT_BY_FOLD:
        return _DISTRICT_BY_FOLD[folded]
    # Listede yoksa olduğu gibi (baş harfi büyük) bırak ve uyar
    print(f"  ! eşleşmeyen ilçe adı: {v!r}")
    return v.strip()


def clean_phone(v):
    if not v:
        return None
    first = re.split(r"[;,]", v)[0].strip()
    return first or None


def instagram(props):
    ig = props.get("contact:instagram")
    if not ig:
        return None
    ig = ig.strip().rstrip("/")
    if ig.startswith("http"):
        return ig
    return "https://www.instagram.com/" + ig.lstrip("@")


def dist2(a, b):
    """Kabaca km² cinsinden uzaklık karesi (sıralama için yeterli)."""
    dlat = (a[1] - b[1]) * 111.0
    dlon = (a[0] - b[0]) * 111.0 * math.cos(math.radians(41.0))
    return dlat * dlat + dlon * dlon


def main():
    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)

    cafes = []
    skipped_unnamed = 0

    for feat in data["features"]:
        p = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        if geom.get("type") != "Point":
            continue
        name = p.get("name") or p.get("name:tr") or p.get("name:en")
        if not name:
            skipped_unnamed += 1
            continue

        lon, lat = geom["coordinates"][:2]

        raw_cuisine = p.get("cuisine") or ""
        mutfak = []
        for c in raw_cuisine.split(";"):
            c = c.strip().lower()
            if not c:
                continue
            label = CUISINE_TR.get(c, c.replace("_", " ").title())
            if label not in mutfak:
                mutfak.append(label)

        smoking = (p.get("smoking") or "").strip().lower()
        sigara_alani = None
        if smoking:
            sigara_alani = "yes" if smoking in ("yes", "outside", "isolated", "separated", "dedicated") else "no"

        cafes.append({
            "id": p.get("@id") or feat.get("id"),
            "ad": name.strip(),
            "semt": norm_district(p.get("addr:district")),
            "mahalle": (p.get("addr:neighbourhood") or "").replace("Mahallesi", "").strip() or None,
            "lat": lat,
            "lon": lon,
            "ozellik": {
                "wifi": norm_yes_no(p.get("internet_access")),
                "disMekan": norm_yes_no(p.get("outdoor_seating")),
                "paket": norm_yes_no(p.get("takeaway")),
                "erisim": norm_yes_no(p.get("wheelchair")),
                "sigara": sigara_alani,
            },
            "mutfak": mutfak,
            "saat": (p.get("opening_hours") or "").strip() or None,
            "tel": clean_phone(p.get("phone") or p.get("contact:phone")),
            "web": (p.get("website") or p.get("contact:website") or "").strip() or None,
            "insta": instagram(p),
        })

    # ---- Eksik semtleri kNN ile tahmin et ----
    labeled = [c for c in cafes if c["semt"]]
    unlabeled = [c for c in cafes if not c["semt"]]
    for c in unlabeled:
        pt = (c["lon"], c["lat"])
        nearest = sorted(labeled, key=lambda l: dist2(pt, (l["lon"], l["lat"])))[:KNN_K]
        votes = Counter(l["semt"] for l in nearest)
        c["semt"] = votes.most_common(1)[0][0]
        c["semtTahmini"] = True

    cafes.sort(key=lambda c: c["ad"].lower())

    out = {
        "meta": {
            "kaynak": "OpenStreetMap (data/source/export.geojson)",
            "toplam": len(cafes),
            "atlananIsimsiz": skipped_unnamed,
            "semtTahminliSayisi": len(unlabeled),
        },
        "cafes": cafes,
    }

    with open(DST, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"✓ {len(cafes)} mekan yazıldı → {DST}")
    print(f"  atlanan (isimsiz): {skipped_unnamed}")
    print(f"  semti kNN ile tahmin edilen: {len(unlabeled)}")
    print("  semt dağılımı (ilk 15):")
    for s, n in Counter(c["semt"] for c in cafes).most_common(15):
        print(f"    {s}: {n}")


if __name__ == "__main__":
    main()
