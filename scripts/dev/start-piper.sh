#!/usr/bin/env sh
set -eu

pip install --no-cache-dir 'piper-tts[http]'

mkdir -p /voices

python - <<'PY'
import os
import urllib.request

model_name = 'en_US-lessac-medium.onnx'
files = [model_name, model_name + '.json']
base = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/'

for name in files:
    target = os.path.join('/voices', name)
    if not os.path.exists(target):
        print(f'Downloading {name}...')
        urllib.request.urlretrieve(base + name, target)

print('Voice files ready.')
PY

exec python -m piper.http_server --host 0.0.0.0 --port 5000 --data-dir /voices --model /voices/en_US-lessac-medium.onnx
