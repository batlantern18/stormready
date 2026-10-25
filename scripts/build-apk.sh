#!/usr/bin/env bash
#
# Build a release APK for whichever branch you are on.
#
#   scripts/build-apk.sh                        # arm64-v8a only (the default)
#   ABIS=arm64-v8a,armeabi-v7a scripts/build-apk.sh
#   scripts/build-apk.sh --skip-prebuild        # reuse the existing android/
#
# Branch-agnostic by design:
#   * it lives in git (scripts/, not the gitignored android/), so it is present
#     on every branch — master, v1.2, and any branch cut from them later;
#   * it runs `expo prebuild` itself, so a fresh clone with no android/
#     directory still builds;
#   * it re-applies the ABI filter *after* prebuild, because prebuild
#     regenerates gradle.properties and resets it to all four ABIs;
#   * it reads the version from app.json, so the output is named for the
#     branch you are on rather than a hard-coded one;
#   * it verifies the finished APK really contains only the ABIs you asked
#     for, and fails loudly if it does not.
#
# The version code is NOT managed here — it belongs to app.json, which is the
# one place that declares native configuration.
#
# Requirements: node_modules installed, a JDK (17+), and the Android SDK.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ABIS="${ABIS:-arm64-v8a}"
SKIP_PREBUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-prebuild) SKIP_PREBUILD=1 ;;
    *) echo "✗ Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- toolchain
# Prefer JDK 21: it is what the SDK 58 / Gradle 9 toolchain is verified with.
# Fall back to whatever `java` is on PATH so the script still runs elsewhere.
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "${JAVA_HOME:-}/bin/javac" ]; then
  for candidate in /usr/lib/jvm/java-21-openjdk-amd64 /usr/lib/jvm/java-17-openjdk-amd64 \
                   /usr/lib/jvm/default-java "${HOME}/.sdkman/candidates/java/current"; do
    if [ -x "$candidate/bin/javac" ]; then export JAVA_HOME="$candidate"; break; fi
  done
fi
if [ -n "${JAVA_HOME:-}" ]; then
  export PATH="$JAVA_HOME/bin:$PATH"
  echo "→ JDK:  $JAVA_HOME ($("$JAVA_HOME/bin/java" -version 2>&1 | head -1))"
else
  echo "→ JDK:  using the java on PATH ($("java" -version 2>&1 | head -1))"
fi

# The Android SDK: honour the standard variables, then the usual locations.
if [ -z "${ANDROID_HOME:-}" ] && [ -n "${ANDROID_SDK_ROOT:-}" ]; then
  export ANDROID_HOME="$ANDROID_SDK_ROOT"
fi
if [ -z "${ANDROID_HOME:-}" ]; then
  for candidate in "${HOME}/Android/Sdk" "${HOME}/Library/Android/sdk" "/usr/lib/android-sdk"; do
    if [ -d "$candidate" ]; then export ANDROID_HOME="$candidate"; break; fi
  done
fi
if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "$ANDROID_HOME" ]; then
  echo "✗ No Android SDK found. Set ANDROID_HOME (or ANDROID_SDK_ROOT) and retry." >&2
  exit 1
fi
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
echo "→ SDK:  $ANDROID_HOME"

# --------------------------------------------------------- native project
# android/ is generated (Continuous Native Generation) and is gitignored, so a
# fresh clone has none. Prebuild also picks up any change to app.json — and it
# rewrites gradle.properties, so the ABI filter is applied *after* it.
if [ "$SKIP_PREBUILD" -eq 0 ]; then
  echo "→ Generating the native project (expo prebuild) …"
  npx expo prebuild --platform android --no-install
else
  echo "→ Reusing the existing android/ (--skip-prebuild)"
fi

echo "→ Restricting the build to: $ABIS"
sed -i "s/^reactNativeArchitectures=.*/reactNativeArchitectures=$ABIS/" android/gradle.properties
grep '^reactNativeArchitectures' android/gradle.properties

# The SDK path Gradle needs, when there is no local.properties yet.
if [ ! -f android/local.properties ]; then
  echo "sdk.dir=$ANDROID_HOME" > android/local.properties
fi

# ------------------------------------------------------------------- build
echo "→ Building the release APK …"
( cd android && ./gradlew assembleRelease --no-daemon --console=plain )

# ------------------------------------------------------------------ output
APK="android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || { echo "✗ No APK was produced." >&2; exit 1; }

VERSION="$(node -p "require('./app.json').expo.version")"
SUFFIX="$(echo "$ABIS" | tr ',' '-')"
OUT="StormReady-${VERSION}-${SUFFIX}.apk"
cp "$APK" "$OUT"

# aapt2 lives in the SDK's build-tools, whose version differs per machine —
# so it is discovered rather than hard-coded.
AAPT2="$(find "$ANDROID_HOME/build-tools" -maxdepth 2 -name aapt2 -type f 2>/dev/null | sort -V | tail -1)"

echo
echo "✓ $OUT"
ls -lh "$OUT" | awk '{print "  " $5, $9}'

FOUND_ABIS="$(unzip -l "$OUT" | grep -oE 'lib/[a-z0-9_-]+/' | sed 's|lib/||; s|/$||' | sort -u | tr '\n' ' ')"
echo "  ABIs in the APK: $FOUND_ABIS"
if [ -n "$AAPT2" ]; then
  echo "  package:        $("$AAPT2" dump badging "$OUT" 2>/dev/null | grep -oE "name='[^']*' versionCode='[^']*' versionName='[^']*'")"
fi

# The whole point of the ABI filter: fail loudly rather than ship a fat APK.
WANTED="$(echo "$ABIS" | tr ',' '\n' | sed 's/[[:space:]]//g' | sort -u)"
GOT="$(echo "$FOUND_ABIS" | tr ' ' '\n' | sed '/^$/d' | sort -u)"
if [ "$(echo "$WANTED")" != "$(echo "$GOT")" ]; then
  echo
  echo "✗ ABI mismatch." >&2
  echo "  wanted: $(echo $WANTED | tr '\n' ' ')" >&2
  echo "  got:    $(echo $GOT | tr '\n' ' ')" >&2
  exit 1
fi
echo "  ✓ ABI check passed"
