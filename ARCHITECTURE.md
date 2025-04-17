# YouTube Dubbing Project Architecture

This document outlines the architecture of the YouTube Dubbing application, covering both the mobile client (React Native with Expo) and the server (Next.js), with a focus on their interaction.

## 1. Overall Architecture

The project allows users to watch YouTube videos with dynamically generated, dubbed audio tracks using just-in-time transcription and TTS.

- **Project Structure:**
  - `mobile/`: Expo/React Native application (Client).
  - `server/`: Next.js backend (Orchestration, API, DB Interaction, Transcription Trigger, Translation Trigger, TTS Generation).
  - `youtube-download/`: Python FastAPI service (YouTube full audio download & upload).
  - `audio-segmenter/`: Python FastAPI service (Audio segment extraction & upload).
- **Technology Stack:**
  - **Mobile:** React Native, Expo, TypeScript, Jotai, Supabase Client, Expo Router, `react-native-webview`, `expo-av`.
  - **Server:** Next.js (App Router), TypeScript, Supabase (Auth & DB), `next-safe-action`, Zod, Replicate Client (Transcription), OpenAI Client (TTS), Anthropic Client (Translation).
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
  ├── hooks/            # useAuth.ts, useSettings.ts, useVideoSeekHandler.ts, ...
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
  - Manages `currentTime`, `playerState`, `videoDuration`, etc.
  - **New:** Manages buffering state (`isBuffering`, `bufferingReason`, `isManuallyPaused`).
  - Stores completed **original** transcription segments: `transcriptionSegments: Map<number, {id: string, content: SegmentData}>` (keyed by start time).
  - Stores **translated** segments: `translatedSegments: Map<string, Map<number, SegmentData>>` (keyed by language, then start time).
  - Stores generated audio chunk data: `generatedChunks: Map<string, { publicUrl: string }>`.
  - Tracks requested segment end times: `requestedTranscriptionEndTimes: Set<number>` (in `useVideoTranscription`).
  - Tracks translation status per segment/language: `segmentTranslationState: Map<string, { [lang]: status }>` (in `useVideoTranslation`).
  - Tracks the maximum time transcribed: `maxTranscribedTime: number` (in `useVideoTranscription`).
- **Settings Integration:** Uses `useSettings` for initial language/voice/volume.
- **Hook Integration:** Uses `useVideoDownload`, `useVideoTranscription`, `useVideoTranslation`, `useAudioGeneration`, `useAudioPlayback`, `useVideoHistory`, `useVideoProcessingStatus`, `useVideoSeekHandler`.
- **Initialization:**
  - Calls `startVideoProcessingApi` (initiates full audio download via `youtube-download` service).
  - Fetches any _pre-existing_ completed **original** transcription segments using `getCompletedTranscriptionSegmentsApi` (via `useVideoTranscription`).
  - Subscribes to Supabase Realtime channel for `transcription_segments` table updates for the current video (via `useVideoTranscription` and `useVideoTranslation`).
  - Calls `requestTranscriptionSegmentApi` on the Next.js server for the initial segment (e.g., 0-180s) (via `useVideoTranscription`). This action only _starts_ the transcription process and returns quickly.
  - If initial segments were fetched and the target language is not the source ('en'), calls `translateSegmentContentApi` for those segments (via `useVideoTranslation`).
- **Realtime Updates (`useVideoTranscription`, `useVideoTranslation`):** Listens to the Supabase Realtime channel (`transcription-segments-VIDEOID`).
  - On receiving an UPDATE event:
    - If `status = 'completed'` and `content` exists, updates the local `transcriptionSegments` map and `maxTranscribedTime`. If the target language is not the source ('en'), triggers `translateSegmentContentApi` for this newly completed segment.
    - If `translations` field exists and contains data for a language, updates the `translatedSegments` map and `segmentTranslationState`.
    - Checks `checkIfReadyToPlay` (in `useVideoTranslation`) to see if initial transcription and required translation are available to transition `translationLoadingState` to `ready`.
- **Time Update & Buffering (`checkBufferingStatus` - conceptually part of player/playback logic):**
  - Triggered by `currentTime` updates while playing.
  - Detects need for data (transcription, translation, audio) based on lookahead times.
  - **`checkBufferingStatus` Logic (Simplified View):**
    - Checks if transcription is available for `targetTime` (or slightly ahead) in `transcriptionSegments`.
    - If transcription needed (e.g., approaching `maxTranscribedTime`), triggers `requestNextTranscriptionSegment` early via `useVideoTranscription`'s lookahead.
    - Checks if translation is available for `targetTime` (or slightly ahead) in `translatedSegments` (or if language is 'en').
    - If translation needed (e.g., approaching lookahead boundary), triggers `triggerTranslation` via `useVideoTranslation`'s lookahead.
    - Checks if the corresponding audio chunk exists in `generatedChunks` (or is generating).
    - If audio chunk needed (e.g., approaching lookahead boundary), triggers `generateAndStoreAudioChunk` via `useAudioGeneration`'s lookahead.
    - If any required data is missing: Sets `isBuffering` to `true`, updates `bufferingReason` (internal state/debug), pauses the YouTube player (`playerRef.current.pauseVideo()`) and the dubbing audio (`useAudioPlayback` handles pause based on player state/buffering).
    - If all are available and `isBuffering` was true: Sets `isBuffering` to `false`, resumes the YouTube player (`playerRef.current.playVideo()`) only if it wasn't manually paused by the user.
