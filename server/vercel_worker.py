"""Bounded public-media import worker for Vercel's Python runtime.

Supabase is accessed only with the signed-in owner's token. Source downloads use
separate, DNS-pinned connections and never receive that token or source cookies.
"""
import ipaddress
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import uuid
from urllib.parse import urljoin, urlsplit, urlunsplit, quote

import certifi
import filetype
import requests
import urllib3
from bs4 import BeautifulSoup

LIMIT = 40
MAX_SECONDS = 235


def public_url(value):
    if not isinstance(value, str):
        raise ValueError("Use a public website or media link.")
    parts = urlsplit(value)
    if parts.scheme not in ("https", "http") or not parts.hostname or parts.username or parts.password or (parts.port and parts.port not in (80, 443)):
        raise ValueError("Only public HTTP/HTTPS links without credentials are supported.")
    return parts


def public_fetch(value, max_bytes, deadline):
    """Resolve and validate every redirect, then connect to the validated IP."""
    for _ in range(6):
        if time.monotonic() > deadline - 20:
            raise TimeoutError("The import is taking too long. Retry to collect missing slides.")
        parts = public_url(value)
        addresses = socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80), type=socket.SOCK_STREAM)
        ips = list(dict.fromkeys(address[4][0] for address in addresses))
        if not ips or any(not ipaddress.ip_address(address).is_global or (getattr(ipaddress.ip_address(address), "ipv4_mapped", None) and not ipaddress.ip_address(address).ipv4_mapped.is_global) for address in ips):
            raise ValueError("Only public internet sources can be imported.")
        ip = next((address for address in ips if ":" not in address), ips[0])
        options = {"host": ip, "port": parts.port or (443 if parts.scheme == "https" else 80), "timeout": urllib3.Timeout(connect=10, read=15), "retries": False}
        if parts.scheme == "https":
            pool = urllib3.HTTPSConnectionPool(**options, server_hostname=parts.hostname, assert_hostname=parts.hostname, cert_reqs="CERT_REQUIRED", ca_certs=certifi.where())
        else:
            pool = urllib3.HTTPConnectionPool(**options)
        response = None
        try:
            target = urlunsplit(("", "", parts.path or "/", parts.query, ""))
            response = pool.urlopen("GET", target, headers={"Host": parts.netloc, "User-Agent": "Mozilla/5.0 (compatible; Gather/0.1)", "Accept-Encoding": "identity"}, redirect=False, preload_content=False)
            if response.status in (301, 302, 303, 307, 308):
                if not response.headers.get("Location"):
                    raise ValueError("Invalid source redirect.")
                value = urljoin(value, response.headers["Location"])
                continue
            if not 200 <= response.status < 300:
                raise ValueError("The source blocked public access or requires signing in.")
            if int(response.headers.get("Content-Length", 0)) > max_bytes:
                raise ValueError("Source media exceeds your upload size limit.")
            body = bytearray()
            while True:
                if time.monotonic() > deadline - 5:
                    raise TimeoutError("The import is taking too long. Retry to collect missing slides.")
                chunk = response.read(min(65536, max_bytes + 1 - len(body)))
                if not chunk:
                    break
                body.extend(chunk)
                if len(body) > max_bytes:
                    raise ValueError("Source media exceeds your upload size limit.")
            return bytes(body), response.headers.get("Content-Type", ""), value
        finally:
            if response is not None:
                response.close()
            pool.close()
    raise ValueError("Too many source redirects.")


def normalize_extractor(data, source):
    if isinstance(data, dict) and "gather_media" in data:
        slides = [s for s in data["gather_media"] if s.get("url")]
        expected = data.get("expected_count", len(data["gather_media"]))
        return slides[:LIMIT], expected, len(slides) != expected or expected > LIMIT
    if isinstance(data, list):
        slides = [{"url": e[1], "key": source.split("?")[0] + "#slide-" + str(i + 1)} for i, e in enumerate(e for e in data if e and e[0] == 3 and len(e) > 1)]
        return slides[:LIMIT], len(slides), len(slides) >= LIMIT
    slides = []
    entries = data.get("entries") or [data]
    for entry in entries:
        if not entry:
            continue
        formats = [f for f in entry.get("formats", []) if f.get("url", "").startswith("http") and f.get("vcodec") != "none" and f.get("acodec") != "none" and not any(p in f.get("protocol", "") for p in ("dash", "m3u8"))]
        selected = next(reversed(formats), {}).get("url") or (entry.get("url") if "formats" not in entry else None)
        if selected:
            slides.append({"url": selected, "key": source.split("?")[0] + "#" + str(entry.get("id") or len(slides) + 1)})
    expected = data.get("playlist_count") or len(entries)
    return slides[:LIMIT], expected, len(slides) != expected or expected > LIMIT


