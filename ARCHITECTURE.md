# YouTube Dubbing Project Architecture

This document outlines the architecture of the YouTube Dubbing application, covering both the mobile client (React Native with Expo) and the server (Next.js), with a focus on their interaction.

## 1. Overall Architecture

The project allows users to watch YouTube videos with dynamically generated, dubbed audio tracks using just-in-time transcription and TTS.

- **Project Structure:**
  - `mobile/`: Expo/React Native application (Client).
  - `server/`: Next.js backend (Orchestration, API, DB Interaction, Transcription Trigger, TTS Generation).
  - `youtube-download/`: Python FastAPI service (YouTube full audio download & upload).
  - `audio-segmenter/`: Python FastAPI service (Audio segment extraction & upload).
- **Technology Stack:**
  - **Mobile:** React Native, Expo, TypeScript, Jotai, Supabase Client, Expo Router, `react-native-youtube-iframe`, `expo-av`.
  - **Server:** Next.js (App Router), TypeScript, Supabase (Auth & DB), `next-safe-action`, Zod, Replicate Client (Transcription), OpenAI Client (TTS).
  - **Downloader:** Python, FastAPI, `yt-dlp`, `supabase-py`.
  - **Segmenter:** Python, FastAPI, `ffmpeg`, `supabase-py` (Deployed on Google Cloud Run).
  - **Styling (Mobile):** React Native `StyleSheet`.

## 2. Mobile App Architecture (`mobile/`)

### 2.1. Core Structure

- **Expo Managed Workflow.**
- **Directory Structure:**
  ```
  mobile/
  ├── app/              # Routes ((tabs), video, onboarding, _layout.tsx)
  ├── assets/
  ├── components/
  ├── constants/
  ├── hooks/            # useAuth.ts, useSettings.ts
  ├── lib/              # API layer (api.ts)
  ├── store/            # Jotai state (index.ts, authAtom.ts)
  ├── types/            # Shared types (actions.ts, serverActions.ts, supabase.ts - copy)
  ├── utils/            # Supabase client (supabase.ts), auth utils
  └── ...
  ```
- **Navigation:** Expo Router.
- **State Management:** Jotai (`authAtom`), local component state (`VideoPlayerScreen`).

### 2.2. Authentication Flow

- Uses Supabase Auth, Google/Apple Sign-In via native SDKs, `signInWithIdToken`.
- `onAuthStateChange` listener in `_layout.tsx` manages session persistence (AsyncStorage) and Jotai state (`authAtom`).
- **API Calls (`lib/api.ts`):** `callServerAction` helper retrieves the session token (`supabase.auth.getSession`) and sends it in the `Authorization: Bearer <token>` header for authenticated requests to the Next.js backend. Requires `userId` for some actions.

### 2.3. Video Player & On-the-Fly Audio Generation (Asynchronous/Webhook Flow)

- **State Handling (`app/video/[id].tsx`):**
  - Manages `loadingState`, `currentTime`, `playerState`, etc.
  - Stores completed transcription segments: `transcriptionSegments: Map<number, SegmentData>` (keyed by start time).
  - Tracks requested segment end times: `requestedSegmentEndTimes: Set<number>`.
  - Tracks the maximum time transcribed: `maxTranscribedTime: number`.
- **Settings Integration:** Uses `useSettings` for initial language/voice/volume.
- **Initialization:**
  - Calls `startVideoProcessingApi` (initiates full audio download via `youtube-download` service).
  - Fetches any _pre-existing_ completed transcription segments for the video from Supabase using `getCompletedTranscriptionSegmentsApi`.
  - Subscribes to Supabase Realtime channel for `transcription_segments` table updates for the current video.
  - Calls `requestTranscriptionSegmentApi` on the Next.js server for the initial segment (e.g., 0-180s). This action only _starts_ the process and returns quickly.
- **Realtime Updates:** Listens to the Supabase Realtime channel (`transcription-segments-VIDEOID`).
  - On receiving an UPDATE event where `status = 'completed'`, it calls a handler (`processCompletedSegment`) to update the local `transcriptionSegments` map and `maxTranscribedTime`.
- **Requesting Next Segment:** `useEffect` monitors `currentTime`.
  - When `currentTime` approaches `maxTranscribedTime` (minus a buffer), it calls `requestTranscriptionSegmentApi` on the Next.js server for the _next_ time chunk (e.g., 180-360s), adding the end time to `requestedSegmentEndTimes`. The actual data arrives later via Realtime.
- **Audio Generation (TTS Trigger):** `manageAudioGeneration` looks ahead in the combined `transcriptionSegments` data.
  - Finds the text corresponding to `currentTime + LOOKAHEAD_SECONDS`.
  - Calls `generateAudioChunkApi` on the Next.js server, passing the _absolute_ start/end times of the required text snippet.
