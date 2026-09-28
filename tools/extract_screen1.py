"""Split the supplied GAMEPLAY SCREEN image into layers for the app.

Everything comes from the supplied image's own pixels:
  plate.png  - the full screen image with the boy and the gold-rail coin trail
               lifted out (the small hidden areas behind them are restored
               from surrounding pixels of the same image)
  boy.png    - the boy, cut out with an alpha mask
  coin.png   - the big star coin, cut out (reused for approaching coins)
  block_x.png / block_chevron.png - the red X block and blue chevron block
  hud.png    - the HUD artwork only (drawn on top of moving objects)
  src/screen1/layers.json - pixel positions of everything (512x1024 image space)

Run: python3 tools/extract_screen1.py
"""
import json
import cv2
import numpy as np

SRC = 'docs/reference/1-gameplay-screen.png'
OUT = 'public/screen1'

img = cv2.imread(SRC)
H, W = img.shape[:2]
assert (W, H) == (512, 1024), (W, H)

# ------------------------------------------------------------------ boy
mask = np.full((H, W), cv2.GC_BGD, np.uint8)
mask[512:828, 150:412] = cv2.GC_PR_BGD
poly = np.array([(262,526),(300,520),(338,540),(352,572),(336,600),(350,630),(392,668),(405,700),(392,705),(372,690),(340,650),(328,690),(318,740),(300,760),(292,800),(280,820),(250,812),(232,800),(212,778),(196,760),(214,730),(228,700),(214,660),(200,640),(170,652),(158,650),(168,630),(200,615),(222,605),(250,590),(262,560)], np.int32)
cv2.fillPoly(mask, [poly], cv2.GC_PR_FGD)
for c in [
    [(270,560),(320,560),(330,600),(320,660),(300,700),(260,700),(240,660),(230,610)],
    [(236,760),(265,745),(280,800),(250,805)],
    [(270,530),(310,528),(325,555),(280,565)],
    # gloves with the orange fingertips
    [(158,648),(170,636),(190,632),(200,640),(196,658),(178,666),(162,662)],
    [(362,684),(372,674),(392,680),(406,694),(404,712),(392,718),(376,708)],
]:
    cv2.fillPoly(mask, [np.array(c, np.int32)], cv2.GC_FGD)
# Rail visible beside the head / under the right arm is background.
for c in [
    [(212,519),(284,518),(280,526),(268,536),(262,547),(258,565),(257,580),(247,597),(224,600),(210,598)],
]:
    cv2.fillPoly(mask, [np.array(c, np.int32)], cv2.GC_BGD)
