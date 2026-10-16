"""Turn Dude's A-pose cut-out into a rig: texture, group masks, meshes and bone weights.
usage: build_rig.py cut2.png outdir
Coordinates below are in the original 921x1152 picture.
"""
import sys, os, json, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
from skimage.graph import MCP_Geometric

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
img = np.asarray(Image.open(src)).copy()
A = img[..., 3]
mask = A > 8
H0, W0 = mask.shape

# ---------- bones: name, parent, start, end ----------
BONES = [
    ('root', None, (468, 505), (468, 420)),
    ('spine', 'root', (468, 498), (466, 300)),
    ('neck', 'spine', (466, 300), (465, 238)),
    ('head', 'neck', (465, 238), (465, 110)),
    ('jaw', 'head', (465, 186), (465, 214)),
    ('upperArmL', 'spine', (368, 322), (292, 482)),
    ('foreArmL', 'upperArmL', (292, 482), (234, 600)),
    ('handL', 'foreArmL', (234, 600), (206, 688)),
    ('upperArmR', 'spine', (562, 322), (646, 482)),
    ('foreArmR', 'upperArmR', (646, 482), (707, 600)),
    ('handR', 'foreArmR', (707, 600), (735, 688)),
    ('thighL', 'root', (420, 515), (410, 765)),
    ('shinL', 'thighL', (410, 765), (412, 1000)),
    ('footL', 'shinL', (412, 1000), (352, 1085)),
    ('thighR', 'root', (518, 515), (528, 765)),
    ('shinR', 'thighR', (528, 765), (536, 1000)),
    ('footR', 'shinR', (536, 1000), (594, 1085)),
]
BI = {b[0]: i for i, b in enumerate(BONES)}
GROUPS = ['legL', 'legR', 'torso', 'head', 'armL', 'armR']   # draw order: arms in front, head over the collar

yy, xx = np.mgrid[0:H0, 0:W0]
# ---------- groups ----------
bL = np.where(yy < 472, 362, 345)
bR = np.where(yy < 472, 570, 590)
armL = mask & (xx < bL) & (yy >= 246) & (yy < 720)   # (his hands end above 720; below that it's his shoes)
armR = mask & (xx > bR) & (yy >= 246) & (yy < 720)
head = mask & (yy < 246)
legs = mask & (yy >= 500) & ~armL & ~armR
legL = legs & (xx < 469)
legR = legs & (xx >= 469)
torso = mask & ~head & ~armL & ~armR & ~legs
G = {'legL': legL, 'legR': legR, 'torso': torso, 'head': head, 'armL': armL, 'armR': armR}

# ---------- bone regions (where each bone is fully in charge) ----------
def seg_dist(px, py, a, b):
    ax, ay = a; bx, by = b; dx, dy = bx - ax, by - ay
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1)
    return np.hypot(px - (ax + t * dx), py - (ay + t * dy))
region = {}
region['spine'] = torso
face_low = head & (yy >= 187) & (yy < 222) & (xx > 432) & (xx < 498)
region['jaw'] = face_low
region['neck'] = head & (yy >= 222)
region['head'] = head & ~face_low & (yy < 222)
for side, grp in (('L', armL), ('R', armR)):
    names = [f'upperArm{side}', f'foreArm{side}', f'hand{side}']
    d = np.stack([seg_dist(xx, yy, BONES[BI[n]][2], BONES[BI[n]][3]) for n in names])
    near = d.argmin(0)
    for k, n in enumerate(names): region[n] = grp & (near == k)
for side, grp in (('L', legL), ('R', legR)):
    names = [f'thigh{side}', f'shin{side}', f'foot{side}']
    d = np.stack([seg_dist(xx, yy, BONES[BI[n]][2], BONES[BI[n]][3]) for n in names])
    near = d.argmin(0)
    for k, n in enumerate(names): region[n] = grp & (near == k)

# ---------- smooth weights: geodesic distance (through Dude, not across gaps) to each bone's region ----------
SIG = {'default': 16.0, 'jaw': 5.0, 'head': 10.0, 'neck': 12.0}
walk = nd.binary_dilation(mask, iterations=3)
cost = np.where(walk, 1.0, -1.0)   # negative = can't pass
Wt = np.zeros((len(BONES), H0, W0), np.float32)
for name, R in region.items():
    if not R.any(): print('empty region', name); continue
    sig = SIG.get(name, SIG['default'])
    m = MCP_Geometric(cost)
    starts = np.argwhere(R)
    dist, _ = m.find_costs(starts)
    dist = np.where(np.isfinite(dist), dist, 1e9)
    Wt[BI[name]] = np.exp(-(dist ** 2) / (2 * sig * sig))
tot = Wt.sum(0)
tot[tot == 0] = 1
Wt /= tot

