"""Evaluate masks heuristically in a folder or zip of existing PNG results.

Usage: python scripts/evaluate_cutouts.py 'results(1).zip' --csv qa.csv
This report is heuristic only; no ground-truth/IoU is inferred.
"""
from __future__ import annotations
import argparse
import csv
from collections import Counter
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
from PIL import Image
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from wardrobe_seg.images import quality_gate


def main():
    p = argparse.ArgumentParser()
    p.add_argument('source', type=Path)
    p.add_argument('--csv', type=Path, default=Path('qa_results.csv'))
    args = p.parse_args()
    items = []
    if args.source.suffix.lower() == '.zip':
        with ZipFile(args.source) as z:
            for name in sorted(z.namelist()):
                if not name.lower().endswith('.png') or '/segmentation/' not in '/' + name:
                    continue
                with Image.open(BytesIO(z.read(name))) as im:
                    items.append((name, quality_gate(im)))
    else:
        for path in sorted(args.source.rglob('*.png')):
            with Image.open(path) as im:
                items.append((str(path), quality_gate(im)))
    args.csv.parent.mkdir(parents=True, exist_ok=True)
    with args.csv.open('w', newline='', encoding='utf-8-sig') as file:
        writer = csv.DictWriter(file, fieldnames=['path','passed','reasons','foreground_fraction','mask_bbox'])
        writer.writeheader()
        for name, q in items:
            writer.writerow({'path': name, 'passed':q['passed'],
                             'reasons': '|'.join(q['reasons']),
                             'foreground_fraction':q['foreground_fraction'],
                             'mask_bbox':q['mask_bbox']})
    print(f"Scanned {len(items)}; flagged {sum(not q['passed'] for _,q in items)}; report: {args.csv}")
    for name, q in items:
        if not q['passed']:
            print(name, q['reasons'], q['foreground_fraction'])


if __name__ == '__main__':
    main()
