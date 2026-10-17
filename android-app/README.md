# AccessRoute Android app

This is a separate Capacitor Android app. It packages the built React app and scene data into the APK, so core route calculation, maps, preferences, and offline simulator workflows run on the phone. Qwen workflows, Hong Kong Observatory weather, and paired map-demo sessions call the configured backend and require internet access. No Qwen credential is included in the APK.

The backend must be available at a public HTTPS origin. Set `ACCESSROUTE_CORS_ORIGINS=https://localhost` on the backend so the Android WebView can call it. CORS is not authentication. The current backend is a local demo without user authentication or rate limiting, and write APIs are disabled for non-loopback hosts by default. Do not expose it publicly until it is behind suitable access control and rate limiting; otherwise model requests could consume your Qwen quota.

## Cantonese speech

The APK uses Android's native Text-to-Speech engine for `yue-HK`; it does not need Azure or Google Cloud TTS credentials. On the phone, choose **Speech Services by Google** as the preferred engine (the label can vary by Android version) and install **Cantonese (Hong Kong)** voice data in Android's Text-to-speech output settings. If `yue-HK` is unavailable, the app reports that rather than silently reading with an English voice. This native engine is available in the APK, not the Chrome web preview.

## Build the APK

1. Deploy the AccessRoute backend at a public HTTPS origin and configure `DASHSCOPE_API_KEY` on that server only. If the phone should use HK Observatory and Qwen features, keep the API and its network access available.
2. On the build computer, install Android Studio with its Android SDK and JDK.
3. From this directory, install the Capacitor dependencies, generate the Android project once, and build a debug APK. Replace the example URL with the HTTPS origin of the backend:

   ```bash
   ACCESSROUTE_API_URL=https://your-api-host.example npm install
   ACCESSROUTE_API_URL=https://your-api-host.example npm run android:add
   ACCESSROUTE_API_URL=https://your-api-host.example npm run android:apk:debug
   ```

   For later builds, `npm install` and `android:add` are only needed once. The build script rebuilds the local frontend and scene data, configures the API origin, syncs the Android project, and runs Gradle.

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. Install that file on the phone. The core app and maps work from bundled files; live weather, Qwen AI, and paired map-demo sessions need the configured backend. API URLs are not secrets, but Qwen keys must remain on the backend.

The Android SDK/JDK are not bundled with this project. The app does not provide real indoor positioning or turn simulated navigation into verified real-world guidance.
