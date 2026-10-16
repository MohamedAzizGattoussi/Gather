import json
import pathlib
import sys
import time
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from server.vercel_worker import public_url, public_fetch, page_slides, normalize_extractor


class ImportWorkerChecks(unittest.TestCase):
    def test_image_carousel_preserves_order(self):
        slides, expected, partial = normalize_extractor({"gather_media": [{"url": "https://cdn.example/" + str(i), "key": str(i), "kind": "image"} for i in range(7)], "expected_count": 7}, "https://instagram.com/p/example/")
        self.assertEqual([s["key"] for s in slides], [str(i) for i in range(7)])
        self.assertEqual(expected, 7)
        self.assertFalse(partial)

    def test_missing_slide_is_partial(self):
        slides, expected, partial = normalize_extractor({"gather_media": [{"url": "https://cdn.example/1", "key": "1"}, {"url": None, "key": "2"}], "expected_count": 2}, "https://instagram.com/p/example/")
        self.assertEqual(len(slides), 1)
        self.assertEqual(expected, 2)
        self.assertTrue(partial)

    def test_website_gallery_over_cover(self):
        slides, expected, partial = page_slides('<meta property="og:image" content="/cover.jpg"><div class="swiper"><img srcset="/small.jpg 300w,/one.jpg 1200w"><img data-src="/two.jpg"><video src="/three.mp4"></video><img src="/two.jpg"></div>', 'https://example.com/post')
        self.assertEqual([s['url'] for s in slides], ['https://example.com/one.jpg','https://example.com/two.jpg','https://example.com/three.mp4'])
        self.assertEqual(expected, 3)
        self.assertFalse(partial)

    def test_structured_gallery(self):
        slides, _, partial = page_slides('<script type="application/ld+json">{"@type":"ImageGallery","image":["/one.jpg","/two.jpg"]}</script>', 'https://example.com/post')
        self.assertEqual(len(slides), 2)
        self.assertFalse(partial)

    def test_only_cover_is_partial(self):
        slides, _, partial = page_slides('<meta property="og:image" content="/cover.jpg">','https://example.com/post')
        self.assertEqual(len(slides),1)
        self.assertTrue(partial)

    def test_invalid_protocol_and_credentials(self):
        for link in ['file:///private','https://user:password@example.com','http://example.com:9999']:
            with self.assertRaises(ValueError):
                public_url(link)

    def test_private_address_is_blocked_before_connect(self):
        with patch('server.vercel_worker.socket.getaddrinfo',return_value=[(None,None,None,None,('127.0.0.1',443))]), patch('server.vercel_worker.urllib3.HTTPSConnectionPool') as pool:
            with self.assertRaises(ValueError):
                public_fetch('https://example.com/private',100,time.monotonic()+60)
            pool.assert_not_called()

    def test_public_download_is_pinned_and_has_no_owner_token(self):
        response=MagicMock(status=200,headers={'Content-Type':'image/png','Content-Length':'3'})
        response.read.side_effect=[b'png',b'']
        pool=MagicMock();pool.urlopen.return_value=response
        with patch('server.vercel_worker.socket.getaddrinfo',return_value=[(None,None,None,None,('93.184.216.34',443))]),patch('server.vercel_worker.urllib3.HTTPSConnectionPool',return_value=pool) as constructor:
            body,_,_=public_fetch('https://example.com/image.png',100,time.monotonic()+60)
        self.assertEqual(body,b'png')
        self.assertEqual(constructor.call_args.kwargs['host'],'93.184.216.34')
        self.assertEqual(constructor.call_args.kwargs['server_hostname'],'example.com')
        headers=pool.urlopen.call_args.kwargs['headers']
        self.assertNotIn('Authorization',headers)
        self.assertNotIn('Cookie',headers)

    def test_redirect_to_private_network_is_blocked(self):
        response=MagicMock(status=302,headers={'Location':'http://127.0.0.1/internal'})
        pool=MagicMock();pool.urlopen.return_value=response
        with patch('server.vercel_worker.socket.getaddrinfo',side_effect=[[(None,None,None,None,('93.184.216.34',443))],[(None,None,None,None,('127.0.0.1',80))]]),patch('server.vercel_worker.urllib3.HTTPSConnectionPool',return_value=pool):
            with self.assertRaises(ValueError):
                public_fetch('https://example.com/redirect',100,time.monotonic()+60)


if __name__=='__main__':
    unittest.main()
