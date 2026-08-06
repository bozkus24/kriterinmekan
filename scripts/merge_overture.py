#!/usr/bin/env python3
"""
Overture Maps mekan verisini site veritabanına karıştırır.

  data/cafes.json  (OSM tabanlı, convert.py çıktısı)
  data/source/overture_istanbul.parquet  (Overture "places" İstanbul kesiti)
        │  python3 scripts/merge_overture.py
        ▼
  data/cafes.json  (birleşik, sıkıştırılmış kayıtlar)

Adımlar:
1. Overture kayıtlarını filtrele: isimli + güven skoru ≥ ESIK.
2. Overture'un kendi içindeki mükerrerleri ele (aynı ad ~100 m içinde).
3. OSM kayıtlarıyla eşleştir (normalize ad + ≤200 m): eşleşenlerin eksik
   telefon/web/instagram alanlarını Overture'dan tamamla.
4. Eşleşmeyenleri yeni mekan olarak ekle; ilçe: adresteki locality resmî
   ilçeyse o, değilse en yakın 5 OSM komşusunun çoğunluğu (kNN, "*" imli).
5. Tüm kayıtları null alanlar atılarak sıkıştırılmış biçimde yazar
   (arayüz eksik alanı "bilinmiyor" sayar).

Gereksinim: pip install pyarrow
"""

import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent))
from convert import _DISTRICT_BY_FOLD, _fold  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CAFES = ROOT / "data" / "cafes.json"
OVERTURE = ROOT / "data" / "source" / "overture_istanbul.parquet"

ESIK = 0.5          # Overture güven skoru eşiği
ES_MESAFE_M = 200   # OSM eşleştirme yarıçapı
DUP_MESAFE_M = 100  # Overture iç mükerrer yarıçapı

KATEGORI_TR = {
    "coffee_shop": "Kahve",
    "tea_room": "Çay",
    "internet_cafe": "İnternet Kafe",
    "coffee_roaster": "Kahve",
    "bubble_tea_shop": "Bubble Tea",
    "dessert_shop": "Tatlı",
    "cat_cafe": "Kedi Kafe",
}

FOLD_EXTRA = str.maketrans("ıöüşçğâî", "iouscgai")


