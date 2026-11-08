# SmartSetu Android app (S14-1 test build)
What it is: the extension Compare screen on a phone. Each store search page opens in a hidden webview inside the app, one store after another, is read with pagesnap.js, parsed and compared with bundle.js, and drawn with view.js (all copies of code/extension, test_app checks this). Myntra is off (no phone data yet, D-078).
- appId in.smartsetu.app, name SmartSetu (D-080). Plugin @capgo/capacitor-inappbrowser 8.26.1 (V-202), Capacitor 8.5.3. Minimum Android 7.0 (API 24).
- src/webtabs.js gives runner_core.js a tabs + scripting object backed by the plugin. src/app.js is glue only. spike_core.js and test_spike.js are the S13 spike, kept.
- Tests (Node 22): node test_spike.js and node test_app.js (npm test runs both).
- APK: GitHub Actions workflow apk.yml (manual Run workflow) builds app-debug.apk, artifact smartsetu-debug-apk. No key, no secret, no store login. Debug APK is for the owner phone only, not for members.
- Not in this build: consent screen (S14-2), signed release APK (S14-3), website download button (S14-4), stock check on product pages.
- This folder is its own PRIVATE GitHub repo (smartsetu-app-spike). The .git folder stays out of the handoff zip.
