"""Decompose the supplied HD GAMEPLAY SCREEN artwork (1024x1536) into game layers.

Every output is cut from the supplied image's own pixels. Nothing is redrawn.

  public/gameplay/plate.png      world background with the moving parts lifted out
                                (the areas behind them restored from this image)
  public/gameplay/flow.png       masks: R waterfalls, G gold rail, B pipe rails
  public/gameplay/boy.png        the boy (character layer)
  public/gameplay/trail.png      the light trail under his skates
  public/gameplay/coin.png       star coin (the nearest painted coin, completed by symmetry)
  public/gameplay/coin_*.png     the painted coins at their painted size
  public/gameplay/block_x.png    red X block        public/gameplay/block_chevron.png  blue chevron block
  public/gameplay/block_far_*.png  the distant blocks as painted
  public/gameplay/ui_*.png       HUD / control artwork (numbers removed; drawn live)
  src/gameplay/layout.json       measured positions, paths and rail model

Run: python3 tools/extract_screen1_hd.py
"""
import json
import os
import cv2
import numpy as np

SRC = 'docs/reference/1-gameplay-screen-hd.png'
OUT = 'public/gameplay'
os.makedirs(OUT, exist_ok=True)

img = cv2.imread(SRC)
H, W = img.shape[:2]
assert (W, H) == (1024, 1536), (W, H)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
HUE = hsv[..., 0] * 2.0
SAT = hsv[..., 1] / 255.0
VAL = hsv[..., 2] / 255.0


def poly(points, shape=(H, W)):
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.array(points, np.int32)], 255)
    return m


def rrect_mask(x0, y0, x1, y1, r, shape=(H, W)):
    m = np.zeros(shape, np.uint8)
    cv2.rectangle(m, (x0 + r, y0), (x1 - r, y1), 255, -1)
    cv2.rectangle(m, (x0, y0 + r), (x1, y1 - r), 255, -1)
    for px, py in [(x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)]:
        cv2.circle(m, (px, py), r, 255, -1, lineType=cv2.LINE_AA)
    return m


