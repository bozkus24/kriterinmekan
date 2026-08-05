#!/usr/bin/env python3
"""
Tek dosyalık sürüm üretir: CSS, JS ve veri tek bir HTML parçasında birleşir.

  python3 scripts/build_single.py [çıktı-yolu] [--full]

Varsayılan çıktı: dist/kriterinmekan-single.html
  --full : tam bir HTML belgesi üretir (doctype/head/body dahil) — kendi
           sunucunuza tek dosya olarak atmak için. Bayraksız hali, gövde
           içeriği + <style>/<script> üretir (Claude Artifact yayını için).
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def build(full: bool) -> str:
    css = (ROOT / "css" / "style.css").read_text(encoding="utf-8")
    js = (ROOT / "js" / "app.js").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    data = json.loads((ROOT / "data" / "cafes.json").read_text(encoding="utf-8"))

    body = html.split("<body>", 1)[1].rsplit("</body>", 1)[0]
    body = body.replace('<script src="js/app.js"></script>', "").strip()

    # "</script>" dizisinin script bloğunu erken kapatmaması için kaçır
    data_js = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    core = (
        "<title>Kriterin Mekan — Kriterine Göre Kafe Bul</title>\n"
        f"<style>\n{css}\n</style>\n"
        f"{body}\n"
        f"<script>window.__CAFE_DATA__ = {data_js};</script>\n"
        f"<script>\n{js}\n</script>\n"
    )

    if not full:
        return core

    head_extra = re.search(r'<meta name="viewport"[^>]*>|', html).group(0)
    favicon = re.search(r'<link rel="icon"[^>]*>', html)
    return (
        '<!DOCTYPE html>\n<html lang="tr">\n<head>\n<meta charset="UTF-8">\n'
        f"{head_extra}\n{favicon.group(0) if favicon else ''}\n</head>\n<body>\n"
        f"{core}\n</body>\n</html>\n"
    )


def main():
    args = [a for a in sys.argv[1:]]
    full = "--full" in args
    args = [a for a in args if a != "--full"]
    out = Path(args[0]) if args else ROOT / "dist" / "kriterinmekan-single.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    content = build(full)
    out.write_text(content, encoding="utf-8")
    print(f"✓ {out} ({len(content.encode()) / 1024:.0f} KB, full={full})")


if __name__ == "__main__":
    main()
