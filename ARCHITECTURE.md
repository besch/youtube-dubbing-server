# YouTube Dubbing Project Architecture

This document outlines the architecture of the YouTube Dubbing application, covering both the mobile client (React Native with Expo) and the server (Next.js), with a focus on their interaction.

## 1. Overall Architecture

The project allows users to watch YouTube videos with dubbed audio tracks generated via a **backend-driven processing pipeline**.

- **Project Structure:**
  - `mobile/`: Expo/React Native application (Client).
  - `server/`: Next.js backend (API, DB Interaction, Orchestration Trigger, Job Status Management).
  - `youtube-download/`: Python FastAPI service (YouTube full audio download & upload).
  - `server/supabase/functions/`: Deno Edge Functions for orchestrating backend processing steps (e.g., `on-download-complete`).
  - **DEPRECATED:** `audio-segmenter/`: Python FastAPI service (No longer needed with full audio transcription).
- **Technology Stack:**
  - **Mobile:** React Native, Expo, TypeScript, Jotai, Supabase Client, Expo Router, `react-native-webview`, `expo-av`.
  - **Server:** Next.js (App Router), TypeScript, Supabase (Auth, DB, Functions), `next-safe-action`, Zod, Replicate Client (Transcription), OpenAI Client (TTS), Anthropic Client (Translation).
  - **Downloader:** Python, FastAPI, `yt-dlp`, `supabase-py`.
  - **Supabase Functions:** Deno, TypeScript, Supabase Client.
  - **Styling (Mobile):** React Native `StyleSheet`.

## 2. Mobile App Architecture (`mobile/`)

### 2.1. Core Structure

- **Expo Managed Workflow.**
- **Directory Structure:** (Largely unchanged, `types/supabase.ts` should be synced with server).
  ```
  mobile/
  ├── app/              # Routes ((tabs), video, onboarding, _layout.tsx)
  ├── assets/
  ├── components/
  ├── constants/
  ├── hooks/            # useAuth.ts, useSettings.ts, useVideoSeekHandler.ts, useVideoProcessingStatus.ts, ...
  ├── lib/              # API layer (api.ts)
  ├── store/            # Jotai state (index.ts, authAtom.ts)
  ├── types/            # Shared types (actions.ts, serverActions.ts, supabase.ts - sync with server!)
  ├── utils/            # Supabase client (supabase.ts), auth utils
  └── ...
  ```
- **Navigation:** Expo Router.
- **State Management:** Jotai (`authAtom`), local component state (`VideoPlayerScreen`), `useVideoProcessingStatus`.

### 2.2. Authentication Flow

- Uses Supabase Auth, Google/Apple Sign-In via native SDKs, `signInWithIdToken`.
- `onAuthStateChange` listener in `_layout.tsx` manages session persistence (AsyncStorage) and Jotai state (`authAtom`).
- **API Calls (`lib/api.ts`):** `callServerAction` helper sends session token for authenticated requests.

### 2.3. Video Player & Backend-Driven Processing

- **State Handling (`app/video/[id].tsx`):**
  - Manages `currentTime`, `playerState`, `videoDuration`.
  - Tracks the overall backend processing status via `videoProcessingStatus` state, updated by `useVideoProcessingStatus`.
  - Stores **completed** transcription segments (`transcriptionSegments`) fetched via `useVideoTranscription`.
  - Stores **completed** translated segments (`translatedSegments`) fetched via `useVideoTranslation`.
  - Stores **completed** generated audio chunk data (`generatedChunks`) fetched via `useAudioGeneration`.
  - **REMOVED:** No longer tracks requested segment end times or translation status per segment actively.
- **Settings Integration:** Uses `useSettings` for initial language/voice/volume selections.
- **Hook Integration:**
  - `useVideoProcessingStatus`: Central hook to interpret `videos.processing_status`, player state, and errors to provide user-facing status messages and loading indicators.
  - `useVideoTranscription`: Fetches existing completed segments, subscribes to Realtime updates for _newly completed_ segments. **Does not trigger transcription.**
  - `useVideoTranslation`: Fetches/manages translated segments based on Realtime updates to `transcription_segments.translations`. **Does not trigger translation.**
  - `useAudioGeneration`: Fetches existing completed audio chunks, subscribes to Realtime updates for _newly completed_ chunks. **Does not trigger audio generation.**
  - `useAudioPlayback`: Plays available pre-generated audio chunks based on `currentTime`.
  - `useVideoSeekHandler`: Checks for the _existence_ of required data (transcription, translation, audio) at the seek target time.
  - `useVideoHistory`, `useAuth`, `useSettings` (Largely unchanged).
