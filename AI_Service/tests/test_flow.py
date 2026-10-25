from io import BytesIO
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from wardrobe_seg.config import Settings
from wardrobe_seg.db import claim_one, fail_or_requeue, get_item, init_db
from wardrobe_seg.images import quality_gate, normalize_upload, BadImage
from wardrobe_seg.pipeline import run_one
from wardrobe_seg.segmenter import MockSegmenter


def jpeg_bytes(color=(204, 204, 180)):
    img = Image.new('RGB', (320, 420), color)
    output = BytesIO()
    img.save(output, format='JPEG')
    return output.getvalue()


@pytest.fixture
def env(tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path / 'data')
    # The API's module-level app must never initialize the user's development database during collection.
    monkeypatch.setenv('WARDROBE_DATA_DIR', str(settings.data_dir))
    from wardrobe_seg.api import create_app
    client = TestClient(create_app(settings))
    return settings, client


def enqueue(client, key=None):
    r = client.post('/v1/items', files={'file': ('a.jpg', jpeg_bytes(), 'image/jpeg')},
                    headers={'Idempotency-Key': key} if key is not None else {})
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


def test_repeated_upload_returns_same_item_and_keeps_one_original(env):
    settings, client = env
    first = enqueue(client, 'local-replay')
    replay = enqueue(client, 'local-replay')
    assert replay['id'] == first['id']
    with closing(sqlite3.connect(settings.data_dir / 'jobs.sqlite3')) as con:
        assert con.execute('SELECT COUNT(*) FROM items').fetchone()[0] == 1
    assert len(list((settings.data_dir / 'originals').glob('*.jpg'))) == 1


def test_same_key_with_different_image_is_conflict_and_preserves_first(env):
    settings, client = env
    first = enqueue(client, 'local-conflict')
    original = client.get(first['original_url']).content
    conflict = client.post('/v1/items', headers={'Idempotency-Key': 'local-conflict'},
                           files={'file': ('other.jpg', jpeg_bytes((10, 20, 30)), 'image/jpeg')})
    assert conflict.status_code == 409
    assert client.get(first['original_url']).content == original
    assert len(list((settings.data_dir / 'originals').glob('*.jpg'))) == 1


def test_different_keys_and_legacy_uploads_remain_independent(env):
    settings, client = env
    items = [enqueue(client, key) for key in ('local-one', 'local-two', None, None)]
    assert len({item['id'] for item in items}) == 4
    assert len(list((settings.data_dir / 'originals').glob('*.jpg'))) == 4


def test_simultaneous_uploads_create_one_job(env):
    settings, client = env
    with ThreadPoolExecutor(max_workers=6) as pool:
        items = list(pool.map(lambda _: enqueue(client, 'local-concurrent'), range(6)))
    assert len({item['id'] for item in items}) == 1
    with closing(sqlite3.connect(settings.data_dir / 'jobs.sqlite3')) as con:
        assert con.execute('SELECT COUNT(*) FROM items').fetchone()[0] == 1
    assert len(list((settings.data_dir / 'originals').glob('*.jpg'))) == 1


def test_replay_after_processing_does_not_queue_another_gpu_job(env):
    settings, client = env
    first = enqueue(client, 'local-processed')
    db = settings.data_dir / 'jobs.sqlite3'
    assert run_one(db, settings, MockSegmenter())['status'] == 'ready'
    replay = enqueue(client, 'local-processed')
    assert replay['id'] == first['id']
    assert replay['status'] == 'ready'
    assert replay['attempts'] == 1
    assert claim_one(db) is None


def test_replay_survives_api_restart(env):
    settings, client = env
    first = enqueue(client, 'local-restart')
    from wardrobe_seg.api import create_app
    restarted = TestClient(create_app(settings))
    assert enqueue(restarted, 'local-restart')['id'] == first['id']


@pytest.mark.parametrize('key', ['', 'bad key', 'bad/key', 'x' * 101])
def test_invalid_idempotency_key_is_rejected_before_creating_files(env, key):
    settings, client = env
    response = client.post('/v1/items', headers={'Idempotency-Key': key},
                           files={'file': ('a.jpg', jpeg_bytes(), 'image/jpeg')})
    assert response.status_code == 422
    assert list((settings.data_dir / 'originals').iterdir()) == []


def test_invalid_image_does_not_reserve_its_key(env):
    _, client = env
    response = client.post('/v1/items', headers={'Idempotency-Key': 'local-bad-image'},
                           files={'file': ('bad.jpg', b'not an image', 'image/jpeg')})
    assert response.status_code == 415
    assert enqueue(client, 'local-bad-image')['status'] == 'queued'


def test_concurrent_schema_upgrade_preserves_legacy_items(env):
    settings, client = env
    legacy = enqueue(client)
    db = settings.data_dir / 'jobs.sqlite3'
    with closing(sqlite3.connect(db)) as con:
        con.execute('DROP INDEX IF EXISTS idx_items_idempotency_key')
        columns = {row[1] for row in con.execute('PRAGMA table_info(items)')}
        for name in ('idempotency_key', 'request_sha256'):
            if name in columns:
                con.execute(f'ALTER TABLE items DROP COLUMN {name}')
        con.commit()
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(init_db, [db, db]))
    init_db(db)
    assert get_item(db, legacy['id'])['original_path']
    assert client.get(legacy['original_url']).status_code == 200
    with closing(sqlite3.connect(db)) as con:
        columns = {row[1] for row in con.execute('PRAGMA table_info(items)')}
        assert {'idempotency_key', 'request_sha256'} <= columns
    first = enqueue(client, 'local-after-upgrade')
    assert enqueue(client, 'local-after-upgrade')['id'] == first['id']


def test_database_failure_cleans_only_the_uncommitted_original(env, monkeypatch):
    settings, client = env
    first = enqueue(client)
    import wardrobe_seg.api as api_module
    def failed_insert(*args, **kwargs):
        raise sqlite3.OperationalError('simulated write failure')
    monkeypatch.setattr(api_module, 'create_item', failed_insert)
    with pytest.raises(sqlite3.OperationalError, match='simulated write failure'):
        enqueue(client, 'local-write-error')
    assert client.get(first['original_url']).status_code == 200
    assert len(list((settings.data_dir / 'originals').glob('*.jpg'))) == 1
