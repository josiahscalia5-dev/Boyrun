#!/usr/bin/env bash
# Install the debug APK on a running emulator/device, launch SKIZGAIROS and
# capture the real Android screen: opening frame, riding, lane change, pause.
# The painted controls are found through the accessibility tree (the
# invisible hitboxes carry labels), so taps land exactly on the artwork.
# Usage: scripts/emulator-shots.sh [apk]
set -euo pipefail
ADB="${ANDROID_HOME:-/opt/android-sdk}/platform-tools/adb"
APK="${1:-android/app/build/outputs/apk/debug/app-debug.apk}"
OUT=playtest-output/android
mkdir -p "$OUT"

$ADB wait-for-device
$ADB install -r "$APK" >/dev/null
$ADB shell am force-stop com.skizgairos.game || true
$ADB shell am start -W -n com.skizgairos.game/.MainActivity >/dev/null
sleep "${LAUNCH_WAIT:-25}"
$ADB exec-out screencap -p > "$OUT/1-opening.png"
echo "captured opening screen"

center_of() { # $1 = accessibility label
  $ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  $ADB shell cat /sdcard/ui.xml | tr '>' '\n' | grep -m1 "$1" | sed -E 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]".*/\1 \2 \3 \4/' |
    awk '{printf "%d %d", ($1+$3)/2, ($2+$4)/2}'
}

size=$($ADB shell wm size | awk '{print $3}' | tail -1 | tr -d '\r')
W=${size%x*}
H=${size#*x}
echo "screen ${W}x${H}"

right=$(center_of "Move right")
pause=$(center_of "Pause")
echo "right arrow at: ${right:-?}   pause at: ${pause:-?}"

# Tap the middle of the screen to start riding.
$ADB shell input tap $((W / 2)) $((H / 2))
sleep "${RIDE_WAIT:-6}"
$ADB exec-out screencap -p > "$OUT/2-riding.png"
echo "captured riding"

if [ -n "${right}" ]; then
  $ADB shell input tap $right
  sleep "${MOVE_WAIT:-3}"
  $ADB exec-out screencap -p > "$OUT/3-after-right.png"
  echo "captured after right arrow"
fi
if [ -n "${pause}" ]; then
  $ADB shell input tap $pause
  sleep "${PAUSE_WAIT:-4}"
  $ADB exec-out screencap -p > "$OUT/4-paused.png"
  echo "captured paused"
fi
echo "saved to $OUT"