- **Audio Playback:** `manageAudioPlayback` uses `expo-av` to play the specific audio chunk URL returned by `generateAudioChunkApi`, applying `dubbingVolume`.
- **Language/Voice Changes:** Clears relevant state (`generatedChunks`), re-checks favorites, may need to re-trigger TTS generation for the current segment.
- **History/Favorites:** Calls `updateHistoryApi`, `toggleFavoriteApi`/`getFavoriteStatusApi`.

### 2.4. Settings Management (`app/(tabs)/settings.tsx`)

- **UI:** Allows users to set default language, voice, dubbing volume, and original video volume using selectors and sliders (`@react-native-community/slider`).
- **Persistence:** Uses `useSettings` hook to fetch current settings and `updateSettings` function (which calls Supabase via the hook) to save changes to the user's profile in the database.

## 3. Server Architecture (`server/`)

### 3.1. Core Structure

- **Next.js App Router.**
- **Directory Structure:**
  ```
  server/
  ├── src/
  │   ├── app/
  │   │   ├── api/
  │   │   │   ├── actions/
  │   │   │   │   └── [...actionName]/   # Dynamic API route handler
  │   │   │   │       └── route.ts
  │   │   │   └── webhooks/               # Webhook handlers (e.g., Replicate)
  │   │   ├── actions/                    # Server action definitions (safe-action.ts, actions.ts, video.ts)
  │   │   ├── (app)/                      # UI Routes/Pages (If any)
  │   │   └── layout.tsx
  │   ├── lib/
  │   │   ├── supabase/                   # Supabase client configurations
  │   │   ├── replicate/                  # Replicate client setup
  │   │   └── openai/                     # OpenAI client setup
  │   ├── types/                        # Global TS types (supabase.ts - generated)
  │   └── ...
  ├── public/
  ├── .env.local
  ├── next.config.ts
  ├── tsconfig.json
  ├── package.json
  └── schema.sql
  ```

### 3.2. Supabase Integration

- **Clients (`lib/supabase/`):**
  - `client.ts`: Browser client (anon key).
  - `serverClient.ts`: Server components/actions needing cookie-based auth (used by `createSupabaseServerClient`).
  - `serviceRoleClient.ts`: Backend admin tasks (service role key).
- **Database:** Schema in `schema.sql`.
  - **Added:** `transcription_segments` table (stores individual segment status, content with _absolute_ timestamps, Replicate prediction ID).
  - **Added:** `translated_audio_chunks` (stores TTS output path linked to absolute text segment times).
  - Other tables (`profiles`, `videos`, `download_jobs`, `favorites`, `history`) remain.
- **Realtime:** Enabled on `transcription_segments` table, used by mobile app.
- **Storage:**
  - `youtube-audio`: Stores full original audio (written by `youtube-download`).
  - `transcription-segments`: Stores extracted audio segments (written by `audio-segmenter`, read by Next.js server for Replicate).
  - `translated-audio`: Stores generated TTS audio chunks (written by Next.js server, read by mobile app).

### 3.3. Server Actions (`app/actions/`)

- **Framework:** `next-safe-action`.
- **Setup (`safe-action.ts`):**
  - `publicAction`: Unauthenticated actions.
  - `protectedAction`: **Requires authentication**. Middleware reads `Authorization: Bearer <token>` header and validates via `supabase.auth.getUser(token)`.
  - Centralized error handling (`handleServerError`).
- **Error Handling (`actions.ts`):** `AppErrorCode`, `AppError`, `appErrors`, `ActionResponse<T>`.
- **Implemented Actions (`video.ts` - Asynchronous Flow):**
  - `startVideoProcessing` (Protected): Initiates full download via `youtube-download` service.
  - `requestTranscriptionSegment` (Protected): Calls `audio-segmenter` service to get segment path, gets signed URL, calls **`replicate.predictions.create`** with a webhook URL, updates `transcription_segments` DB record (pending -> processing, stores Replicate ID). Returns quickly.
  - `generateAudioChunk` (Protected): Finds required text from completed `transcription_segments` based on absolute time range, calls OpenAI TTS, uploads resulting audio to `translated-audio` bucket, saves record to `translated_audio_chunks` table, returns signed URL.
  - `updateHistory` (Protected): Unchanged.
  - `toggleFavorite` (Protected): Unchanged.
  - `getFavoriteStatus` (Protected): Unchanged.
  - `getCompletedTranscriptionSegments` (Protected): Fetches all currently completed segments for a video.

### 3.4. API Routes

