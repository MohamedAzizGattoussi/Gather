"""Resolve public social media URLs. Never reads browser cookies or user configs.
Media is downloaded by Gather's bounded, public-network-only Node fetcher.
"""
import json
import subprocess
import sys

url = sys.argv[1]
mode = sys.argv[2]
if mode == "instagram":
    # yt-dlp's normal video processing rejects image-only carousel entries.
    # Read the public product data before that processing and retain image originals.
    try:
        import yt_dlp
        from yt_dlp.extractor.instagram import InstagramIE

        class GatherInstagramIE(InstagramIE):
            def _extract_product_media(self, product):
                info = super()._extract_product_media(product)
                info["gather_media_type"] = product.get("media_type")
                candidates = product.get("image_versions2", {}).get("candidates", [])
                candidates = [c for c in candidates if isinstance(c, dict) and c.get("url")]
                if candidates:
                    best = max(candidates, key=lambda c: (c.get("width") or 0) * (c.get("height") or 0))
                    info["gather_image_url"] = best["url"]
                return info

        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "socket_timeout": 15, "retries": 0, "skip_download": True, "ignore_no_formats_error": True}) as downloader:
            result = GatherInstagramIE(downloader).extract(url)
            entries = result.get("entries") or [result]
            slides = []
            for index, entry in enumerate(entries):
                if entry.get("gather_media_type") == 1:
                    media_url = entry.get("gather_image_url")
                    kind = "image"
                else:
                    formats = [f for f in entry.get("formats", []) if f.get("url", "").startswith("http") and not any(p in f.get("protocol", "") for p in ("dash", "m3u8")) and f.get("acodec") != "none"]
                    best = max(formats, key=lambda f: (f.get("width") or 0) * (f.get("height") or 0), default={})
                    media_url = best.get("url")
                    kind = "video"
                slides.append({"url": media_url, "kind": kind, "key": "instagram:" + str(entry.get("id") or index + 1)})
            print(json.dumps({"gather_media": slides, "expected_count": len(slides)}))
    except Exception:
        print(json.dumps({"error": "The public Instagram carousel could not be resolved."}))
    sys.exit(0)
elif mode == "gallery":
    args = [sys.executable, "-m", "gallery_dl", "--ignore-config", "--dump-json", "--range", "1-40", "--retries", "0", "-o", "timeout=15", url]
else:
    args = [sys.executable, "-m", "yt_dlp", "--ignore-config", "--dump-single-json", "--skip-download", "--no-playlist", "--socket-timeout", "15", "--retries", "0", "--playlist-end", "40", url]
try:
    result = subprocess.run(args, capture_output=True, text=True, timeout=65, encoding="utf-8", errors="replace")
    if result.returncode:
        print(json.dumps({"error": "This source could not be accessed without signing in, or its importer is unavailable."}))
    else:
        print(result.stdout)
except (subprocess.TimeoutExpired, OSError):
    print(json.dumps({"error": "The public source took too long to respond."}))