- **Initialization:**
  - Calls `initiateVideoProcessingJobApi` on the server, providing the YouTube URL and desired language/voice combinations. This triggers the entire backend pipeline if necessary.
  - Subscribes to Supabase Realtime channel for `videos` table updates (specifically `processing_status` column) for the current `dbVideoId` (via `useVideoProcessingStatus` or directly).
  - Subscribes to `transcription_segments` and `audio_chunks` Realtime channels to receive newly completed data (via respective hooks).
  - Fetches any pre-existing completed data using `getCompletedTranscriptionSegmentsApi` and `getCompletedAudioChunksApi` (via hooks).
- **Realtime Updates:**
  - Primarily listens to `videos` table for changes in `processing_status` to update the UI state via `useVideoProcessingStatus`.
  - Listens to `transcription_segments` and `audio_chunks` channels to populate local data (`transcriptionSegments`, `translatedSegments`, `generatedChunks`) as it becomes available from the backend process.
- **Buffering:** Primarily handled by `useVideoProcessingStatus` based on the backend status (`generating_audio`, `transcribing`, etc.) and player state. The app waits for the backend to make data available.
- **Seek Handling (`useVideoSeekHandler`):**
  - `YouTubePlayer` detects seek -> `onSeek` prop -> `handleSeek(targetTime)`.
  - `handleSeek` pauses player, sets `isSeeking` state (shows overlay).
  - **No longer calls `requestTranscriptionSegment`.**
  - Hook polls `checkSeekCompletion`.
  - `checkSeekCompletion` verifies if transcription data (`transcriptionSegments`), translation (`isTranslationReadyForTime`), and audio (`isAudioChunkReady`) _already exist_ for the `seekTargetTime`.
  - Once data exists, sets `isSeeking` false, resumes player, stops polling.
- **Player State (`onStateChange`):** Relays state to `VideoPlayerScreen`. Used by `useAudioPlayback` and `useVideoProcessingStatus`.
- **REMOVED:** No client-side lookahead logic for triggering transcription, translation, or audio generation.
- **Audio Playback (`useAudioPlayback`):**
  - Finds the completed audio chunk (from `generatedChunks`) corresponding to `currentTime`.
  - Uses `expo-av` to load and play the chunk URL.
  - Pauses/resumes/syncs rate based on `playerState`.
- **Language/Voice Changes:**
  - When user selects a new language/voice:
    - Checks if the `processing_status` for the new combination indicates completion or ongoing processing.
    - If not processed, calls `initiateVideoProcessingJobApi` again for the _new_ target language/voice combination.
    - Resets local state (`generatedChunks`, `translatedSegments`) for the new target.
    - Fetches any existing completed data for the new target via hooks.
- **History/Favorites:** Unchanged API calls (`updateHistoryApi`, `toggleFavoriteApi`, `getFavoriteStatusApi`).

### 2.4. Settings Management (`app/(tabs)/settings.tsx`)

- Unchanged.

## 3. Server Architecture (`server/`)

### 3.1. Core Structure

- **Next.js App Router.**
- **Directory Structure:** Added `/api/internal` route.
  ```
  server/
  ├── src/
  │   ├── app/
  │   │   ├── api/
  │   │   │   ├── actions/[...actionName]/ # Client-facing actions
  │   │   │   │   └── route.ts
  │   │   │   ├── internal/              # Internal actions (called by Supabase Functions)
  │   │   │   │   └── trigger-action/
  │   │   │   │       └── route.ts
  │   │   │   └── webhooks/              # External webhooks (Replicate)
  │   │   ├── actions/                   # Server action definitions
  │   │   ├── (app)/
  │   │   └── layout.tsx
  │   ├── lib/                           # Supabase, Replicate, OpenAI, Anthropic clients
  │   ├── types/
  │   └── ...
  ├── public/
  ├── supabase/                          # Supabase Functions source code
  │   └── functions/
  │       ├── on-download-complete/
  │       │   └── index.ts
  │       ├── on-transcription-complete/ # Example name
  │       │   └── index.ts
  │       └── on-audio-chunk-complete/   # Example name
  │           └── index.ts
  ├── .env.local
  └── schema.sql
  ```

### 3.2. Supabase Integration