- **`/api/actions/[...actionName]/route.ts`:** Handles calls from mobile app for server actions.
- **`/api/webhooks/replicate/route.ts`:**
  - Handles Replicate completion webhook (`POST`).
  - Verifies webhook signature (using `REPLICATE_WEBHOOK_SECRET`).
  - Finds corresponding record in `transcription_segments` using `replicate_prediction_id` from the payload.
  - **Adjusts timestamps** in the received transcription content (adds segment's `start_time` to make them absolute).
  - Updates the `transcription_segments` record status to `completed` and saves the adjusted content.
  - Sends Realtime update via Supabase trigger.

## 4. Downloader Service (`youtube-download/`)

- **Framework:** Python FastAPI.
- **Functionality:**
  - Exposes a `/process` endpoint (POST).
  - Accepts `youtube_url` and `job_id`.
  - Initializes Supabase client using `SUPABASE_SERVICE_ROLE_KEY`.
  - **Updates `download_jobs` table status:**
    - Sets status to 'processing'.
    - Downloads audio using `yt-dlp`.
    - Uploads audio to `youtube-audio` bucket. Schedules cleanup.
    - Updates job status to 'completed' with `storage_path`.
    - Updates job status to 'failed' with `error_message` on failure.
  - Returns simple JSON response.

## 5. Audio Segmenter Service (`audio-segmenter/`)

- **Framework:** Python FastAPI.
- **Deployment:** Google Cloud Run (`europe-west1`).
- **URL:** `https://audio-segmenter-service-550129149777.europe-west1.run.app` (`AUDIO_SEGMENTER_URL`)
- **Functionality:**
  - Exposes `/segment-transcribe` endpoint (POST), secured by `X-API-Key` (`AUDIO_SEGMENTER_SECRET_KEY`).
  - Accepts `video_id`, `start_time`, `end_time`.
  - Fetches full audio path from `download_jobs`.
  - Downloads full audio from `youtube-audio` bucket.
  - Extracts segment using `ffmpeg`.
  - Uploads the segment file to `transcription-segments` bucket.
  - Returns the `segment_storage_path` to the caller (Next.js server).

## 6. Communication Flow (Asynchronous/Webhook Flow)

1.  **Mobile App -> Server API:** User starts video -> `callServerAction('video/startVideoProcessing')` -> Server calls `youtube-download` service.
2.  **`youtube-download` -> Supabase:** Uploads full audio, updates `download_jobs`.
3.  **Mobile App -> Server API:** On video load/after download -> `callServerAction('video/requestTranscriptionSegment', { videoId, startTime: 0, endTime: 180 })`.
4.  **Server -> Audio Segmenter API:** Server calls `POST https://audio-segmenter-service-.../segment-transcribe` with times & API key.
5.  **Audio Segmenter -> Supabase:** Downloads full audio, runs `ffmpeg`, uploads segment file to `transcription-segments` bucket.
6.  **Audio Segmenter -> Server:** Returns `{ segment_storage_path: '...' }`.
7.  **Server -> Supabase Storage:** Server gets signed URL for the audio segment.
8.  **Server -> Replicate API:** Server calls **`replicate.predictions.create`** with the signed URL and webhook URL.
9.  **Server -> Supabase:** Server updates `transcription_segments` record (status: processing, stores Replicate ID).
10. **Server -> Mobile App:** `requestTranscriptionSegment` action returns success quickly.
11. **Replicate -> Server Webhook:** Replicate finishes -> POSTs result to `/api/webhooks/replicate`.
12. **Server (Webhook):** Verifies signature, finds segment record, **adjusts timestamps**, updates `transcription_segments` (status: completed, stores adjusted content).
13. **Supabase -> Mobile App (Realtime):** DB change triggers Realtime -> Mobile receives completed segment -> Calls `processCompletedSegment` -> Updates `transcriptionSegments` map and `maxTranscribedTime`.
14. **Mobile App (Playback):** Watches `currentTime`.
15. **Mobile App -> Server API (TTS):** As needed -> `callServerAction('video/generateAudioChunk', { videoId, lang, voice, startTime, endTime })`.
16. **Server -> Supabase:** Finds relevant text from `transcription_segments`.
17. **Server -> OpenAI API:** Calls TTS with extracted text.
18. **Server -> Supabase:** Uploads TTS audio to `translated-audio`, inserts record in `translated_audio_chunks`.
19. **Server -> Mobile App:** Returns signed URL for the TTS chunk.
20. **Mobile App:** Plays TTS audio chunk.
21. **Mobile App (Next Segment Trigger):** When `currentTime` nears `maxTranscribedTime`, go back to step 3 for the _next_ time range.

## 7. TODOs / Pending Items

- Ensure `supabase.ts` types file is correctly copied/placed in `mobile/types/`.
- Add UI for language/voice selection in mobile.
- Refine audio loading/playback in mobile for seamless transitions.
- Implement robust logging across services.
- Configure Supabase Storage policies properly.
- Set up `pg_cron` for cleanup jobs (confirm it's running).
- Implement webhook signature verification.