def norm_name(s):
    s = (s or "").lower().translate(FOLD_EXTRA)
    s = re.sub(r"\b(cafe|café|kafe|coffee|kahve|shop|house|istanbul|the)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def dist_m(lat1, lon1, lat2, lon2):
    dy = (lat1 - lat2) * 111320.0
    dx = (lon1 - lon2) * 111320.0 * math.cos(math.radians(41.0))
    return math.hypot(dx, dy)


def cell(lat, lon):  # ~200 m ızgara hücresi
    return (round(lat / 0.0018), round(lon / 0.0024))


def komsu_hucreler(lat, lon):
    cy, cx = cell(lat, lon)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            yield (cy + dy, cx + dx)


def temiz(v):
    """Bozuk karakterleri ayıkla: U+FFFD, eşsiz vekil (surrogate), kontrol kar."""
    if isinstance(v, str):
        v = "".join(ch for ch in v
                    if ch not in "�"
                    and not 0xD800 <= ord(ch) <= 0xDFFF
                    and (ch in "\n\t" or ord(ch) >= 32))
        return v.strip()
    if isinstance(v, list):
        return [temiz(x) for x in v]
    if isinstance(v, dict):
        return {k: temiz(x) for k, x in v.items()}
    return v


def compact(rec):
    """null/boş alanları at — arayüz eksik alanı 'bilinmiyor' okur."""
    out = {}
    for k, v in rec.items():
        v = temiz(v)
        if v is None or v == [] or v == "":
            continue
        if k == "ozellik":
            v = {a: b for a, b in v.items() if b is not None}
        out[k] = v
    if "ozellik" not in out:
        out["ozellik"] = {}
    return out


def main():
    data = json.loads(CAFES.read_text(encoding="utf-8"))
    osm = data["cafes"]
    ov_raw = pq.read_table(OVERTURE).to_pylist()

    # ---- 1. filtre ----
    ov = [o for o in ov_raw if o["ad"] and (o["guven"] or 0) >= ESIK]

    # ---- 2. Overture iç mükerrer eleme (güveni yüksek olan kalır) ----
    ov.sort(key=lambda o: -(o["guven"] or 0))
    grid_ov = defaultdict(list)
    tekil = []
    for o in ov:
        n = norm_name(o["ad"])
        dup = any(
            norm_name(k["ad"]) == n and dist_m(o["lat"], o["lon"], k["lat"], k["lon"]) <= DUP_MESAFE_M
            for h in komsu_hucreler(o["lat"], o["lon"])
            for k in grid_ov.get(h, [])
        )
        if not dup:
            grid_ov[cell(o["lat"], o["lon"])].append(o)
            tekil.append(o)

    # ---- 3. OSM ile eşleştir ----
    grid_osm = defaultdict(list)
    for c in osm:
        grid_osm[cell(c["lat"], c["lon"])].append(c)

    def osm_esi(o):
        on = norm_name(o["ad"])
        best = None
        for h in komsu_hucreler(o["lat"], o["lon"]):
            for c in grid_osm.get(h, []):
                d = dist_m(o["lat"], o["lon"], c["lat"], c["lon"])
                if d > ES_MESAFE_M:
                    continue
                cn = norm_name(c["ad"])
                ayni = on and cn and (on == cn or (len(on) > 3 and on in cn) or (len(cn) > 3 and cn in on))
                if ayni and (best is None or d < best[1]):
                    best = (c, d)
        return best[0] if best else None

    def ig(o):
        s = o.get("sosyal")
        return s if s and "instagram.com" in s else None

    tel_ekl = web_ekl = 0
    yeni = []
    for o in tekil:
        es = osm_esi(o)
        if es is not None:
            if not es.get("tel") and o.get("tels"):
                es["tel"] = o["tels"][0]
                tel_ekl += 1
            if not es.get("web") and o.get("webs"):
                es["web"] = o["webs"][0]
                web_ekl += 1
            if not es.get("insta") and ig(o):
                es["insta"] = ig(o)
            es["kaynak"] = "osm+ov"
        else:
            yeni.append(o)

    # ---- 4. yeni kayıtlar: ilçe ata ----
    etiketli = [c for c in osm if c.get("semt") and not c.get("semtTahmini")]

    def knn_semt(lat, lon):
        yakin = sorted(etiketli, key=lambda c: (c["lat"] - lat) ** 2 * 2.46 + (c["lon"] - lon) ** 2)[:5]
        return Counter(c["semt"] for c in yakin).most_common(1)[0][0]

    adresten = knndan = 0
    yeni_kayitlar = []
    for o in yeni:
        semt = None
        tahmini = False
        if o.get("adresler"):
            loc = (o["adresler"][0].get("locality") or "").strip()
            semt = _DISTRICT_BY_FOLD.get(_fold(loc)) if loc else None
        if semt:
            adresten += 1
        else:
            semt = knn_semt(o["lat"], o["lon"])
            tahmini = True
            knndan += 1
        kat = KATEGORI_TR.get(o["kategori"])
        yeni_kayitlar.append(compact({
            "id": o["id"],
            "ad": o["ad"].strip(),
            "semt": semt,
            "semtTahmini": tahmini or None,
            "lat": round(o["lat"], 6),
            "lon": round(o["lon"], 6),
            "ozellik": {},
            "mutfak": [kat] if kat else None,
            "tel": (o.get("tels") or [None])[0],
            "web": (o.get("webs") or [None])[0],
            "insta": ig(o),
            "kaynak": "ov",
        }))

    birlesik = [compact({**c, "kaynak": c.get("kaynak", "osm")}) for c in osm] + yeni_kayitlar
    birlesik.sort(key=lambda c: c["ad"].lower())

    data["cafes"] = birlesik
    data["meta"] = {
        **data.get("meta", {}),
        "toplam": len(birlesik),
        "kaynaklar": "OpenStreetMap + Overture Maps (2026-07-22)",
        "overtureEsik": ESIK,
    }
    CAFES.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"✓ birleşik veritabanı: {len(birlesik)} mekan → {CAFES}")
    print(f"  Overture ham: {len(ov_raw)} → eşik({ESIK}) sonrası: {len(ov)} → iç mükerrer sonrası: {len(tekil)}")
    print(f"  OSM ile eşleşip zenginleşen: {len(tekil) - len(yeni)} (+{tel_ekl} tel, +{web_ekl} web)")
    print(f"  yeni eklenen: {len(yeni_kayitlar)} (ilçe adresten: {adresten}, kNN: {knndan})")
    print("  ilçe dağılımı (ilk 12):")
    for s, n in Counter(c["semt"] for c in birlesik).most_common(12):
        print(f"    {s}: {n}")


if __name__ == "__main__":
    main()