- **Clients:** Unchanged.
- **Database:**
  - `videos` table now includes `processing_status` JSONB column to track status per language/voice (e.g., `{ "es_nova": { "status": "completed", "progress": 100 } }`).
  - `transcription_segments` table stores completed transcriptions and potentially translations populated by the backend.
  - `translated_audio_chunks` stores completed TTS chunks.
  - Other tables (`profiles`, `download_jobs`, `favorites`, `history`) remain.
- **Realtime:** Enabled on `videos` (for `processing_status`), `transcription_segments`, `translated_audio_chunks`.
- **Storage:**
  - `youtube-audio`: Stores full original audio.
  - **DEPRECATED:** `transcription-segments`: No longer needed if transcribing full audio. Bucket can be removed.
  - `translated-audio`: Stores generated TTS audio chunks.
- **Functions:** Deno Edge Functions triggered by database webhooks (or direct invocation) orchestrate the processing pipeline.

### 3.3. Server Actions (`app/actions/`)

- **Framework:** `next-safe-action`.
- **Setup:** Unchanged.
- **Error Handling:** Unchanged.
- **Implemented Actions (`video.ts` - Client-Facing):**
  - `initiateVideoProcessingJob` (Protected): The main entry point from the client. Checks existing status, finds/creates video record, potentially triggers download job, updates `processing_status`.
  - `getCompletedTranscriptionSegments` (Protected): Fetches completed original transcription segments.
  - `getCompletedAudioChunks` (Protected): Fetches completed audio chunks for a specific language/voice.
  - `updateHistory` (Protected): Unchanged.
  - `toggleFavorite` (Protected): Unchanged.
  - `getFavoriteStatus` (Protected): Unchanged.
  - `getFavorites` (Protected): Unchanged.
  - `getHistory` (Protected): Unchanged.
  - `getSuggestedVideos` (Protected): Unchanged.
  - `translateVideoTitle` (Protected): Unchanged.
- **Internal Actions (Potentially called by Supabase Functions via `/api/internal`):**
  - Actions related to triggering transcription, translation, TTS are now likely internal logic within the backend or specific server actions _not_ directly exposed/called by the mobile client during playback. (e.g., an internal `triggerTranscription`, `triggerTranslation`, `triggerTTS`).

### 3.4. API Routes

- **`/api/actions/[...actionName]/route.ts`:** Handles calls from the mobile app for _client-facing_ server actions.
- **`/api/internal/trigger-action/route.ts`:** Secured endpoint (using `FUNCTION_SECRET`) for Supabase Functions to invoke specific server actions (e.g., trigger the next step in the processing pipeline).
- **`/api/webhooks/replicate/route.ts`:** Handles Replicate completion webhook. Updates `transcription_segments` table. May trigger the _next step_ in the backend processing via a Supabase Function or internal call.

### 3.5. Supabase Functions (`supabase/functions/`)

- **Purpose:** Orchestrate the backend processing steps, triggered by database changes or external webhooks.
- **Examples:**
  - `on-download-complete`: Triggered when `download_jobs` status becomes `completed`. Fetches audio path, calls an internal server action (via `/api/internal`) to start transcription (e.g., call Replicate). Updates `videos.processing_status`.
  - `on-transcription-complete`: Triggered by Replicate webhook (which might update `transcription_segments` status). Fetches transcription, calls internal server action to trigger translation (if needed) and TTS generation for segments/chunks. Updates `videos.processing_status`.
  - `on-audio-chunk-complete`: Triggered when a row is inserted/updated in `translated_audio_chunks`. Updates `videos.processing_status` (progress, potential completion).

## 4. Downloader Service (`youtube-download/`)

- Unchanged conceptually, but its completion now triggers the `on-download-complete` Supabase Function.

## 5. Audio Segmenter Service (`audio-segmenter/`)

- **DEPRECATED/REMOVED:** This service is likely no longer required if transcription happens on the full audio file downloaded by `youtube-download`. The server/transcription service handles the full audio directly.

## 6. Communication Flow (Backend-Driven Processing)

