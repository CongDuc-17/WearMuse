"""Exercise the FastAPI service over real HTTP, using its MOCK worker.

Run with AI_Service/.venv/Scripts/python.exe; no pytest/httpx or GPU required.
Node.js and installed mobile npm dependencies are required for Expo multipart checks.
All server data is temporary, and the service binds to loopback on a random port.
"""
from __future__ import annotations

import argparse
from contextlib import closing
from io import BytesIO
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from PIL import Image, ImageDraw


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--service-dir', type=Path, default=Path(__file__).resolve().parents[2] / 'AI_Service')
    args = parser.parse_args()
    service_dir = args.service_dir.resolve()
    if not (service_dir / 'wardrobe_seg' / 'api.py').is_file():
        raise RuntimeError('Existing FastAPI source was not found.')
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    hidden = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    with tempfile.TemporaryDirectory(prefix='wearmuse-smoke-') as directory:
        temporary_root = Path(directory).resolve()
        if temporary_root.parent != Path(tempfile.gettempdir()).resolve() or not temporary_root.name.startswith('wearmuse-smoke-'):
            raise RuntimeError('Temporary test directory is outside the intended temporary root.')
        environment = {**os.environ, 'WARDROBE_DATA_DIR': str(Path(directory) / 'data')}
        with (Path(directory) / 'server.log').open('w+', encoding='utf-8') as logs:
            server = subprocess.Popen(
                [sys.executable, '-m', 'uvicorn', 'wardrobe_seg.api:app', '--host', '127.0.0.1', '--port', str(port)],
                cwd=service_dir, env=environment, stdout=logs, stderr=subprocess.STDOUT, **hidden,
            )
            try:
                def request(path: str, data: bytes | None = None, headers: dict | None = None):
                    with urlopen(Request(base + path, data=data, headers=headers or {}), timeout=10) as response:
                        return response.status, response.read(), response.headers

                deadline = time.monotonic() + 20
                while True:
                    try:
                        assert request('/health')[0] == 200
                        break
                    except (OSError, URLError):
                        if server.poll() is not None or time.monotonic() > deadline:
                            logs.seek(0)
                            raise RuntimeError(logs.read())
                        time.sleep(0.1)

                image = Image.new('RGB', (480, 640), '#eee9df')
                draw = ImageDraw.Draw(image)
                draw.polygon([(165, 100), (220, 125), (260, 125), (315, 100), (420, 195), (350, 270), (315, 240), (315, 540), (165, 540), (165, 240), (130, 270), (60, 195)], fill='#46634c')
                encoded = BytesIO()
                image.save(encoded, 'JPEG')
                boundary = 'WearMuseSmokeBoundary'
                def upload(payload: bytes, name: str = 'shirt.jpg', key: str | None = None):
                    multipart = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: image/jpeg\r\n\r\n'.encode()
                                 + payload + f'\r\n--{boundary}--\r\n'.encode())
                    headers = {'Content-Type': f'multipart/form-data; boundary={boundary}'}
                    if key is not None:
                        headers['Idempotency-Key'] = key
                    return request('/v1/items', multipart, headers)

                # Encode one request through the actual app API + Expo SDK multipart
                # serializer. This catches unsupported native FormData parts before HTTP.
                mobile_dir = Path(__file__).resolve().parents[1]
                expo_photo = Path(directory) / 'expo-upload.jpg'
                expo_photo.write_bytes(encoded.getvalue())
                expo_upload = subprocess.run(
                    ['node', str(mobile_dir / 'scripts' / 'expo-upload-smoke.cjs'), base, str(expo_photo)],
                    cwd=mobile_dir, capture_output=True, text=True, timeout=30, **hidden,
                )
                if expo_upload.returncode:
                    raise RuntimeError(expo_upload.stdout + expo_upload.stderr)
                expo_created = json.loads(expo_upload.stdout)
                assert expo_created['status'] == 'queued'
                assert request(expo_created['original_url'])[0] == 200
                created = [expo_created]
                for _ in range(1):
                    status, body, _ = upload(encoded.getvalue())
                    item = json.loads(body)
                    assert status == 202 and item['status'] == 'queued'
                    assert item['preview_url'] == item['original_url'] and item['cutout_url'] is None
                    assert request(item['original_url'])[0] == 200
                    created.append(item)
                assert created[0]['id'] != created[1]['id']
                with closing(sqlite3.connect(Path(directory) / 'data' / 'jobs.sqlite3')) as con:
                    assert con.execute('SELECT COUNT(*) FROM items').fetchone()[0] == 2
                assert len(list((Path(directory) / 'data' / 'originals').glob('*.jpg'))) == 2
                print('PASS real HTTP: lost POST response replays the same job through app API + Expo multipart; legacy upload independent')

                for item in created:
                    result = subprocess.run(
                        [sys.executable, '-m', 'wardrobe_seg.worker', '--engine', 'mock', '--once'],
                        cwd=service_dir, env=environment, capture_output=True, text=True, timeout=30, **hidden,
                    )
                    if result.returncode:
                        raise RuntimeError(result.stdout + result.stderr)
                    ready = json.loads(request(f'/v1/items/{item["id"]}')[1])
                    assert ready['status'] == 'ready' and ready['preview_url'] == ready['cutout_url'], ready
                    _, content, headers = request(ready['cutout_url'])
                    assert headers['Content-Type'].startswith('image/png')
                    with Image.open(BytesIO(content)) as cutout:
                        assert cutout.size == (768, 1024) and cutout.mode == 'RGBA'
                    if ready['thumbnail_url']:
                        with Image.open(BytesIO(request(ready['thumbnail_url'])[1])) as thumbnail:
                            assert thumbnail.size == (384, 512)
                print('PASS real HTTP + MOCK worker: both jobs ready, normalized PNG 768x1024 and optional WebP 384x512')

                replay = json.loads(upload(encoded.getvalue(), key='expo-http-smoke')[1])
                assert replay['id'] == created[0]['id'] and replay['status'] == 'ready' and replay['attempts'] == 1
                other_image = BytesIO()
                Image.new('RGB', (480, 640), '#234567').save(other_image, 'JPEG')
                try:
                    upload(other_image.getvalue(), key='expo-http-smoke')
                    raise AssertionError('Expected idempotency conflict for a different image')
                except HTTPError as error:
                    assert error.code == 409
                assert len(list((Path(directory) / 'data' / 'originals').glob('*.jpg'))) == 2
                print('PASS real HTTP: completed replay keeps the ready result; changed payload 409; no extra original files')

                item_id = created[0]['id']
                retried = json.loads(request(f'/v1/items/{item_id}/retry', b'')[1])
                assert retried['id'] == item_id and retried['status'] == 'queued'
                assert retried['preview_url'] == retried['original_url']
                try:
                    request(f'/v1/items/{item_id}/retry', b'')
                    raise AssertionError('Expected retry conflict')
                except HTTPError as error:
                    assert error.code == 409
                try:
                    upload(b'not an image', 'invalid.jpg')
                    raise AssertionError('Expected invalid image rejection')
                except HTTPError as error:
                    assert error.code == 415
                print('PASS real HTTP: retry preserves ID, duplicate retry 409, invalid image 415')

                high_resolution = image.resize((4032, 3024))
                high_bytes = BytesIO()
                high_resolution.save(high_bytes, 'JPEG')
                try:
                    upload(high_bytes.getvalue(), 'phone-original.jpg')
                    raise AssertionError('Expected pixel-limit rejection before server resizing')
                except HTTPError as error:
                    assert error.code == 415
                high_resolution.thumbnail((1600, 1600))
                compatible = BytesIO()
                high_resolution.save(compatible, 'JPEG', quality=85)
                assert upload(compatible.getvalue(), 'phone-upload.jpg')[0] == 202
                print('PASS real HTTP: 4032x3024 original exceeds pixel limit; <=1600px JPEG derivative is accepted')
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)


if __name__ == '__main__':
    main()