def page_slides(html, base):
    soup = BeautifulSoup(html, "html.parser")
    slides, seen = [], set()

    def add(value, kind="image"):
        if not isinstance(value, str) or not value.strip():
            return
        link = urljoin(base, value)
        try:
            public_url(link)
        except ValueError:
            return
        if link not in seen:
            seen.add(link)
            slides.append({"url": link, "key": link, "kind": kind})

    def nodes(parent):
        for node in parent.select("img,video"):
            if node.name == "video":
                source = node.find("source")
                add(node.get("src") or (source.get("src") if source else None), "video")
            else:
                srcset = node.get("data-srcset") or node.get("srcset")
                if srcset:
                    candidates = [c.strip().split() for c in srcset.split(",") if c.strip()]
                    def size(candidate):
                        try:
                            return float(candidate[1].rstrip("wx"))
                        except (IndexError, ValueError):
                            return 0
                    add(max(candidates, key=size)[0] if candidates else None)
                else:
                    add(node.get("data-src") or node.get("data-lazy-src") or node.get("data-original") or node.get("src"))

    for gallery in soup.select('[aria-roledescription="carousel"],[data-carousel],.carousel,.swiper,.swiper-container,.splide,.slick-slider,.image-gallery,.gallery'):
        if not slides:
            nodes(gallery)
    if len(slides) > 1:
        return slides[:LIMIT], len(slides), len(slides) > LIMIT
    slides.clear()
    seen.clear()

    def images(value):
        if isinstance(value, str):
            add(value)
        elif isinstance(value, list):
            for entry in value:
                images(entry)
        elif isinstance(value, dict):
            if value.get("contentUrl") or value.get("url"):
                add(value.get("contentUrl") or value.get("url"), "video" if "VideoObject" in str(value.get("@type")) else "image")
            elif value.get("item"):
                images(value["item"])

    def structured(value):
        if isinstance(value, list):
            for entry in value:
                structured(entry)
        elif isinstance(value, dict):
            if value.get("@graph"):
                structured(value["@graph"])
            if isinstance(value.get("image"), list) and len(value["image"]) > 1:
                images(value["image"])
            if any(kind in str(value.get("@type")) for kind in ("ImageGallery", "MediaGallery", "ItemList")):
                entries = value.get("itemListElement") or value.get("associatedMedia") or value.get("hasPart") or value.get("image")
                if isinstance(entries, list):
                    images(sorted(entries, key=lambda e: e.get("position", 0) if isinstance(e, dict) else 0))

    for script in soup.select('script[type="application/ld+json"]'):
        try:
            structured(json.loads(script.string or script.get_text()))
        except (ValueError, TypeError):
            pass
    if len(slides) > 1:
        return slides[:LIMIT], len(slides), len(slides) > LIMIT
    for parent in soup.select("main,article"):
        nodes(parent)
    for meta in soup.select('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:image"],meta[property="og:image:secure_url"],meta[name="twitter:image"]'):
        add(meta.get("content"), "video" if "video" in meta.get("property", "") else "image")
    return slides[:LIMIT], len(slides), True


def discover(source, max_bytes, deadline):
    host = public_url(source).hostname.lower()
    instagram = host == "instagram.com" or host.endswith(".instagram.com")
    facebook = host in ("facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch")
    pinterest = host in ("pinterest.com", "www.pinterest.com", "pin.it")
    source_path = urlsplit(source).path
    if instagram and not source_path.startswith(("/p/", "/reel/", "/reels/", "/tv/")):
        raise ValueError("Use a link to one Instagram post or reel.")
    if pinterest and host != "pin.it" and not source_path.startswith("/pin/"):
        raise ValueError("Use a link to one Pinterest pin.")
    if facebook and not any(part in source_path for part in ("/reel/", "/watch", "/photo", "/videos/", "/posts/", "/share/", "story.php", "permalink.php")) and host != "fb.watch":
        raise ValueError("Use a link to one Facebook post, image, or video.")
    if instagram or facebook or pinterest:
        for mode in (["instagram", "gallery", "video"] if instagram else ["gallery", "video"]):
            remaining = min(70, int(deadline - time.monotonic() - 25))
            if remaining < 5:
                break
            try:
                output = subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name("extract.py")), source, mode], capture_output=True, text=True, encoding="utf-8", timeout=remaining)
                data = json.loads(output.stdout)
                if isinstance(data, dict) and data.get("error"):
                    continue
                found = normalize_extractor(data, source)
                if found[0]:
                    return (*found, None)
            except (subprocess.TimeoutExpired, ValueError, OSError):
                pass
    body, mime, final_url = public_fetch(source, max_bytes, deadline)
    if mime.startswith(("image/", "video/")):
        return [{"url": source, "key": source}], 1, False, body
    if len(body) > 5 * 1024 * 1024:
        raise ValueError("This page is too large to inspect.")
    return (*page_slides(body.decode("utf-8", errors="replace"), final_url), None)


