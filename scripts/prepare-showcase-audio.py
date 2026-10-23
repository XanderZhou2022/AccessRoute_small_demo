"""Rebuild the embedded PCM clips from the original prerecorded M4A files.

Requires ffmpeg only when regenerating assets, not when building or presenting.
"""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
source = root / 'frontend/public/showcase/audio'
output = root / 'frontend/src/showcase/audio'
(output / 'clips').mkdir(parents=True, exist_ok=True)
ffmpeg = shutil.which('ffmpeg')
if not ffmpeg:
    raise SystemExit('Install ffmpeg before regenerating the presentation recordings.')
catalog = {}
with tempfile.TemporaryDirectory(prefix='accessroute-audio-') as directory:
    temporary = Path(directory) / 'clip.wav'
    for clip in json.loads((source / 'transcripts.json').read_text())['clips']:
        subprocess.run([
            ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
            '-i', str(source / clip['file']), '-map_metadata', '-1',
            '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
            '-fflags', '+bitexact', '-flags:a', '+bitexact', str(temporary),
        ], check=True)
        data = temporary.read_bytes()
        filename = hashlib.sha256(data).hexdigest()[:20] + '.wav'
        (output / 'clips' / filename).write_bytes(data)
        catalog[f"{clip['case']}-{clip['step']}"] = filename
(output / 'catalog.json').write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + '\n')
for previous in (output / 'clips').glob('*.wav'):
    if re.fullmatch(r'[0-9a-f]{20}\.wav', previous.name) and previous.name not in catalog.values():
        previous.unlink()
print(f'Prepared {len(catalog)} chapters using {len(set(catalog.values()))} unique PCM clips.')
