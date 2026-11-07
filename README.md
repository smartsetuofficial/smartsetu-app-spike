# app-spike (S13-1, test only, not the product)
Question this answers: can a hidden webview in an Android app read Myntra, Meesho and Tata CLiQ search pages with our pagesnap.js and parse them with our bundle.js?
- Plugin: @capgo/capacitor-inappbrowser 8.26.1 (V-202), Capacitor 8.5.3. Minimum Android 7.0 (API 24).
- pagesnap.js and bundle.js here are exact copies of code/extension/ (test_spike T11 checks this). Do not edit them here.
- Tests (Node 22): node test_spike.js
- APK: GitHub Actions builds app-debug.apk (workflow apk.yml). No key, no secret, no store login.
- This folder becomes its own PRIVATE GitHub repo (smartsetu-app-spike). The .git folder stays out of the handoff zip.
Pass = 3 stores give listings, or the failure reason is visible on the screen (screenshot). Fail = Flutter InAppWebView (D-OPEN-5).