class Cloud:
    def __init__(self, token, deadline=None):
        self.deadline = deadline or time.monotonic() + MAX_SECONDS
        self.base = os.environ["SUPABASE_URL"].rstrip("/")
        self.bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "gather-media")
        self.headers = {"apikey": os.environ["SUPABASE_PUBLISHABLE_KEY"], "Authorization": "Bearer " + token}
        user = self.request("GET", "/auth/v1/user")
        if user.get("email", "").lower() != os.environ["GATHER_OWNER_EMAIL"].lower():
            raise PermissionError("Only the configured Gather owner may import media.")
        self.owner = user["id"]
        if not self.select("gather_owner", "user_id=eq." + self.owner):
            raise PermissionError("Gather owner setup is incomplete.")

    def request(self, method, endpoint, body=None, data=None, mime=None):
        remaining = self.deadline - time.monotonic()
        if remaining < 2:
            raise TimeoutError('The import is taking too long. Retry to collect missing slides.')
        headers = {**self.headers, "Content-Type": mime or "application/json"}
        if data is not None and method == 'POST' and endpoint.startswith('/storage/v1/object/'):
            headers['x-upsert'] = 'true'
        response = requests.request(method, self.base + endpoint, headers=headers, json=body if data is None else None, data=data, timeout=(min(10, remaining), min(20, remaining)))
        if response.status_code in (401, 403):
            raise PermissionError("Sign in again before retrying this import.")
        if not response.ok:
            raise ValueError("Private storage or database could not complete this import.")
        return response.json() if response.content else None

    def rpc(self, name, body):
        return self.request("POST", "/rest/v1/rpc/" + name, body)

    def select(self, table, query):
        return self.request("GET", "/rest/v1/" + table + "?select=*&" + query)

    def patch(self, item, lease, body):
        self.request("PATCH", "/rest/v1/gather_items?id=eq." + item + "&import_lease_id=eq." + lease, body)


def run_import(token, item_id, lease_id):
    deadline = time.monotonic() + MAX_SECONDS
    uuid.UUID(item_id)
    uuid.UUID(lease_id)
    cloud = Cloud(token, deadline)
    source = cloud.rpc("gather_start_import", {"p_item_id": item_id, "p_lease_id": lease_id})
    if not source:
        return {"ok": True, "alreadyStarted": True}
    max_bytes = min(150, max(1, int(os.getenv("GATHER_MAX_FILE_MB", "50")))) * 1024 * 1024
    saved, failed, imported = 0, 0, []
    try:
        slides, expected, uncertain, direct = discover(source, max_bytes, deadline)
        if not slides:
            raise ValueError("No downloadable public media was found. Your link is saved; attach files manually.")
        assets = cloud.select("gather_assets", "item_id=eq." + item_id)
        for position, slide in enumerate(slides):
            if time.monotonic() > deadline - 30:
                failed += len(slides) - position
                break
            existing = next((a for a in assets if (a.get("source_key") and a["source_key"] == slide["key"]) or a.get("source") == slide["url"]), None)
            if existing:
                imported.append(existing["id"])
                saved += 1
                continue
            try:
                body = direct if direct is not None else public_fetch(slide["url"], max_bytes, deadline)[0]
                kind = filetype.guess(body)
                if not kind or not kind.mime.startswith(("image/", "video/")) or len(body) > max_bytes:
                    raise ValueError("Unsupported media format or file size.")
                asset_id = str(uuid.uuid5(uuid.UUID(item_id), slide["key"]))
                filename = cloud.owner + "/" + item_id + "/" + asset_id + "." + kind.extension
                cloud.request("POST", "/storage/v1/object/" + quote(cloud.bucket, safe="") + "/" + quote(filename, safe="/"), data=body, mime=kind.mime)
                next_position = max((a["position"] for a in assets), default=-1) + 1
                record = {"id": asset_id, "item_id": item_id, "filename": filename, "mime": kind.mime, "original_name": "Slide " + str(position + 1), "source": slide["url"], "source_key": slide["key"], "position": next_position, "size": len(body)}
                cloud.request("POST", "/rest/v1/gather_assets", record)
                assets.append(record)
                imported.append(asset_id)
                saved += 1
            except (ValueError, requests.RequestException, urllib3.exceptions.HTTPError, TimeoutError):
                failed += 1
        partial = failed > 0 or uncertain or saved != expected
        if saved and not partial:
            obsolete = [a for a in assets if a.get("source") and a["id"] not in imported]
            for asset in obsolete:
                cloud.request("DELETE", "/rest/v1/gather_assets?id=eq." + asset["id"])
            ordered = imported + [a["id"] for a in assets if not a.get("source") and a["id"] not in imported]
            cloud.rpc("gather_order_assets", {"p_item_id": item_id, "p_ids": ordered})
            assets = [next(a for a in assets if a["id"] == key) for key in ordered]
        kind = "carousel" if len(assets) > 1 else "video" if assets and assets[0]["mime"].startswith("video/") else "image" if assets else "link"
        cloud.patch(item_id, lease_id, {"kind": kind, "import_status": ("partial" if partial else "complete") if saved else "failed", "import_message": (str(saved) + " files stored privately." + (" Check the source for missing slides; retry or attach missing files." if partial else "")) if saved else "The source did not provide downloadable public media. Your link is saved."})
        return {"ok": True, "saved": saved, "partial": partial}
    except Exception as error:
        cloud.deadline = time.monotonic() + 10
        cloud.patch(item_id, lease_id, {"import_status": "failed", "import_message": str(error)[:300] or "Import interrupted. Retry to collect missing slides."})
        return {"ok": False, "saved": saved}
