"""Compare an app screenshot with the supplied artwork.

Usage: python3 tools/compare.py <screenshot.png> [reference.png]
Prints how many pixels are identical / nearly identical and writes a
difference heat-map next to the screenshot (<name>-diff.png).
"""
import sys
import numpy as np
from PIL import Image

shot_path = sys.argv[1]
ref_path = sys.argv[2] if len(sys.argv) > 2 else 'docs/reference/1-gameplay-screen.png'
a = np.asarray(Image.open(shot_path).convert('RGB')).astype(int)
b = np.asarray(Image.open(ref_path).convert('RGB')).astype(int)
if a.shape != b.shape:
    sys.exit(f'size mismatch {a.shape} vs {b.shape}')
d = np.abs(a - b).max(axis=2)
n = d.size
print(f'{shot_path}: identical {100 * (d == 0).sum() / n:.2f}%  '
      f'within 2 levels {100 * (d <= 2).sum() / n:.2f}%  '
      f'within 8 levels {100 * (d <= 8).sum() / n:.2f}%  max diff {d.max()}')
heat = np.clip(d * 4, 0, 255).astype(np.uint8)
Image.fromarray(heat).save(shot_path.replace('.png', '-diff.png'))
