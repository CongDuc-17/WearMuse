from io import BytesIO
from pathlib import Path
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from wardrobe_seg.api import create_app
from wardrobe_seg.config import Settings
from wardrobe_seg.db import claim_one, fail_or_requeue, get_item
from wardrobe_seg.images import quality_gate, normalize_upload, BadImage
from wardrobe_seg.pipeline import run_one
from wardrobe_seg.segmenter import MockSegmenter


def jpeg_bytes():
    img = Image.new('RGB', (320, 420), (204, 204, 180))
    output = BytesIO()
    img.save(output, format='JPEG')
    return output.getvalue()


@pytest.fixture
def env(tmp_path):
    settings = Settings(data_dir=tmp_path / 'data')
    client = TestClient(create_app(settings))
    return settings, client


def enqueue(client):
    r = client.post('/v1/items', files={'file': ('a.jpg', jpeg_bytes(), 'image/jpeg')})
    assert r.status_code == 202, r.text
    return r.json()


def test_upload_preview_and_cutout_swap(env):
    settings, client = env
    created = enqueue(client)
    iid = created['id']
    assert created['status'] == 'queued'
    assert created['preview_url'] == created['original_url']
    assert client.get(created['original_url']).status_code == 200
    assert client.get(f'/v1/items/{iid}/assets/cutout').status_code == 404
    result = run_one(settings.data_dir / 'jobs.sqlite3', settings, MockSegmenter())
    assert result['status'] == 'ready'
    ready = client.get(f'/v1/items/{iid}').json()
    assert ready['status'] == 'ready'
    assert ready['preview_url'] == ready['cutout_url']
    response = client.get(ready['cutout_url'])
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('image/png')
    with Image.open(BytesIO(response.content)) as image:
        assert image.mode == 'RGBA'
        assert image.getchannel('A').getextrema() == (0, 255)
    assert client.post(f'/v1/items/{iid}/retry').status_code == 200
    assert client.get(f'/v1/items/{iid}').json()['preview_url'] == ready['original_url']
    assert run_one(settings.data_dir / 'jobs.sqlite3', settings, MockSegmenter())['status'] == 'ready'


def test_unsafe_or_invalid_upload(env):
    _, client = env
    assert client.post('/v1/items', files={'file':('bad.txt', b'not an image')}).status_code == 415
    assert client.post('/v1/items', files={'file':('empty.png', b'')}).status_code == 400


def test_quality_gate_rejects_missing_object(env):
    settings, client = env
    iid = enqueue(client)['id']
    class Eraser:
        name='bad'
        def cutout(self, source):
            return Image.new('RGBA', source.size, (0,0,0,0))
    result = run_one(settings.data_dir / 'jobs.sqlite3', settings, Eraser())
    assert result['status']=='needs_review'
    item = client.get(f'/v1/items/{iid}').json()
    assert item['preview_url']==item['original_url']
    assert item['review_url'] is not None
    assert 'foreground_too_small' in item['quality']['reasons']


def test_model_failure_then_retry_then_failure(env):
    settings, client = env
    iid = enqueue(client)['id']
    class Boom:
        name='boom'
        def cutout(self, source):
            raise RuntimeError('simulated')
    assert run_one(settings.data_dir / 'jobs.sqlite3', settings, Boom())['status'] == 'error'
    assert client.get(f'/v1/items/{iid}').json()['status'] == 'queued'
    assert run_one(settings.data_dir / 'jobs.sqlite3', settings, Boom())['status'] == 'error'
    item = client.get(f'/v1/items/{iid}').json()
    assert item['status'] == 'failed'
    assert item['preview_url'] == item['original_url']


def test_claim_unique(env):
    settings, client = env
    enqueue(client)
    dbp = settings.data_dir / 'jobs.sqlite3'
    one = claim_one(dbp)
    assert one is not None and one['status'] == 'processing'
    assert claim_one(dbp) is None


def test_input_size_gate():
    with pytest.raises(BadImage):
        normalize_upload(jpeg_bytes(), max_pixels=100, max_side=512)
