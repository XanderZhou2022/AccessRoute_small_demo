# Backend

Express + TypeScript. The backend shares schemas, the routing core, policies, and the route segmenter in `shared/` with the browser to keep frontend and backend algorithms consistent.

```bash
npm start
# Or start both the frontend and backend during development
npm run dev
```

The default address is `127.0.0.1:8787`. Configure `HOST`, `PORT`, `EVENT_FILE`, and `ALLOW_EVENT_WRITES` through environment variables. `.env.example` is a template and is not loaded automatically.

Capacitor Android builds load scene data and route locally, and call this API for Qwen workflows and HKO weather. Set `ACCESSROUTE_CORS_ORIGINS=https://localhost` for the Android WebView origin. CORS only controls browser access; it is not authentication. Do not expose this demo backend publicly without authentication and rate limiting.

| Method | Path                                           | Purpose                                                                                                                                                                                     |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`                                  | Health, version, and event-write status                                                                                                                                                     |
| GET    | `/api/scenes`                                  | Array of `SceneManifest` objects                                                                                                                                                            |
| GET    | `/api/scenes/:id`                              | Complete, validated `Scene`                                                                                                                                                                 |
| GET    | `/api/knowledge/:sceneId?q=name&level=levelId` | Wayfinding knowledge and text candidates, without calling a model                                                                                                                           |
| POST   | `/api/route`                                   | Route planning and segmentation                                                                                                                                                             |
| GET    | `/api/events`                                  | Read all demo events, including resolved events                                                                                                                                             |
| POST   | `/api/events`                                  | Create or replace an event by ID; resolve it with `status=resolved`                                                                                                                         |
| POST   | `/api/sessions`                                | Create a persistent journey session and return its ID                                                                                                                                       |
| GET    | `/api/sessions/:id`                            | Read session state and revision                                                                                                                                                             |
| GET    | `/api/sessions/:id/facilities`                 | Read facilities in the scenes at both ends of the journey                                                                                                                                   |
| POST   | `/api/sessions/:id/commands`                   | Submit a journey command with an operation ID and expected revision                                                                                                                         |
| GET    | `/api/sessions/:id/stream`                     | Stream initial and subsequent session states through SSE                                                                                                                                    |
| GET    | `/api/weather`                                 | Read current Hong Kong Observatory weather, forecasts, and warnings; cache successful responses for five minutes. Optional `latitude` and `longitude` parameters select nearby observations |

The `set_facility_event` session command affects only that journey and recalculates the remaining route in the current scene. If no feasible route exists, the response retains the original steps, sets `routeStatus: "no_route"`, and rejects subsequent `advance` commands. Restoring the facility triggers another calculation of the remaining route.

`/api/weather` uses territory-wide observations by default. When deployed on Vercel with the platform setting `VERCEL=1`, requests without GPS coordinates read the platform-generated `x-vercel-ip-country`, `x-vercel-ip-latitude`, and `x-vercel-ip-longitude` headers. These coordinates select nearby observations only when the country is HK and the coordinates fall within Hong Kong; otherwise, the API falls back to territory-wide data. Do not enable this setting on another deployment platform unless it overwrites or strips client-supplied headers with these names. IP-derived locations may be inaccurate. The app does not store raw IP addresses or location coordinates, although the hosting platform may process connection IPs under its own policies. Users may also explicitly allow browser GPS to request nearby observations; coordinates are used only for that request and are not persisted. Nearby stations use approximate coordinates as lookup anchors, not precise sensor coverage boundaries. If nearby HKO observations are unavailable, the API falls back to territory-wide values and indicates the scope.

GitHub Pages serves only the static frontend, without the Express API or platform coordinate headers. IP-based nearby weather requires a dynamic backend deployed on a platform that supplies the trusted headers described above. Territory-wide weather is used when location information is unavailable.

Route request:

```json
{
  "sceneId": "hysan-place",
  "from": "Use manifest.defaultStart",
  "to": "Use manifest.defaultEnd",
  "context": {
    "profile": "wheelchair",
    "rain": false,
    "strictAccessibility": false,
    "now": "2026-09-27T00:00:00Z",
    "events": []
  }
}
```

The response is `{ "route": RouteResult, "segments": RouteSegment[] }`. A route with `route.status = "no_route"` is a successful calculation result, not an HTTP 500 error. Invalid schemas or endpoints return 400; a missing scene returns 404.

Example event request:

```json
{
  "id": "demo-hysan-place-lift-a",
  "type": "facility_closed",
  "target": { "facilityId": "hysan-place-lift-a" },
  "status": "active",
  "validFrom": "2026-09-26T00:00:00Z",
  "source": "demo",
  "confidence": 1
}
```

The local server enables event writes; a non-loopback `HOST` automatically disables them. `createApp()` also defaults to read-only mode. Events accept only `source=demo`, with limits on JSON body size and browser Origin. Serialized writes and temporary-file renaming prevent data loss from concurrent writes within one process. Test instances without an `eventFile` use memory; the regular local server uses `data/runtime/events.json`.

Journey sessions also use serialized updates and atomic file replacement. The regular local server stores them in `data/runtime/sessions.json`; override the path with `SESSIONS_FILE`. Commands check revision conflicts and use operation IDs for idempotency. Creating or modifying sessions is rejected when `allowWrites` is disabled. SSE broadcasts only within a single Node process and does not support deployment across multiple instances. Before public deployment, add authentication, authorization, rate limiting, and persistence and pub/sub shared across processes.

In HTTP mode, the frontend loads scenes and accesses events through the API, while routes are still calculated in the browser using the shared core. `POST /api/route` exposes the same functionality to external clients or a future remote routing provider. This version does not poll for events from other clients; refresh to read external changes.

Production authentication, multi-user synchronization, and public writes are not included. To expose the full backend, run a read-only service on a trusted Node host, reverse-proxy the frontend's `/api` requests to it, and add production authentication for event writes.

## GenAI result validation

`POST /api/genai/validate` validates JSON results from the four agents and their scene references, returning `{status:"validated",applied:false,result}`. It does not persist results or control the browser. The frontend bridge validates context and route-segment freshness. See the [integration guide](../docs/genai-integration.md).

## GenAI workflows and layers

The four workflows are in `backend/workflows/`, HTTP routes in `backend/api/genai.ts`, and model transport in `backend/providers/qwen.ts`. Map HTTP routes are in `backend/api/map.ts`, and scene/event access is in `backend/repositories/`. `app.ts` only assembles dependencies and middleware.

See the [GenAI API guide](../docs/genai-integration.md) and [architecture guide](../docs/genai-architecture.md). Use `createApp({model, speech, landmarkRoot})` to inject test adapters or adapters for other providers.

### Azure Cantonese speech

Set the backend environment variables `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` to explicitly select Azure Speech's Hong Kong Cantonese neural voices. Keys remain on the backend. The default provider is local `canto-tts`; without Azure credentials, the service does not fall back to device/browser speech. `POST /api/genai/speech` accepts only the text to read and a voice selection, and returns MP3 or WAV audio.

### Self-hosted Hong Kong Cantonese speech

Use `canto-tts` to synthesize Cantonese WAV audio locally on the computer running AccessRoute, without a TTS API key. Python 3.10 or later is required. The first startup downloads model weights from Hugging Face:

```bash
python3 -m venv .venv-tts
source .venv-tts/bin/activate
python -m pip install -r services/requirements-tts.txt
npm run dev:canto-tts
```

The default TTS endpoint is `http://127.0.0.1:8000/synthesize`. Start the service above, then start or restart the AccessRoute backend; no `CANTO_TTS_URL` setting is required. The Node backend proxies audio to the phone. The TTS service binds only to `127.0.0.1`; the phone neither needs nor should have direct access to port 8000. Set `CANTO_TTS_URL` only when using a different endpoint. An explicitly configured endpoint takes priority over Azure.

The model currently provides one default voice, so male/female voice preferences do not change its output. Without Azure configuration, this self-hosted service is the default speech provider. Service failures return explicit errors rather than silently switching to another language. To use Azure instead, set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`.
