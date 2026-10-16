import sys, numpy as np
from PIL import Image
from scipy import ndimage as nd
def key(im, bg):
    a = im.astype(np.float32)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    dom = b - np.maximum(r, g)
    a_dist = np.clip((d - 40) / 45, 0, 1)
    a_blue = 1 - np.clip((dom - 14) / 18, 0, 1)
    al = np.maximum(a_dist, a_blue * (d > 25))
    al = np.minimum(al, np.clip((d - 18) / 20, 0, 1))
    lab, n = nd.label(al > .6)
    if n:
        sizes = nd.sum(np.ones_like(al), lab, range(1, n + 1)); keep = np.isin(lab, 1 + np.where(sizes > sizes.max() * .02)[0])
        keep = nd.binary_dilation(keep, iterations=3); al = al * keep
    al = nd.grey_erosion(al, size=(2, 2)) * .35 + al * .65   # a slight choke
    aa = np.clip(al, 1e-3, 1)[..., None]
    fg = np.clip((a - (1 - aa) * bg) / aa, 0, 255)
    fg[..., 2] = np.minimum(fg[..., 2], np.maximum(fg[..., 0], fg[..., 1]) + 6 + 60 * (al > .97))   # despill the edges only
    out = np.dstack([fg, al * 255]).round().clip(0, 255).astype(np.uint8)
    return out
if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    im = np.asarray(Image.open(src).convert('RGB'))
    h, w, _ = im.shape
    border = np.concatenate([im[:8].reshape(-1, 3), im[-8:].reshape(-1, 3), im[:, :8].reshape(-1, 3), im[:, -8:].reshape(-1, 3)])
    bg = np.median(border, 0)
    out = key(im, bg)
    ys, xs = np.where(out[..., 3] > 10)
    print('bg', bg, 'box', xs.min(), xs.max(), ys.min(), ys.max())
    Image.fromarray(out, 'RGBA').save(dst)
