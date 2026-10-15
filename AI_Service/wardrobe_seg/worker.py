"""GPU worker: python -m wardrobe_seg.worker [--once]"""
from __future__ import annotations
import argparse
import time
from .config import Settings
from .db import init_db, recover_stale
from .pipeline import run_one
from .segmenter import MockSegmenter, RembgSegmenter


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument('--engine', choices=['rembg','mock'], default='rembg')
    p.add_argument('--provider', choices=['cuda','cpu'], default='cuda')
    p.add_argument('--model', default='birefnet-general', choices=[
        'birefnet-general','birefnet-general-lite','isnet-general-use'])
    p.add_argument('--once', action='store_true', help='process at most one queued item')
    p.add_argument('--poll', type=float, default=1.0)
    args = p.parse_args()
    settings = Settings.from_env()
    settings.ensure()
    db_path = settings.data_dir / 'jobs.sqlite3'
    init_db(db_path)
    print(f"[worker] recovered stale jobs: {recover_stale(db_path, settings.stale_seconds)}")
    segmenter = MockSegmenter() if args.engine == 'mock' else RembgSegmenter(
        provider=args.provider, model=args.model)
    print('[worker] engine=', segmenter.name)
    while True:
        result = run_one(db_path, settings, segmenter)
        if result:
            print('[worker]', result, flush=True)
        if args.once:
            break
        if result is None:
            time.sleep(max(0.1, args.poll))


if __name__ == '__main__':
    main()