# his big t-shirt sleeves: they stretch between his body and his arm (like cloth), instead of swinging stiffly with the arm
rgb = img[..., :3].astype(np.int32)
cream = (rgb[..., 0] > 140) & (rgb[..., 1] > 125) & (rgb[..., 2] > 95) & (rgb[..., 0] - rgb[..., 2] < 75)
for side, grp in (('L', armL), ('R', armR)):
    ub = BONES[BI[f'upperArm{side}']]; (ax, ay), (bx, by) = ub[2], ub[3]
    proj = ((xx - ax) * (bx - ax) + (yy - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)
    sleeve = grp & (yy < 480)
    sleeve = nd.binary_closing(sleeve & nd.binary_opening(cream, iterations=1), iterations=3) & grp
    t = np.clip((proj + .1) / .85, 0, 1); wa = .12 + .88 * (t * t * (3 - 2 * t))
    # soften the line where the sleeve ends and his arm starts
    wa = np.where(sleeve, wa, 1.0)
    wa = nd.gaussian_filter(np.where(grp, wa, 1.0), 2.0)
    sel = grp & (yy < 500)
    other = Wt[:, sel].copy()
    keep = other * wa[sel]   # the arm's own weights, scaled
    keep[BI['spine']] += (1 - wa[sel])
    Wt[:, sel] = keep / keep.sum(0, keepdims=True)

# ---------- crop ----------
ys, xs = np.where(mask)
M = 18
x0, y0, x1, y1 = int(max(0, xs.min() - M)), int(max(0, ys.min() - M)), int(min(W0, xs.max() + M + 1)), int(min(H0, ys.max() + M + 1))
cw, ch = x1 - x0, y1 - y0
tex = img[y0:y1, x0:x1]
# a little dark mouth sprite in the corner of the texture (shown when his jaw opens)
tex = tex.copy()
MW, MH = 28, 16
mouth = Image.new('RGBA', (MW, MH), (0, 0, 0, 0)); d = ImageDraw.Draw(mouth)
d.ellipse((1, 1, MW - 2, MH - 2), fill=(38, 14, 16, 255))
d.ellipse((6, MH - 6, MW - 7, MH - 2), fill=(120, 50, 55, 255))   # a hint of tongue
mx, my = 2, 2   # top-left corner (empty there)
assert tex[my:my + MH, mx:mx + MW, 3].max() == 0, 'mouth spot not empty'
tex[my:my + MH, mx:mx + MW] = np.asarray(mouth)
Image.fromarray(tex, 'RGBA').save(os.path.join(out, 'rig.png'))

# group bit masks (each group dilated a little, so neighbouring groups overlap by 2 px: no hairline cracks)
bits = np.zeros((ch, cw), np.uint8)
for gi, g in enumerate(GROUPS):
    gm = nd.binary_dilation(G[g], iterations=2)[y0:y1, x0:x1]
    bits |= (gm.astype(np.uint8) << gi)
bits[my:my + MH, mx:mx + MW] |= (1 << GROUPS.index('head'))
Image.fromarray(bits * 4, 'L').save(os.path.join(out, 'rig-groups.png'))   # x4 so the values survive any scaling; shader divides

# ---------- meshes ----------
STEP = 6
def top4(px, py):
    w = Wt[:, py, px]
    idx = np.argsort(-w)[:4]
    ww = w[idx]; keep = ww > .01
    idx, ww = idx[keep], ww[keep]
    ww = ww / ww.sum()
    return [[int(i), round(float(v), 4)] for i, v in zip(idx, ww)]
meshes = []
for g in GROUPS:
    gmask = G[g]
    gd = nd.binary_dilation(gmask, iterations=2)
    _, (iy, ix) = nd.distance_transform_edt(~gmask, return_indices=True)
    gx0, gy0 = (x0 // STEP) * STEP, (y0 // STEP) * STEP
    vid = {}; verts = []; weights = []; tris = []
    def V(px, py):
        k = (px, py)
        if k not in vid:
            cx, cy = min(max(px, 0), W0 - 1), min(max(py, 0), H0 - 1)
            qy, qx = iy[cy, cx], ix[cy, cx]   # the nearest pixel of this group decides how this point moves
            vid[k] = len(verts); verts.append((int(px - x0), int(py - y0))); weights.append(top4(qx, qy))
        return vid[k]
    for cy in range(gy0, y1, STEP):
        for cx in range(gx0, x1, STEP):
            blk = gd[cy:cy + STEP, cx:cx + STEP]
            if not blk.any(): continue
            a, b, c, d2 = V(cx, cy), V(cx + STEP, cy), V(cx + STEP, cy + STEP), V(cx, cy + STEP)
            tris += [a, b, c, a, c, d2]
    meshes.append({'group': g, 'verts': [round(v, 1) for p in verts for v in p], 'tris': tris, 'w': weights})
    print(g, len(verts), 'verts', len(tris) // 3, 'tris')

bones = []
for name, parent, a, b in BONES:
    bones.append({'name': name, 'parent': parent, 'x': a[0] - x0, 'y': a[1] - y0, 'x2': b[0] - x0, 'y2': b[1] - y0})
rig = {'w': cw, 'h': ch, 'groups': GROUPS, 'bones': bones, 'meshes': meshes,
       'mouth': {'u': mx, 'v': my, 'w': MW, 'h': MH, 'x': int(463 - x0), 'y': float(186.5 - y0)},
       'feet': int(ys.max() - y0), 'origin': [x0, y0]}
json.dump(rig, open(os.path.join(out, 'rig.json'), 'w'), separators=(',', ':'))
print('crop', x0, y0, x1, y1, 'size', cw, ch, 'json', os.path.getsize(os.path.join(out, 'rig.json')) // 1024, 'KB')

# a picture of the regions and bones, to check
vis = np.zeros((H0, W0, 3), np.uint8)
pal = np.random.RandomState(3).randint(60, 255, (len(BONES), 3))
dom = Wt.argmax(0)
for i in range(len(BONES)): vis[(dom == i) & mask] = pal[i]
v = Image.fromarray(vis); dr = ImageDraw.Draw(v)
for name, parent, a, b in BONES: dr.line([a, b], fill=(255, 255, 255), width=3); dr.ellipse((a[0] - 5, a[1] - 5, a[0] + 5, a[1] + 5), outline=(0, 0, 0), width=2)
v.crop((x0, y0, x1, y1)).save(os.path.join(out, 'check_regions.png'))
