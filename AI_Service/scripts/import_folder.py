"""Convenience script to enqueue ONE IMAGE PER FILE using local API."""
import argparse
from pathlib import Path
import httpx


def main():
    p = argparse.ArgumentParser(description='Upload image files to local cutout API')
    p.add_argument('folder', type=Path)
    p.add_argument('--url', default='http://127.0.0.1:8000')
    args = p.parse_args()
    accepted = {'.jpg','.jpeg','.png','.webp'}
    paths = sorted(x for x in args.folder.iterdir() if x.is_file() and x.suffix.lower() in accepted)
    with httpx.Client(base_url=args.url, timeout=60) as client:
        for path in paths:
            with path.open('rb') as f:
                resp = client.post('/v1/items', files={'file': (path.name, f, 'application/octet-stream')})
            resp.raise_for_status()
            item = resp.json()
            print(path.name, item['id'], item['status'])
    print(f'Uploaded {len(paths)} images. Worker must be running separately.')


if __name__ == '__main__':
    main()
