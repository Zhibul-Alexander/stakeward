# Crops the top of each variant's landing screenshot (variants-shots/vN/landing-desktop.png) into hub/shots/vN.png.
import pathlib, sys
from PIL import Image
here = pathlib.Path(__file__).parent
shots = here.parent.parent / 'variants-shots'
(here / 'shots').mkdir(exist_ok=True)
for n in range(1, 11):
    src = shots / f'v{n}' / 'landing-desktop.png'
    if not src.exists():
        print('missing', src); continue
    img = Image.open(src).convert('RGB')
    img = img.crop((0, 0, 1280, 800)).resize((640, 400), Image.LANCZOS)
    img.save(here / 'shots' / f'v{n}.png', optimize=True)
    print('ok', n)