def save_rgba(name, bgr, alpha, box):
    x0, y0, x1, y1 = box
    rgba = cv2.cvtColor(bgr[y0:y1, x0:x1], cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha[y0:y1, x0:x1]
    cv2.imwrite(f'{OUT}/{name}', rgba)
    return {'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1 - y0)}


# --------------------------------------------------------------- gold rail model
# Outer edges of the gold rail measured on the artwork (y, x).
LEFT_EDGE = [(580, 440), (600, 440), (700, 435), (800, 415), (900, 395), (1000, 355), (1100, 310), (1200, 265), (1300, 215), (1400, 160), (1500, 105), (1536, 85)]
RIGHT_EDGE = [(580, 482), (600, 505), (700, 530), (800, 548), (900, 585), (1000, 620), (1100, 645), (1200, 670), (1300, 695), (1400, 720), (1500, 740), (1536, 747)]


def edge_fn(points):
    ys = np.array([p[0] for p in points], float)
    xs = np.array([p[1] for p in points], float)
    return lambda y: np.interp(y, ys, xs)


xL = edge_fn(LEFT_EDGE)
xR = edge_fn(RIGHT_EDGE)
rail_band = np.zeros((H, W), bool)
for y in range(575, H):
    a, b = int(np.floor(xL(y))), int(np.ceil(xR(y)))
    rail_band[y, max(0, a):min(W, b + 1)] = True

# ------------------------------------------------------------------------ boy
mask = np.full((H, W), cv2.GC_BGD, np.uint8)
mask[742:1345, 326:792] = cv2.GC_PR_BGD
silhouette = [(500, 760), (560, 746), (640, 758), (674, 800), (668, 862), (646, 892), (700, 932), (742, 972), (762, 1000), (782, 1040),
              (780, 1088), (742, 1088), (702, 1052), (684, 1004), (648, 972), (646, 1062), (632, 1112), (602, 1124), (578, 1172),
              (566, 1232), (560, 1300), (530, 1326), (486, 1332), (452, 1312), (444, 1284), (442, 1252), (438, 1232), (403, 1218), (398, 1180), (418, 1130), (430, 1082),
              (424, 1022), (418, 972), (398, 962), (338, 994), (332, 962), (358, 934), (420, 912), (470, 880), (498, 852)]
cv2.fillPoly(mask, [np.array(silhouette, np.int32)], cv2.GC_PR_FGD)
for c in [
    [(445, 892), (582, 892), (602, 1000), (562, 1060), (470, 1060), (440, 1000)],   # torso + backpack
    [(540, 792), (640, 792), (650, 860), (562, 876)],                                # head
    [(452, 1100), (560, 1110), (545, 1200), (472, 1200)],                            # legs
    [(472, 1182), (556, 1200), (550, 1274), (492, 1270)],                            # right boot
    [(412, 1162), (470, 1162), (462, 1210), (416, 1206)],                            # left boot
    [(454, 1258), (550, 1258), (546, 1314), (470, 1318)],                            # jet nozzle under the right boot
    [(342, 942), (394, 936), (398, 988), (346, 994)],                                # left glove
    [(692, 992), (750, 986), (776, 1062), (702, 1070)],                              # right glove
    [(600, 905), (650, 915), (690, 945), (672, 972), (620, 960)],                    # right sleeve
    [(395, 925), (440, 905), (445, 945), (400, 955)],                                # left sleeve
]:
    cv2.fillPoly(mask, [np.array(c, np.int32)], cv2.GC_FGD)
for c in [
    [(440, 744), (500, 744), (497, 830), (440, 830)],       # coin in front of the hair (left part)
    [(328, 1040), (414, 1040), (404, 1140), (326, 1140)],   # rail left of the legs
    [(642, 1132), (690, 1132), (690, 1250), (626, 1250)],   # rail right of the legs
    [(588, 1118), (645, 1118), (645, 1275), (566, 1275)],   # rail right of the boots
    [(700, 872), (790, 872), (790, 958), (744, 958)],       # sky right of the arm
    [(640, 880), (720, 880), (700, 931), (655, 929)],       # sky above the right sleeve
    [(616, 985), (652, 978), (676, 1005), (680, 1040), (648, 1062), (618, 1050)],  # sky under the right arm
    [(770, 975), (800, 975), (800, 1050), (780, 1046), (768, 1010)],               # sky right of the glove
    [(425, 832), (500, 832), (505, 858), (498, 888), (470, 896), (425, 896)],       # rail beside the head
    [(690, 930), (712, 930), (712, 968), (695, 962)],                               # sky beside the right cuff
]:
    cv2.fillPoly(mask, [np.array(c, np.int32)], cv2.GC_BGD)
bgd = np.zeros((1, 65), np.float64)
fgd = np.zeros((1, 65), np.float64)
cv2.grabCut(img, mask, None, bgd, fgd, 10, cv2.GC_INIT_WITH_MASK)
boy = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
n, lab, stats, _ = cv2.connectedComponentsWithStats(boy)
boy = np.where(lab == 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]), 255, 0).astype(np.uint8)
boy = cv2.morphologyEx(boy, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
# Fill interior pinholes.
cnts, _ = cv2.findContours(boy, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
solid = np.zeros_like(boy)
cv2.drawContours(solid, cnts, -1, 255, -1)
holes_in = cv2.subtract(solid, boy)
small = np.zeros_like(boy)
n2, lab2, st2, _ = cv2.connectedComponentsWithStats(holes_in)
for i in range(1, n2):
    if st2[i, cv2.CC_STAT_AREA] < 120:
        small[lab2 == i] = 255
boy = cv2.bitwise_or(boy, small)
boy_alpha = cv2.GaussianBlur(boy, (3, 3), 0.8)

# ---------------------------------------------------------------------- trail
trail_region = poly([(398, 1182), (470, 1196), (560, 1250), (596, 1300), (600, 1536), (300, 1536), (318, 1352), (350, 1236)])
core = poly([(420, 1200), (540, 1250), (570, 1536), (340, 1536), (370, 1300)]) > 0
cyanish = ((HUE >= 165) & (HUE <= 335) & (SAT > 0.18)) | ((SAT < 0.2) & (VAL > 0.86) & core)
goldish = (HUE >= 12) & (HUE <= 62) & (SAT > 0.3)
tr = np.where(cyanish & ~goldish, 1.0, 0.0).astype(np.float32)
tr = cv2.GaussianBlur(tr, (0, 0), 2.2)
feather = cv2.GaussianBlur(trail_region.astype(np.float32) / 255.0, (0, 0), 10)
trail_alpha = np.clip(tr * 1.25, 0, 1) * feather
trail_alpha[boy > 0] = 0
trail_alpha8 = (trail_alpha * 255).astype(np.uint8)

# ---------------------------------------------------------------------- coins
COINS = [(488.0, 791.0, 47.0), (481.5, 690.0, 32.0), (471.0, 621.5, 21.5), (460.0, 589.0, 12.5), (445.0, 574.0, 9.0)]
coin_hole = np.zeros((H, W), np.uint8)
for cx, cy, r in COINS:
    cv2.circle(coin_hole, (int(round(cx)), int(round(cy))), int(np.ceil(r * 1.14 + 3)), 255, -1)

yy, xx = np.mgrid[0:H, 0:W]

coin_meta = []
for i, (cx, cy, r) in enumerate(COINS):
    R = r * 1.14 + 3
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    a = np.clip((R - d) / max(1.0, R - (r + 1)), 0, 1)
    if i == 0:
        a = a * (1 - boy_alpha.astype(np.float32) / 255.0)  # hair in front of it
    box = (int(np.floor(cx - R - 1)), int(np.floor(cy - R - 1)), int(np.ceil(cx + R + 2)), int(np.ceil(cy + R + 2)))
    save_rgba(f'coin_{i}.png', img, (a * 255).astype(np.uint8), box)
    coin_meta.append({'cx': cx, 'cy': cy, 'r': r, 'x': box[0], 'y': box[1], 'w': box[2] - box[0], 'h': box[3] - box[1]})

# Master coin: the nearest painted coin, its hidden lower-right part completed
# from its own mirror image (the star coin is left/right symmetric).
cx, cy, r = COINS[0]
R = int(np.ceil(r * 1.14 + 3))
x0, y0 = int(round(cx)) - R - 2, int(round(cy)) - R - 2
size = 2 * R + 5
patch = img[y0:y0 + size, x0:x0 + size].copy()
occ = boy[y0:y0 + size, x0:x0 + size] > 0
mirror = patch[:, ::-1]
patch[occ] = mirror[occ]
d = np.sqrt((np.arange(size)[None, :] - (cx - x0)) ** 2 + (np.arange(size)[:, None] - (cy - y0)) ** 2)
a = np.clip((r * 1.14 + 3 - d) / (0.14 * r + 2), 0, 1)
rgba = cv2.cvtColor(patch, cv2.COLOR_BGR2BGRA)
rgba[:, :, 3] = (a * 255).astype(np.uint8)
cv2.imwrite(f'{OUT}/coin.png', rgba)
coin_master = {'w': size, 'h': size, 'cx': cx - x0, 'cy': cy - y0, 'r': r}

# --------------------------------------------------------------------- blocks
def block_sprite(name, box, radius=10):
    x0, y0, x1, y1 = box
    m = cv2.GaussianBlur(rrect_mask(x0, y0, x1, y1, radius), (3, 3), 0.7)
    return save_rgba(name, img, m, (x0 - 1, y0 - 1, x1 + 2, y1 + 2))

BLOCK_X = (180, 582, 336, 706)
BLOCK_C = (670, 614, 842, 776)
FAR_GOLD = (407, 515, 455, 563)      # distant chevron block on the gold rail
FAR_PIPE = (577, 537, 655, 620)      # distant chevron block on the right pipe
block_x = block_sprite('block_x.png', BLOCK_X)
block_c = block_sprite('block_chevron.png', BLOCK_C)
far_gold = block_sprite('block_far_gold.png', FAR_GOLD, 6)
far_pipe = block_sprite('block_far_pipe.png', FAR_PIPE, 7)

# ------------------------------------------------------------------------ HUD
HUD = {
    'badge': (20, 17, 266, 114),
    'score': (20, 132, 250, 316),
    'pause': (905, 17, 1004, 115),
    'time': (802, 132, 1004, 256),
}
ARROWS = {'left': (157, 1318, 115), 'right': (865, 1318, 115)}
hud_hole = np.zeros((H, W), np.uint8)
for (x0, y0, x1, y1) in HUD.values():
    hud_hole |= rrect_mask(x0 - 3, y0 - 3, x1 + 3, y1 + 3, 16)
for cx_, cy_, rr in ARROWS.values():
    cv2.circle(hud_hole, (cx_, cy_), rr + 5, 255, -1)

# ---------------------------------------------------------------------- plate
boy_hole = cv2.dilate(boy, np.ones((7, 7), np.uint8))
trail_hole = cv2.dilate((trail_alpha > 0.02).astype(np.uint8) * 255, np.ones((11, 11), np.uint8))
block_hole = np.zeros((H, W), np.uint8)
# (The painted blocks on the side pipes and in the distance stay in the
#  world exactly as painted; the sprites above are used for gameplay blocks.)
hole = boy_hole | trail_hole | coin_hole | block_hole | hud_hole
known = hole == 0

plate = img.copy().astype(np.float32)
filled = np.zeros((H, W), bool)

# 1) Gold rail. The rail is resampled into "rail space" (rows = y, columns =
#    position across the rail from its left to its right edge), where its
#    lengthwise streaks become vertical columns. Covered parts are rebuilt by
#    reflecting the visible rail of the same row across the covered span,
#    smoothed along the streaks, and mapped back into the picture.
N = 512
rows = np.arange(575, H)
map_x = np.zeros((len(rows), N), np.float32)
map_y = np.zeros((len(rows), N), np.float32)
for i, y in enumerate(rows):
    l, r_ = xL(y), xR(y)
    map_x[i] = l + (np.arange(N) + 0.5) / N * (r_ - l)
    map_y[i] = y
rect = cv2.remap(img, map_x, map_y, cv2.INTER_LINEAR).astype(np.float32)
rhole = cv2.remap(hole, map_x, map_y, cv2.INTER_NEAREST) > 0
rfill = rect.copy()
done = np.zeros(rhole.shape, bool)
R_ROWS = len(rows)

# (a) Short covered runs (e.g. between the coins): bridge them along the
#     streak, i.e. vertically in rail space.
for j in range(N):
    col = rhole[:, j]
    if not col.any():
        continue
    i = 0
    while i < R_ROWS:
        if not col[i]:
            i += 1
            continue
        i0 = i
        while i < R_ROWS and col[i]:
            i += 1
        top, bot = i0 - 1, i
        if top >= 0 and bot < R_ROWS and (bot - top) <= 90:
            t = ((np.arange(i0, bot) - top) / (bot - top))[:, None]
            rfill[i0:bot, j] = rect[top, j] * (1 - t) + rect[bot, j] * t
            done[i0:bot, j] = True

# (b) Long covered stretches (under the boy and his light trail): a clean
#     rail surface - the rail's colour across its width, averaged along the
#     streaks (vertically here), smoothed, plus fine lengthwise streaks.
vis = (~rhole).astype(np.float32)
num = cv2.GaussianBlur(rect * vis[..., None], (1, 0), sigmaX=0.1, sigmaY=50)
den = cv2.GaussianBlur(vis, (1, 0), sigmaX=0.1, sigmaY=50)
prof = np.zeros_like(rect)
for i in range(R_ROWS):
    have = den[i] > 0.05
    if have.sum() < 4:
        continue
    js = np.where(have)[0]
    vals = num[i][have] / den[i][have][:, None]
    for c in range(3):
        prof[i, :, c] = np.interp(np.arange(N), js, vals[:, c])
prof = cv2.GaussianBlur(prof, (0, 0), sigmaX=6, sigmaY=30)
rng = np.random.default_rng(7)
streak = rng.normal(0, 1, (1, N)).astype(np.float32)
streak = cv2.GaussianBlur(streak, (0, 0), sigmaX=1.2, sigmaY=0.1)
streak_amp = 1 + 0.07 * streak / (np.abs(streak).max() + 1e-6)
wave = 1 + 0.03 * np.sin(np.arange(R_ROWS)[:, None] / 37.0 + np.arange(N)[None, :] / 9.0)
texture = np.clip(prof * (streak_amp * wave)[..., None], 0, 255)
# The rail's core glows white-gold (as painted on the visible far rail).
u = (np.arange(N) + 0.5) / N
core = np.exp(-((u - 0.5) / 0.16) ** 2)[None, :, None]
glow = np.array([150, 225, 255], np.float32)[None, None, :]   # BGR warm white-gold
lum = texture.mean(axis=2, keepdims=True) / 255.0
lift = core * np.clip((0.82 - lum) / 0.5, 0, 1) * 0.75
texture = texture * (1 - lift) + glow * lift
need = rhole & ~done
rfill[need] = texture[need]
done |= need
# Map back into the picture.
for y in range(575, H):
    i = y - 575
    l, r_ = xL(y), xR(y)
    xs = np.arange(max(0, int(np.floor(l))), min(W, int(np.ceil(r_)) + 1))
    xs = xs[hole[y, xs] > 0]
    if xs.size == 0:
        continue
    j = (xs - l) / (r_ - l) * N - 0.5
    j0 = np.clip(np.floor(j).astype(int), 0, N - 1)
    j1 = np.clip(j0 + 1, 0, N - 1)
    t = np.clip(j - j0, 0, 1)[:, None]
    ok = done[i, j0] | done[i, j1]
    val = rfill[i, j0] * (1 - t) + rfill[i, j1] * t
    plate[y, xs[ok]] = val[ok]
    filled[y, xs[ok]] = True
plate = plate.astype(np.uint8)

# 2) Everything else (sky, islands, clouds behind the HUD and the boy's
#    arms): texture-aware inpainting from the surrounding artwork.
rest = (hole > 0) & ~filled
# Scenery right behind the boy (hair/arms over islands and clouds): patch-based
# synthesis from the surrounding artwork keeps real texture (narrow areas).
near_boy = rest & (boy_hole > 0)
if near_boy.any():
    ys_n, xs_n = np.where(near_boy)
    bx0, bx1 = max(0, xs_n.min() - 120), min(W, xs_n.max() + 120)
    by0, by1 = max(0, ys_n.min() - 120), min(H, ys_n.max() + 120)
    sub = plate[by0:by1, bx0:bx1].copy()
    known_sub = (~((hole[by0:by1, bx0:bx1] > 0) & ~filled[by0:by1, bx0:bx1])).astype(np.uint8) * 255
    lab_s = cv2.cvtColor(sub, cv2.COLOR_BGR2Lab)
    out_s = np.zeros_like(lab_s)
    cv2.xphoto.inpaint(lab_s, known_sub, out_s, cv2.xphoto.INPAINT_SHIFTMAP)
    syn = cv2.cvtColor(out_s, cv2.COLOR_Lab2BGR)
    region = near_boy[by0:by1, bx0:bx1]
    sub[region] = syn[region]
    plate[by0:by1, bx0:bx1] = sub
    filled |= near_boy
    rest = (hole > 0) & ~filled
rest8 = rest.astype(np.uint8) * 255
# Low-frequency fill at 1/8 scale (no streak artefacts), refined at full scale.
small_p = cv2.resize(plate, (W // 8, H // 8), interpolation=cv2.INTER_AREA)
small_m = (cv2.resize(rest8, (W // 8, H // 8), interpolation=cv2.INTER_AREA) > 0).astype(np.uint8) * 255
small_f = cv2.inpaint(small_p, small_m, 3, cv2.INPAINT_TELEA)
low = cv2.GaussianBlur(cv2.resize(small_f, (W, H), interpolation=cv2.INTER_CUBIC), (0, 0), 6)
base = plate.copy()
base[rest] = low[rest]
fine = cv2.inpaint(base, cv2.erode(rest8, np.ones((3, 3), np.uint8)) & 0 | rest8, 4, cv2.INPAINT_TELEA)
edge_w = cv2.GaussianBlur((cv2.distanceTransform(rest8, cv2.DIST_L2, 5) < 10).astype(np.float32), (0, 0), 3)[..., None]
mix = (fine.astype(np.float32) * edge_w + low.astype(np.float32) * (1 - edge_w)).astype(np.uint8)
plate[rest] = mix[rest]
cv2.imwrite(f'{OUT}/plate.png', plate)

# ----------------------------------------------------------------- sprites
ys_b, xs_b = np.where(boy > 0)
boy_box = (int(xs_b.min()) - 2, int(ys_b.min()) - 2, int(xs_b.max()) + 3, int(ys_b.max()) + 3)
boy_meta = save_rgba('boy.png', img, boy_alpha, boy_box)
ys_t, xs_t = np.where(trail_alpha8 > 3)
trail_box = (int(xs_t.min()) - 2, int(ys_t.min()) - 2, min(W, int(xs_t.max()) + 3), H)
trail_meta = save_rgba('trail.png', img, trail_alpha8, trail_box)

# UI sprites with the numbers removed (panel background rebuilt from a
# text-free column of the same panel); labels/icons stay as painted.
def clean(bgr, rect, sample_x):
    x0, y0, x1, y1 = rect
    col = bgr[y0:y1, sample_x[0]:sample_x[1]].astype(np.float32).mean(axis=1, keepdims=True)
    bgr[y0:y1, x0:x1] = np.repeat(col, x1 - x0, axis=1).astype(np.uint8)

ui = img.copy()
clean(ui, (128, 40, 244, 90), (246, 251))      # "Lv 12"
clean(ui, (48, 184, 232, 244), (234, 238))     # score digits
clean(ui, (108, 256, 232, 300), (218, 232))    # coin count
clean(ui, (878, 184, 986, 240), (986, 990))    # time digits
ui_meta = {}
badge_m = rrect_mask(24, 21, 111, 110, 14) | rrect_mask(104, 28, 262, 97, 14)
ui_meta['badge'] = save_rgba('ui_badge.png', ui, cv2.GaussianBlur(badge_m, (3, 3), 0.7), HUD['badge'])
ui_meta['score'] = save_rgba('ui_score.png', ui, cv2.GaussianBlur(rrect_mask(24, 136, 246, 312, 16), (3, 3), 0.7), HUD['score'])
ui_meta['time'] = save_rgba('ui_time.png', ui, cv2.GaussianBlur(rrect_mask(806, 136, 1000, 252, 16), (3, 3), 0.7), HUD['time'])
ui_meta['pause'] = save_rgba('ui_pause.png', ui, cv2.GaussianBlur(rrect_mask(909, 21, 1000, 111, 18), (3, 3), 0.7), HUD['pause'])
for name, (cx_, cy_, rr) in ARROWS.items():
    m = np.zeros((H, W), np.uint8)
    cv2.circle(m, (cx_, cy_), rr, 255, -1, lineType=cv2.LINE_AA)
    ui_meta[f'arrow_{name}'] = save_rgba(f'ui_arrow_{name}.png', img, m, (cx_ - rr - 2, cy_ - rr - 2, cx_ + rr + 3, cy_ + rr + 3))
m = np.zeros((H, W), np.uint8)
cv2.circle(m, (77, 276), 25, 255, -1, lineType=cv2.LINE_AA)
ui_meta['coin'] = save_rgba('ui_coin.png', img, m, (50, 249, 105, 304))

# ------------------------------------------------------------------ flow masks
def band(points):
    return poly(points).astype(np.float32) / 255.0

# Waterfalls: bright, low-saturation streaks inside the painted falls.
wf_boxes = [(505, 238, 548, 425), (650, 290, 705, 470), (688, 380, 748, 600), (858, 255, 902, 405), (920, 540, 980, 735),
            (318, 785, 375, 905), (796, 1005, 855, 1155), (380, 275, 402, 335), (455, 490, 482, 545), (0, 1060, 42, 1150)]
water = np.zeros((H, W), np.float32)
bright = ((VAL > 0.72) & (SAT < 0.45) & ((HUE > 170) & (HUE < 230) | (SAT < 0.15))).astype(np.float32)
for (x0, y0, x1, y1) in wf_boxes:
    water[y0:y1, x0:x1] = np.maximum(water[y0:y1, x0:x1], bright[y0:y1, x0:x1])
water = cv2.GaussianBlur(water, (0, 0), 1.5)
water[hole > 0] = 0

gold_m = rail_band.astype(np.float32)
gold_m = cv2.GaussianBlur(gold_m, (0, 0), 2)

PIPE_L = [(0, 872), (292, 722), (304, 776), (0, 972)]
PIPE_R = [(742, 772), (1024, 932), (1024, 1078), (742, 852)]
blue = ((HUE > 190) & (HUE < 250) & (SAT > 0.25)) | (VAL > 0.85)
pipes = np.zeros((H, W), np.float32)

flow = np.dstack([
    np.zeros((H, W), np.float32),
    np.clip(pipes, 0, 1),
    np.clip(gold_m, 0, 1),
    np.clip(water, 0, 1),
])  # BGR + A order for OpenCV -> R=water, G=gold, B=pipes after swap below
flow_bgra = (np.dstack([np.clip(pipes, 0, 1), np.clip(gold_m, 0, 1), np.clip(water, 0, 1), np.ones((H, W), np.float32)]) * 255).astype(np.uint8)
cv2.imwrite(f'{OUT}/flow.png', flow_bgra)

# --------------------------------------------------------------------- layout
def fit(ys, xs):
    return [float(v) for v in np.polyfit(ys, xs, 2)]

layout = {
    'size': [W, H],
    'rail': {'left': [[y, x] for y, x in LEFT_EDGE], 'right': [[y, x] for y, x in RIGHT_EDGE]},
    'coins': coin_meta,
    'coinMaster': coin_master,
    'boy': {**boy_meta, 'feet': [505, 1276],
            'joints': {'pelvis': [520, 1062], 'chest': [525, 930], 'neck': [560, 872], 'head': [592, 815],
                       'shoulderL': [438, 918], 'handL': [366, 966], 'shoulderR': [614, 920], 'elbowR': [670, 956],
                       'handR': [728, 1040], 'hipL': [472, 1060], 'kneeL': [440, 1114], 'footL': [442, 1190],
                       'hipR': [570, 1066], 'kneeR': [546, 1122], 'footR': [508, 1250]}},
    'trail': {**trail_meta, 'top': [478, 1200]},
    'blockX': {**block_x, 'bottom': [258, 712]},
    'blockChevron': {**block_c, 'bottom': [756, 798]},
    'farGold': {**far_gold, 'bottom': [431, 563]},
    'farPipe': {**far_pipe, 'bottom': [616, 619]},
    'ui': ui_meta,
    'text': {
        'level': {'x': 141, 'y': 80, 'size': 42},
        'score': {'x': 138, 'y': 238, 'size': 64},
        'coins': {'x': 115, 'y': 292, 'size': 38},
        'time': {'x': 882, 'y': 232, 'size': 54},
    },
    'pipes': {
        'left': {'near': [0, 922], 'far': [292, 748], 'thickNear': 96, 'thickFar': 50},
        'right': {'near': [1024, 1005], 'far': [742, 812], 'thickNear': 140, 'thickFar': 76},
    },
}
with open('src/gameplay/layout.json', 'w') as f:
    json.dump(layout, f, indent=1)
print('boy', boy_meta, 'trail', trail_meta)