bgd = np.zeros((1, 65), np.float64)
fgd = np.zeros((1, 65), np.float64)
cv2.grabCut(img, mask, None, bgd, fgd, 10, cv2.GC_INIT_WITH_MASK)
boy = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
n, lab, stats, _ = cv2.connectedComponentsWithStats(boy)
boy = np.where(lab == 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]), 255, 0).astype(np.uint8)
# fill pinholes
boy = cv2.morphologyEx(boy, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
# Fingertip glow: grow the mask a little around both hands.
hands = np.zeros_like(boy)
cv2.circle(hands, (176, 652), 22, 255, -1)
cv2.circle(hands, (390, 700), 24, 255, -1)
boy = np.where((hands > 0) & (cv2.dilate(boy, np.ones((7, 7), np.uint8)) > 0), 255, boy).astype(np.uint8)
boy_alpha = cv2.GaussianBlur(boy, (3, 3), 0.7)

# --------------------------------------------------------------- coins
# Star coins on the gold rail (centre x, centre y, radius) - near to far.
coins = [(239.0, 540.5, 30.0), (240.5, 481.0, 20.0), (240.0, 441.0, 12.0), (238.0, 421.5, 7.0)]
coin_mask = np.zeros((H, W), np.uint8)
for cx, cy, r in coins:
    cv2.circle(coin_mask, (int(round(cx)), int(round(cy))), int(np.ceil(r * 1.12 + 3)), 255, -1)

# --------------------------------------------------------------- plate
# Restore what lies behind the lifted-out boy and coins using only pixels
# of this same image:
#  1. gold rail: mirror across the rail's centre line (the rail is symmetric),
#  2. remaining rail pixels: interpolate along the rail's lengthwise streaks,
#  3. small leftovers over the sky: classic inpainting from the surroundings.
boy_hole = cv2.dilate(boy, np.ones((3, 3), np.uint8))
hole = cv2.bitwise_or(boy_hole, coin_mask)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
hch, sch, vch = hsv[:, :, 0].astype(int), hsv[:, :, 1].astype(int), hsv[:, :, 2].astype(int)
gold = ((hch >= 8) & (hch <= 32) & (sch > 60) & (vch > 150)) | ((vch > 235) & (sch < 90))

def rail_centre(y):
    # Centre line of the gold rail (measured on the artwork).
    return 238.0 + (y - 540.0) * 0.036

plate = img.copy()
filled = np.zeros((H, W), bool)
ys_h, xs_h = np.where(hole > 0)
for y, x in zip(ys_h, xs_h):
    mx = int(round(2 * rail_centre(y) - x))
    if 0 <= mx < W and hole[y, mx] == 0 and gold[y, mx]:
        plate[y, x] = img[y, mx]
        filled[y, x] = True
# Vertical interpolation along the rail for what is still missing.
remaining = (hole > 0) & ~filled
for x in range(W):
    col = remaining[:, x]
    if not col.any():
        continue
    y = 0
    while y < H:
        if not col[y]:
            y += 1
            continue
        y0 = y
        while y < H and col[y]:
            y += 1
        y1 = y  # first non-missing row after the run
        top, bot = y0 - 1, y1
        if top >= 0 and bot < H and gold[top, x] and gold[bot, x] and (y1 - y0) < 140:
            a = plate[top, x].astype(float)
            b = plate[bot, x].astype(float)
            for yy in range(y0, y1):
                t = (yy - top) / (bot - top)
                plate[yy, x] = (a * (1 - t) + b * t).astype(np.uint8)
                filled[yy, x] = True
left = ((hole > 0) & ~filled).astype(np.uint8) * 255
plate = cv2.inpaint(plate, left, 5, cv2.INPAINT_TELEA)
# Gentle smoothing only inside the restored area to hide seams.
blur = cv2.GaussianBlur(plate, (5, 5), 1.0)
m3 = cv2.merge([cv2.GaussianBlur(hole, (5, 5), 1.5)] * 3).astype(np.float32) / 255.0
plate = (plate * (1 - m3) + blur * m3).astype(np.uint8)

def crop_rgba(bgr, alpha, box):
    x0, y0, x1, y1 = box
    rgba = cv2.cvtColor(bgr[y0:y1, x0:x1], cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha[y0:y1, x0:x1]
    return rgba

ys, xs = np.where(boy > 0)
bbox = (int(xs.min()) - 2, int(ys.min()) - 2, int(xs.max()) + 3, int(ys.max()) + 3)
cv2.imwrite(f'{OUT}/boy.png', crop_rgba(img, boy_alpha, bbox))

# Each coin of the trail as its own sprite (soft circular alpha: opaque
# disc, feathered rim that blends into the rail).
coin_sprites = []
for i, (cx, cy, r) in enumerate(coins):
    R = r * 1.12 + 3
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    a = np.clip((R - d) / max(1.0, R - (r + 1)), 0, 1)
    cm = (a * 255).astype(np.uint8)
    box = (int(np.floor(cx - R - 1)), int(np.floor(cy - R - 1)), int(np.ceil(cx + R + 2)), int(np.ceil(cy + R + 2)))
    cv2.imwrite(f'{OUT}/coin{i}.png', crop_rgba(img, cm, box))
    coin_sprites.append({'x': box[0], 'y': box[1], 'w': box[2] - box[0], 'h': box[3] - box[1], 'cx': cx, 'cy': cy, 'r': r})
coin_box = (coin_sprites[0]['x'], coin_sprites[0]['y'], coin_sprites[0]['x'] + coin_sprites[0]['w'], coin_sprites[0]['y'] + coin_sprites[0]['h'])

# Blocks (rectangular frames) with slightly rounded alpha.
def block(box, radius):
    x0, y0, x1, y1 = box
    m = np.zeros((H, W), np.uint8)
    cv2.rectangle(m, (x0 + radius, y0), (x1 - radius, y1), 255, -1)
    cv2.rectangle(m, (x0, y0 + radius), (x1, y1 - radius), 255, -1)
    for px, py in [(x0 + radius, y0 + radius), (x1 - radius, y0 + radius), (x0 + radius, y1 - radius), (x1 - radius, y1 - radius)]:
        cv2.circle(m, (px, py), radius, 255, -1, lineType=cv2.LINE_AA)
    return crop_rgba(img, cv2.GaussianBlur(m, (3, 3), 0.6), (x0 - 1, y0 - 1, x1 + 2, y1 + 2))
block_x_box = (89, 417, 173, 494)
block_c_box = (354, 425, 447, 517)
cv2.imwrite(f'{OUT}/block_x.png', block(block_x_box, 8))
cv2.imwrite(f'{OUT}/block_chevron.png', block(block_c_box, 8))

# ------------------------------------------------------------------ HUD
hud_mask = np.zeros((H, W), np.uint8)
def rrect(x0, y0, x1, y1, rad):
    cv2.rectangle(hud_mask, (x0 + rad, y0), (x1 - rad, y1), 255, -1)
    cv2.rectangle(hud_mask, (x0, y0 + rad), (x1, y1 - rad), 255, -1)
    for px, py in [(x0 + rad, y0 + rad), (x1 - rad, y0 + rad), (x0 + rad, y1 - rad), (x1 - rad, y1 - rad)]:
        cv2.circle(hud_mask, (px, py), rad, 255, -1, lineType=cv2.LINE_AA)
hud = {
    'level': (20, 14, 180, 72),
    'score': (18, 88, 168, 210),
    'pause': (428, 14, 492, 78),
    'time': (359, 89, 492, 158),
    'caption': (58, 930, 454, 998),
}
for k, (x0, y0, x1, y1) in hud.items():
    rrect(x0, y0, x1, y1, 12)
arrows = {'left': (86, 851, 67), 'right': (425, 851, 67)}
for cx_, cy_, rr in arrows.values():
    cv2.circle(hud_mask, (cx_, cy_), rr, 255, -1, lineType=cv2.LINE_AA)
# The screen's outer frame (thin rounded border drawn in the artwork).
frame = np.zeros((H, W), np.uint8)
cv2.rectangle(frame, (0, 0), (W - 1, H - 1), 255, 14)
hud_mask = cv2.bitwise_or(hud_mask, frame)
hud_rgba = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
hud_rgba[:, :, 3] = hud_mask
cv2.imwrite(f'{OUT}/hud.png', hud_rgba)
cv2.imwrite(f'{OUT}/plate.png', plate)
plate_coins = img.copy()
cm1 = coin_mask > 0
plate_coins[cm1] = plate[cm1]
# the boy is drawn over this plate unchanged, so keep his painted pixels
plate_coins[boy > 0] = img[boy > 0]
cv2.imwrite(f'{OUT}/plate_coins.png', plate_coins)
# App icon / favicon: the winged emblem from the painted level badge.
emblem = img[16:72, 20:84]
cv2.imwrite('public/favicon.png', cv2.resize(emblem, (128, 112), interpolation=cv2.INTER_LANCZOS4))

# Live-number patches: panel background (no digits) rebuilt from a
# text-free strip of the same panel, so updated values can be drawn in the
# painted style. Only used once numbers change (never on the opening frame).
patches = {
    # name: (target rect x0, y0, x1, y1), (sample strip x0, x1)
    'score': ((28, 119, 162, 165), (148, 157)),
    'coins': ((72, 171, 162, 202), (140, 157)),
    'time': ((408, 124, 485, 160), (477, 484)),
}
patch_layout = {}
for name, ((x0, y0, x1, y1), (sx0, sx1)) in patches.items():
    strip = img[y0:y1, sx0:sx1]
    col = strip.mean(axis=1, keepdims=True).astype(np.uint8)
    patch = np.repeat(col, x1 - x0, axis=1)
    cv2.imwrite(f'{OUT}/patch_{name}.png', patch)
    patch_layout[name] = {'x': x0, 'y': y0, 'w': x1 - x0, 'h': y1 - y0}

layout = {
    'size': [W, H],
    'boy': {'x': bbox[0], 'y': bbox[1], 'w': bbox[2] - bbox[0], 'h': bbox[3] - bbox[1], 'feet': [258, 818]},
    'coins': coin_sprites,
    'blockX': {'x': block_x_box[0] - 1, 'y': block_x_box[1] - 1, 'w': block_x_box[2] - block_x_box[0] + 3, 'h': block_x_box[3] - block_x_box[1] + 3},
    'blockChevron': {'x': block_c_box[0] - 1, 'y': block_c_box[1] - 1, 'w': block_c_box[2] - block_c_box[0] + 3, 'h': block_c_box[3] - block_c_box[1] + 3},
    'hud': {k: list(v) for k, v in hud.items()},
    'arrows': {k: list(v) for k, v in arrows.items()},
    'horizonY': 360,
    'patches': patch_layout,
}
with open('src/screen1/layers.json', 'w') as f:
    json.dump(layout, f, indent=2)
print(json.dumps(layout['boy']), 'boy px', int(boy.sum() / 255))
