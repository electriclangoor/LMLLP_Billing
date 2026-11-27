#!/bin/zsh
# Builds android/dist/Biller.apk (signed, ready to install on the phone).
set -e
cd "${0:A:h}"
export JAVA_HOME=$(/usr/libexec/java_home -v 25)
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
[ -f local.properties ] || echo "sdk.dir=$ANDROID_HOME" > local.properties

# First build only: create the signing key (kept in keystore/, never committed)
if [ ! -f keystore/keystore.properties ]; then
  mkdir -p keystore
  PASS=$(openssl rand -base64 24 | tr -d '/+=')
  keytool -genkeypair -keystore keystore/biller-release.jks -alias biller \
    -keyalg RSA -keysize 4096 -validity 36500 -storepass "$PASS" -keypass "$PASS" \
    -dname "CN=Biller, O=Langoor Media LLP, C=IN" > /dev/null 2>&1
  printf 'storeFile=biller-release.jks\nstorePassword=%s\nkeyAlias=biller\nkeyPassword=%s\n' "$PASS" "$PASS" > keystore/keystore.properties
  chmod 600 keystore/*
  echo "Created signing key in android/keystore/ (back this folder up)"
fi

node ../desktop/copy-web.js app/src/main/assets/web
./gradlew --quiet assembleRelease
mkdir -p dist
cp app/build/outputs/apk/release/app-release.apk dist/Biller.apk
echo "Built android/dist/Biller.apk"
