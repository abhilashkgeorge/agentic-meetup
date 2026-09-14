#!/bin/bash
# Drive the app on a real device. Every step leaves a screenshot behind, named in
# order, so a failure can be read back as a sequence rather than guessed at.
export PATH="$PATH:$HOME/Library/Android/sdk/platform-tools"
SHOTS="$CLAUDE_JOB_DIR/tmp/shots"
mkdir -p "$SHOTS"
n=0
shot() { n=$((n+1)); sleep "${2:-1.5}"; adb exec-out screencap -p > "$SHOTS/$(printf '%02d' $n)-$1.png"; echo "  shot $(printf '%02d' $n)-$1"; }
tap()  { adb shell input tap "$1" "$2"; }
type() { adb shell input text "$1"; }
back() { adb shell input keyevent 4; }
swipe(){ adb shell input swipe "$1" "$2" "$3" "$4" "${5:-300}"; }
errors() { adb logcat -d -t "${1:-300}" | grep -iE "ReactNativeJS|FATAL EXCEPTION" | grep -v "Alexa\|amazon" | tail -6; }
