# SKIZGAIROS

Mobile (Android) game. Screens are built directly from the approved artwork in
[`docs/reference/`](docs/reference/):

| # | Screen | Status |
|---|--------|--------|
| 1 | GAMEPLAY SCREEN (`1-gameplay-screen.png`) | Implemented — awaiting approval |
| 2 | RAIL SWITCHING (`2-rail-switching.png`) | Not started (waits for Screen 1 approval) |
| 3 | HIDDEN ROUTE (`3-hidden-route.png`) | Not started (waits for Screen 2 approval) |

## How Screen 1 uses the supplied image

The supplied GAMEPLAY SCREEN image **is** the screen. Nothing is redrawn or
regenerated.

- **Opening frame**: the app shows the supplied image itself, pixel for pixel
  (verified 100% identical at 512×1024 by `tools/compare.py`).
- **Layers for interaction**: `tools/extract_screen1.py` cuts layers out of the
  same image — the boy, the coins on the gold rail, the red X block, the blue
  chevron block, and the painted HUD. It also makes a background plate where the
  small areas behind the boy and coins are restored from the surrounding pixels
  of the same image. Once riding starts, the screen is recomposed from these
  layers; the first frame is 99.6% pixel-identical to the artwork.
- **Controls**: invisible touch areas sit exactly on the painted left arrow,
  right arrow and pause button.
- **Gameplay**:
  - The boy moves between three lanes on the gold rail.
  - Coins approach along the rail's perspective (measured from the painting) and
    are collected into the painted coin counter.
  - Red X blocks cause a WIPEOUT.
  - Blue chevron blocks give a speed boost.
- **Live HUD**: score, coins and time are drawn over the painted panels in the
  painted style, starting from the painted values (24,580 / 286 / 01:22).
  "Lv 12" and the "GAMEPLAY SCREEN" caption stay exactly as painted.
- **Any screen shape**: the whole image is always visible and never stretched or
  cropped. It fits inside the safe area, and the leftover margins (behind the
  status and navigation bars) show a soft, blurred extension of the same image
  instead of black bars.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (ride logic, perspective)
npm run playtest     # browser e2e checks + screenshots in playtest-output/
```

Regenerate the layers after replacing the artwork (for example with a
higher-resolution export of the same image):

```bash
pip install opencv-python-headless pillow numpy
python3 tools/extract_screen1.py
```

## Android

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug   # app/build/outputs/apk/debug/app-debug.apk
```

`MainActivity` draws edge-to-edge and sends the real `WindowInsets` (system bars
and display cutout) to the game, so the artwork always sits inside the safe
area. The app is locked to portrait.

## Controls

- **Start riding**: tap the screen or press an arrow.
- **Change lane**: the painted ← / → buttons (or the keyboard arrows / A–D).
- **Pause**: the painted pause button (or P / Esc).
