# Changelog

## 2026-10-17

### Added

- Optional self-hosted Hong Kong Cantonese TTS using `canto-tts`, exposed to web clients through the existing backend speech endpoint.
- A loopback-only Python synthesis service with WAV output, audio caching in the Node provider, and clear connection/synthesis errors without language fallback.
- Capability and UI notices for the model's single default voice; male/female preference does not change the self-hosted voice.

### Fixed

- HKO weather responses now accept both string and array warning messages.
- Voice-analyzed travel preferences now synchronize to an already-open preferences page.

### Changed

- Combined spoken destination and accessibility preferences in the single plan-page description field; removed the duplicate voice-entry section from travel settings.
- MTR navigation steps now state the transfer line, train direction, and alighting station instead of using a generic transfer caveat.

## 2026-10-16

### Added

- Optional Azure Speech TTS for Hong Kong Cantonese neural voices, using `zh-HK-HiuMaanNeural` and `zh-HK-WanLungNeural`.
- Backend-only Azure credentials and `POST /api/genai/speech`; repeated text/voice pairs reuse an in-memory audio cache.
- Azure playback for workflow guidance and map-demo navigation, with device speech retained when Azure is not configured.
- Native Android TTS integration using the device's `yue-HK` voice; Google Speech Services can be selected as the Android engine without a cloud TTS key.
- Chrome browser speech now requires an exact `yue-HK` voice and reports a clear install prompt instead of using another language; canceled speech no longer appears as a playback failure.

### Changed

- Navigation's read-aloud button now says「朗讀當前提示」.
- Browser speech fallback waits for Cantonese voices to load before reporting that none are available.
- Automatic step narration now reads only Qwen-generated or cached guidance, never the map's short step summary.
- Removed the explanatory auto-analysis timing note from the travel-needs panel; the existing 1.5-second text and 2-second voice auto-analysis behavior remains.
- Added voice entry for origin and destination: speech recognition sends the transcript to the existing Qwen location resolver and fills the selectors for user confirmation.
- Replaced expanding floor-button groups with a compact floor list selector in map views.
- Added `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` to `.env.example`; Azure credentials must stay on the backend.