- **Seek Handling (`useVideoSeekHandler`):**
  - `YouTubePlayer` component detects seeks (large `currentTime` jumps) and calls `onSeek` prop passed from `VideoPlayerScreen`.
  - `VideoPlayerScreen` calls `handleSeek(targetTime)` from the hook.
  - `handleSeek` function pauses the player, sets `isSeeking` state (shows overlay via `useVideoProcessingStatus`), and immediately calls `requestTranscriptionSegment` for the segment containing the `seekTargetTime`.
  - The hook starts polling `checkSeekCompletion`.
  - `checkSeekCompletion` verifies if transcription data exists (`transcriptionSegments`), translation is ready (`isTranslationReadyForTime`), and audio is ready (`isAudioChunkReady`) for the `seekTargetTime`.
  - Once all data is ready, it sets `isSeeking` to false (hides overlay), resumes the player (`playerRef.current.playVideo()`), and stops polling.
  - Includes a timeout to prevent indefinite seeking state.
- **Player State (`onStateChange` in `YouTubePlayer`):**
  - Relays state changes (`playing`, `paused`, `buffering`, etc.) to `VideoPlayerScreen`.
  - Used by `useAudioPlayback` to sync dubbing audio.
  - Used by `useVideoProcessingStatus` to display user-facing status.
- **Requesting Next Transcription Segment (`useVideoTranscription` Lookahead):** `useEffect` monitors `currentTime`.
  - When `currentTime` approaches `maxTranscribedTime` (minus a buffer), it calls `requestTranscriptionSegmentApi` for the _next_ time chunk.
- **Requesting Translation (`useVideoTranslation` Lookahead):** `useEffect` monitors `currentTime` and `transcriptionSegments`.
  - Identifies original transcription segments within `currentTime + TRANSLATION_LOOKAHEAD`.
  - If a segment needs translation for the `targetLanguage`, calls `translateSegmentContentApi`.
- **Audio Generation (`useAudioGeneration` Lookahead):** `useEffect` monitors `currentTime` and **`translatedSegments`**.
  - Finds translated text snippets needed within `currentTime + AUDIO_GENERATION_LOOKAHEAD_SECONDS`.
  - Calls `generateAudioChunkApi` for required snippets based on start/end times, language, and voice.
- **Audio Playback (`useAudioPlayback`):** Finds the **translated** segment for the current `language` that `currentTime` falls within.
  - Uses `expo-av` to manage loading and playing the specific audio chunk URL (from `generatedChunks`) corresponding to the target sentence, applying `dubbingVolume`.
  - Pauses/resumes playback based on `playerState` and `isBuffering`.
- **Language/Voice Changes:**
  - Resets relevant state (e.g., `generatedChunks`, potentially `translatedSegments` for the old language).
  - Triggers necessary API calls for the new language/voice (translation via lookahead, audio generation via lookahead).
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
  │   │   ├── openai/                     # OpenAI client setup
  │   │   └── anthropic/                  # Anthropic client setup (Added)
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
  - **Modified:** `transcription_segments` table now includes a `translations` JSONB column (stores translated `ReplicateSegmentOutput` keyed by language code).
  - **Added:** `translated_audio_chunks` (stores TTS output path linked to absolute text segment times, language, and voice).
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
  - `translateSegmentContent` (Protected): Fetches the original `content` from `transcription_segments` for a given `segmentId`. Calls the **Anthropic API** to translate the text to the `targetLanguage`, maintaining timing format. Parses the Anthropic response. Updates the `translations` JSONB column in the `transcription_segments` record with the translated content keyed by `targetLanguage`.
  - `generateAudioChunk` (Protected): Fetches the relevant `transcription_segments` record(s). Extracts the **translated text** for the specified `language` from the `translations` column, based on the absolute `startTime` and `endTime`. Calls OpenAI TTS with the translated text and `voice`. Uploads resulting audio to `translated-audio` bucket, saves record to `translated_audio_chunks` table, returns signed URL.
  - `updateHistory` (Protected): Unchanged.
  - `toggleFavorite` (Protected): Unchanged.
  - `getFavoriteStatus` (Protected): Unchanged.
  - `getCompletedTranscriptionSegments` (Protected): Fetches all currently completed segments for a video (original transcriptions).

### 3.4. API Routes

