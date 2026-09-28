# SKIZGAIROS

Mobile (Android) game. Screens are built directly from the approved artwork in
[`docs/reference/`](docs/reference/):

| # | Screen | Status |
|---|--------|--------|
| 1 | GAMEPLAY SCREEN (`1-gameplay-screen-hd.png`) | Implemented — awaiting approval |
| 2 | RAIL SWITCHING (`2-rail-switching.png`) | Not started (waits for Screen 1 approval) |
| 3 | HIDDEN ROUTE (`3-hidden-route.png`) | Not started (waits for Screen 2 approval) |

## How the Gameplay Screen uses the supplied image

The supplied GAMEPLAY SCREEN image **is** the screen. Nothing is redrawn or
regenerated — the screen is that image, taken apart into layers and put back
together every frame so its parts can move.

- **The layers**: `tools/extract_gameplay.py` cuts every layer out of the
  1024×1536 artwork — the world plate (with the boy, his light trail, the coin
  trail and the HUD lifted out, and the gold rail behind them rebuilt from its
  own pixels), the boy, his trail, each painted coin, the red X and blue
  chevron blocks, the HUD panels with their numbers removed, and flow masks for
  the waterfalls. It writes `src/gameplay/layout.json` with the measured
  positions and the rail model.
- **Opening frame**: the layers are reassembled into the painting. At the
  artwork's own shape the rebuilt frame matches the supplied image to within
  8 levels over 96% of its pixels (checked by `npm run playtest`).
- **The rail model** (`src/gameplay/Rail.ts`) is measured, not invented:
  - **Depth** comes from the painted coin trail. The coins are one coin drawn
    smaller with distance, so a coin's radius gives its depth, and the depth
    curve runs exactly through all five painted coins.
  - **Lanes** come from the painted gold rail. Its measured left and right
    edges give the rail's centre and width at every row, so the three lanes
    spread apart exactly as the rail does.
- **Gameplay**:
  - The boy moves between three lanes on the gold rail.
  - Coins approach along the rail and are collected into the painted counter.
  - Red X blocks cause a WIPEOUT; blue chevron blocks give a speed boost.
  - The run starts with exactly the coins painted in the artwork, then
    continues into generated patterns that always leave one lane free.
- **Live HUD**: score, coins and time are drawn over the painted panels in the
  painted positions, sizes and style, starting from the painted values
  (24,580 / 286 / 01:22). "Lv 12" stays exactly as painted.
- **Any screen shape**: the world is full-bleed and never stretched, framed on
  the boy so the rail always fills the screen. The HUD keeps the padding it is
  painted with, but measured from the safe area, so the panels and the arrow
  buttons stay in the corners on a screen taller than the painting. Anything
  the world cannot cover is a soft extension of the same art.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (rail model, ride logic)
npm run playtest     # browser e2e checks + screenshots in playtest-output/
```

Regenerate the layers after replacing the artwork (for example with a
higher-resolution export of the same image):

```bash
pip install opencv-python-headless pillow numpy
python3 tools/extract_gameplay.py
```

`tools/compare.py <screenshot.png>` compares a screenshot with the supplied
artwork and writes a difference heat-map beside it.

## Android

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug   # app/build/outputs/apk/debug/app-debug.apk
```

Needs a JDK and the Android SDK (platform 36, build-tools 36) with
`ANDROID_SDK_ROOT` set, or `android/local.properties` pointing at it.

`MainActivity` draws edge-to-edge and sends the real `WindowInsets` (system bars
and display cutout) to the game, so the HUD always sits inside the safe area.
The app is locked to portrait.

## Controls

- **Start riding**: tap the screen or press an arrow.
- **Change lane**: the painted ← / → buttons (or the keyboard arrows / A–D).
- **Pause**: the painted pause button (or P / Esc).
