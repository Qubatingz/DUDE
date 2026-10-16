# Clean edges: a pixel at the edge is a mix of Dude's colour (f, taken from just inside) and the blue background.
# Work out how much of it is Dude (alpha) from that mix, and use Dude's colour for it. No blue rim.
import sys, numpy as np
from PIL import Image
from scipy import ndimage as nd
src = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(np.float32)   # the original picture
keyed = np.asarray(Image.open(sys.argv[2])).copy()                              # the first cut-out
bg = np.array([float(v) for v in sys.argv[4].split(',')], np.float32)
a0 = keyed[..., 3].astype(np.float32) / 255
mask = a0 > .5
core = nd.binary_erosion(mask, iterations=6)
band = nd.binary_dilation(mask, iterations=2) & ~core
_, (iy, ix) = nd.distance_transform_edt(~core, return_indices=True)
f = src[iy, ix]
c = src
fb = f - bg
den = np.maximum((fb * fb).sum(-1), 1)
al = np.clip(((c - bg) * fb).sum(-1) / den, 0, 1)
resid = np.sqrt((((c - bg) - al[..., None] * fb) ** 2).sum(-1))       # how far c is from being a mix of f and blue
mixok = resid < 38
out = keyed.copy().astype(np.float32)
use = band & mixok
out[..., :3][use] = f[use]
out[..., 3][use] = al[use] * 255
# pixels that aren't a simple mix (earrings, glasses...): keep the first cut-out
out[..., 3][core] = np.maximum(out[..., 3][core], 255)
out = out.round().clip(0, 255).astype(np.uint8)
# colour under fully transparent pixels = nearest solid colour (no dark halo when scaled down)
solid = out[..., 3] >= 200
_, (jy, jx) = nd.distance_transform_edt(~solid, return_indices=True)
z = out[..., 3] == 0
out[..., :3][z] = out[jy[z], jx[z], :3]
Image.fromarray(out, 'RGBA').save(sys.argv[3])
print('band', int(band.sum()), 'mixed', int(use.sum()))