- **`/api/actions/[...actionName]/route.ts`:** Handles calls from mobile app for server actions.
- **`/api/webhooks/replicate/route.ts`:**
  - Handles Replicate completion webhook (`POST`).
  - Verifies webhook signature (using `REPLICATE_WEBHOOK_SECRET`).
  - Finds corresponding record in `transcription_segments` using `replicate_prediction_id` from the payload.
  - **Adjusts timestamps** in the received transcription content (adds segment's `start_time` to make them absolute).
  - Updates the `transcription_segments` record status to `completed` and saves the adjusted content in the `content` column.
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

## 6. Communication Flow (Transcription + Translation + TTS)

1.  **Mobile App -> Server API:** User starts video -> `callServerAction('video/startVideoProcessing')` -> Server calls `youtube-download` service.
2.  **`youtube-download` -> Supabase:** Uploads full audio, updates `download_jobs`.
3.  **Mobile App -> Server API:** On video load/after download -> `callServerAction('video/requestTranscriptionSegment', { videoId, startTime: 0, endTime: 180 })`.
4.  **Server -> Audio Segmenter API:** Server calls `POST /segment-transcribe`.
5.  **Audio Segmenter -> Supabase:** Downloads full audio, runs `ffmpeg`, uploads audio segment file.
6.  **Audio Segmenter -> Server:** Returns `{ segment_storage_path: '...' }`.
7.  **Server -> Supabase Storage:** Server gets signed URL for the audio segment.
8.  **Server -> Replicate API:** Server calls `replicate.predictions.create` with signed URL and webhook URL.
9.  **Server -> Supabase:** Server updates `transcription_segments` record (status: processing, stores Replicate ID).
10. **Server -> Mobile App:** `requestTranscriptionSegment` action returns success quickly.
11. **Replicate -> Server Webhook:** Replicate finishes -> POSTs result to `/api/webhooks/replicate`.
12. **Server (Webhook):** Verifies signature, finds segment record, **adjusts timestamps**, updates `transcription_segments` (status: completed, stores adjusted `content`).
13. **Supabase -> Mobile App (Realtime):** DB change triggers Realtime -> Mobile receives completed **original** segment -> Updates `transcriptionSegments` map & `maxTranscribedTime`.
14. **Mobile App (Translation Trigger):** If selected `language` != source ('en'), Mobile triggers `callServerAction('video/translateSegmentContent', { segmentId, targetLanguage: currentLanguage })` (often via lookahead logic in `useVideoTranslation`).
15. **Server -> Anthropic API:** `translateSegmentContent` action calls Anthropic with formatted original text.
16. **Server -> Supabase:** Action parses response and updates `translations` column in `transcription_segments` for the `segmentId`.
17. **Supabase -> Mobile App (Realtime):** DB change triggers Realtime -> Mobile receives updated segment with data in `translations` field -> Updates `translatedSegments` map & `segmentTranslationState`. -> Calls `checkIfReadyToPlay` (in `useVideoTranslation`).
18. **Mobile App (Playback):** Watches `currentTime`. `useVideoTranslation`'s `checkIfReadyToPlay` may transition `translationLoadingState` to `ready`.
19. **Mobile App -> Server API (TTS):** As needed (based on lookahead in **translated** segments via `useAudioGeneration`) -> `callServerAction('video/generateAudioChunk', { videoId, lang: currentLanguage, voice, startTime, endTime })`.
20. **Server -> Supabase:** Finds relevant **translated** text from `transcription_segments` (`translations` column).
21. **Server -> OpenAI API:** Calls TTS with extracted **translated** text and selected `voice`.
22. **Server -> Supabase:** Uploads TTS audio to `translated-audio`, inserts record in `translated_audio_chunks`.
23. **Server -> Mobile App:** Returns signed URL for the TTS chunk.
24. **Mobile App:** Plays TTS audio chunk using `expo-av` (managed by `useAudioPlayback`).
25. **Mobile App (Next Segment Trigger):** When `currentTime` nears `maxTranscribedTime` (or other lookahead boundaries are crossed), hooks automatically trigger requests for the next transcription segment (step 3), translation (step 14), and audio generation (step 19).
26. **Mobile App (Seek):**
    - User seeks in `YouTubePlayer`.
    - `onSeek` callback triggers `handleSeek` in `useVideoSeekHandler`.
    - Handler pauses player, shows overlay (`isSeeking` state), calls `requestTranscriptionSegment` (step 3) for the target time's segment.
    - Realtime/polling updates (managed by hooks and seek handler polling) trigger translation (step 14) and TTS (step 19) for the seek target time range.
    - Seek handler polling (`checkSeekCompletion`) detects when transcription data, translation, and audio are ready for the target time.
    - Handler hides overlay (`isSeeking = false`), resumes player.

## 7. TODOs / Pending Items

- **Fix Linter Errors:** Resolve remaining type comparison errors in `mobile/app/video/[id].tsx`.
- **Refine Seek Completion Check:** Improve robustness of checks in `useVideoSeekHandler` (especially audio readiness).
- **Regenerate Supabase Types:** Update `database.types.ts` in both `server` and `mobile` projects if schema changed recently.
- **Testing:** Perform end-to-end testing of the transcription -> translation -> TTS workflow, including seek functionality.
- Implement Mobile UI elements (e.g., improved scrubbing/progress bar feedback).
- Implement webhook signature verification (`REPLICATE_WEBHOOK_SECRET`).
- Review/configure Supabase Storage policies.
- Review/improve logging across all services.
- Confirm `pg_cron` cleanup jobs are configured and running.
