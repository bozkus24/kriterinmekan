#!/usr/bin/env python3
"""
Gösterim amaçlı örnek oylar üretir → data/puanlar.json

Site lansmanından önce arayüzün dolu görünmesi içindir; "demo": true
işareti sayesinde arayüz "örnek veri" rozeti gösterir.

  python3 scripts/gen_demo_votes.py            # örnek oyları üret
  python3 scripts/gen_demo_votes.py --temizle  # tümünü sil (lansman hali)

Deterministiktir (sabit tohum): her çalıştırma aynı çıktıyı verir.
"""

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DST = ROOT / "data" / "puanlar.json"

META_BASE = {
    "aciklama": "Topluluk/kurul puanları. Ziyaretçi oyları tarayıcıda saklanır; buradaki 'oylar' sözlüğü site sahibinin doğruladığı kalıcı oyları tutar ve herkese gösterilir.",
    "sema": "mekanId → oy listesi. Alanlar: genel (1-5), priz/sessiz/calisma ('yes'|'no')",
}

VOTE_RATIO = 0.38      # kafelerin ne kadarı oy alsın
MAX_VOTES = 6


def yes_no(rng, p_yes):
    return "yes" if rng.random() < p_yes else "no"


def main():
    if "--temizle" in sys.argv:
        DST.write_text(
            json.dumps({"meta": META_BASE, "oylar": {}}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print("✓ Örnek oylar temizlendi — puanlar.json boş (lansman hali).")
        return

    cafes = json.loads((ROOT / "data" / "cafes.json").read_text(encoding="utf-8"))["cafes"]
    rng = random.Random(41)  # sabit tohum: tekrarlanabilir çıktı

    oylar = {}
    for c in cafes:
        # Verisi zengin mekanların oy almış olması daha olası (gerçekçi görünüm)
        bilinen = sum(1 for v in c["ozellik"].values() if v is not None)
        p = VOTE_RATIO * (0.55 + 0.15 * bilinen)
        if rng.random() > p:
            continue

        n = rng.randint(1, MAX_VOTES)
        votes = []
        # Mekanın "karakteri": oylar tutarlı olsun diye taban eğilimler
        taban = rng.uniform(3.0, 4.7)
        wifi = c["ozellik"].get("wifi")
        p_priz = 0.75 if wifi == "yes" else 0.45
        p_sessiz = rng.uniform(0.25, 0.75)
        p_calisma = min(0.85, (p_priz + p_sessiz) / 2 + (0.2 if wifi == "yes" else 0))

        for _ in range(n):
            genel = round(min(5, max(1, rng.gauss(taban, 0.7))))
            vote = {"genel": genel}
            # Her oy her niteliği işaretlemez (gerçekte de öyle)
            if rng.random() < 0.7: vote["priz"] = yes_no(rng, p_priz)
            if rng.random() < 0.6: vote["sessiz"] = yes_no(rng, p_sessiz)
            if rng.random() < 0.65: vote["calisma"] = yes_no(rng, p_calisma)
            votes.append(vote)
        oylar[c["id"]] = votes

    out = {"meta": {**META_BASE, "demo": True}, "oylar": oylar}
    DST.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    toplam_oy = sum(len(v) for v in oylar.values())
    print(f"✓ {len(oylar)} mekana toplam {toplam_oy} örnek oy üretildi → {DST}")
    print('  Arayüz "örnek veri" rozeti gösterecek (meta.demo = true).')
    print("  Lansmanda: python3 scripts/gen_demo_votes.py --temizle")


if __name__ == "__main__":
    main()