1.  **Mobile App -> Server API:** User selects video/language/voice -> `callServerAction('video/initiateVideoProcessingJob', { youtubeUrl, processingTargets: { 'es_nova': {...} } })`.
2.  **Server:** Checks `videos.processing_status`. If needed, creates/updates video record, inserts `download_jobs` record (status: pending), updates `videos.processing_status` (e.g., `{ "es_nova": { "status": "pending" } }`). Returns `{ videoId, initialProcessingStatus }`.
3.  **Server -> Downloader Service:** Triggers download via POST request.
4.  **Mobile App (Realtime):** Subscribes to `videos` table for `videoId`. Receives initial `processing_status` update. Displays "Preparing..." via `useVideoProcessingStatus`.
5.  **Downloader Service -> Supabase:** Downloads audio, uploads to `youtube-audio` bucket, updates `download_jobs` status to `completed` and sets `storage_path`, **updates `videos` table with audio `duration`**.
6.  **Supabase Trigger -> Supabase Function (`on-download-complete`):** Triggered by `download_jobs` update.
7.  **Supabase Function -> Server API (`/api/internal`):** Calls internal action `triggerTranscription` with `videoId` and audio path. Updates `videos.processing_status` (e.g., `{ "es_nova": { "status": "transcribing" } }`).
8.  **Mobile App (Realtime):** Receives `processing_status` update -> Displays "Transcribing...".
9.  **Server (Internal Action):** Calls Replicate API with full audio URL and webhook. Updates DB (e.g., links Replicate job to video).
10. **Replicate -> Server Webhook (`/api/webhooks/replicate`):** Replicate finishes -> POSTs result.
11. **Server (Webhook):** Verifies signature, processes transcription, updates `transcription_segments` table (status: completed, stores content).
12. **Supabase Trigger -> Supabase Function (`on-transcription-complete` - Example):** Triggered by `transcription_segments` update.
13. **Supabase Function -> Server API (`/api/internal`):** Calls internal actions `triggerTranslation` (if lang != 'en') and `triggerTTS`. Updates `videos.processing_status` (e.g., `{ "es_nova": { "status": "generating_audio" } }`).
14. **Mobile App (Realtime):** Receives `processing_status` update -> Displays "Generating Audio...". Listens for completed `transcription_segments` / `translated_audio_chunks` via separate Realtime subscriptions to populate local data maps.
15. **Server (Internal Actions):** Calls Anthropic for translation (updates `transcription_segments.translations`), calls OpenAI/Google TTS for chunks, uploads audio to `translated-audio`, inserts records into `translated_audio_chunks`.
16. **Supabase Trigger -> Supabase Function (`on-audio-chunk-complete`):** Triggered by `translated_audio_chunks` inserts/updates.
17. **Supabase Function:** Calculates progress based on completed chunks vs. video duration. Updates `videos.processing_status` with progress. If all chunks are done, sets status to `completed`.
18. **Mobile App (Realtime):** Receives `processing_status` updates (progress, eventual completion). Plays available audio chunks via `useAudioPlayback` as `currentTime` advances.
19. **Mobile App (Seek):**
    - User seeks.
    - `handleSeek` pauses player, sets `isSeeking`.
    - `checkSeekCompletion` polls until `transcriptionSegments`, `translatedSegments` (via `isTranslationReadyForTime`), and `generatedChunks` (via `isAudioChunkReady`) contain the necessary data for the `seekTargetTime`.
    - Once data exists, `isSeeking` becomes false, player resumes.

## 7. TODOs / Pending Items

- **Implement Supabase Functions:** Define and implement `on-download-complete`, `on-transcription-complete`, `on-audio-chunk-complete` (and potentially others).
- **Define Internal Server Actions:** Create actions within `server/src/app/actions/` specifically for triggering transcription, translation, TTS, to be called by Supabase Functions.
- **Secure Internal API:** Ensure `/api/internal/trigger-action` route is properly secured using `FUNCTION_SECRET`.
- **Refine Status Updates:** Ensure `videos.processing_status` is updated correctly at each stage by the backend/functions.
- **Refine Completion Check:** Implement robust logic in the backend (likely within Supabase Functions or triggered actions) to determine when _all_ necessary audio chunks for a language/voice are generated before marking `processing_status` as `completed`.
- **Refine Seek Completion Check:** Ensure `useVideoSeekHandler` reliably checks for the _existence_ of pre-generated data.
- **Remove `audio-segmenter`:** Deprecate and remove the service and related calls if full audio transcription is confirmed. Update storage bucket usage.
- **Regenerate Supabase Types:** Update `database.types.ts` in `server` and `mobile` after schema changes (adding `processing_status`).
- **Testing:** Thoroughly test the end-to-end backend processing flow and client interaction.
- **Error Handling:** Implement robust error handling within the backend pipeline (e.g., setting `failed` status in `processing_status` with error messages).
- Review/configure Supabase Storage policies.
- Review/improve logging across all services.
