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

- **Purpose:** Orchestrate the backend processing steps, triggered by database changes (via `supabase_functions.http_request` in DB triggers) or external webhooks.
- **Examples:**
  - `on-download-complete`: Triggered by `download_jobs` update (status -> `completed`). Fetches video duration, updates `videos.processing_status` (for relevant targets) to `transcribing`, and calls the internal action `internalRequestTranscriptionSegment` to trigger the **first** transcription segment request (e.g., 0-180s).
  - `on-transcription-complete`: Triggered by `transcription_segments` update (status -> `completed` OR `translations` field changes).
    - Processes the completed segment: Calls `internalTranslateSegmentContent` (if needed) and `internalGenerateAudioChunk` for the time range of the _completed_ segment.
    - **Triggers the next step:** If the segment completion was for the original transcription (`status` changed to `completed`) and the segment's `end_time` is less than the video's total `duration`, it calls `internalRequestTranscriptionSegment` again to request the **next** time chunk (e.g., requests 180-360s after 0-180s completes). This creates the sequential processing chain.
    - Updates `videos.processing_status` based on actions initiated (e.g., to `translating` or `generating_audio`).
  - `on-audio-chunk-complete`: Triggered by `translated_audio_chunks` inserts. Updates `videos.processing_status` (calculates progress based on completed chunks vs. video duration). If all chunks for a language/voice are determined to be complete, it sets the status to `completed`.

## 4. Downloader Service (`youtube-download/`)

- Unchanged conceptually, but its completion now triggers the `on-download-complete` Supabase Function.

## 5. Audio Segmenter Service (`audio-segmenter/`)

- **DEPRECATED/REMOVED:** This service is no longer required. The new backend processing flow handles audio segmentation based on time intervals during the sequential transcription process, managed by Supabase Functions (`on-download-complete`, `on-transcription-complete`) and the `internalRequestTranscriptionSegment` server action. The original full audio downloaded by `youtube-download` is used directly.

## 6. Communication Flow (Backend-Driven Processing)

1.  **Mobile App -> Server API:** User selects video/language/voice -> `callServerAction('video/initiateVideoProcessingJob', { youtubeUrl, processingTargets: { 'es_nova': {...} } })`.
2.  **Server (`initiateVideoProcessingJob`):** Checks `videos.processing_status`. If needed, creates/updates video record, inserts `download_jobs` record (status: pending), updates `videos.processing_status` (e.g., `{ "es_nova": { "status": "pending" } }`). Returns `{ videoId, initialProcessingStatus }`.
3.  **Server -> Downloader Service:** Triggers download via POST request.
4.  **Mobile App (Realtime):** Subscribes to `videos` table for `videoId`. Receives initial `processing_status` update. Displays "Preparing..." via `useVideoProcessingStatus`.
5.  **Downloader Service -> Supabase:** Downloads audio, uploads to `youtube-audio` bucket, updates `download_jobs` status to `completed`, sets `storage_path`, updates `videos` table with audio `duration`.
6.  **Supabase Trigger (`trigger_on_download_complete`) -> Supabase Function (`on-download-complete`):** Triggered by `download_jobs` update.
7.  **`on-download-complete` Function:** Updates `processing_status` to `transcribing` for relevant targets. Calls internal action `internalRequestTranscriptionSegment` via `/api/internal` to request transcription for the **first segment** (e.g., 0-180s).
8.  **Mobile App (Realtime):** Receives `processing_status` update (`transcribing`) -> Displays "Transcribing...".
9.  **Server (`internalRequestTranscriptionSegment`):** Gets audio segment URL, calls Replicate API for transcription of that segment, updates `transcription_segments` table (links Replicate ID, status: `processing`).
10. **Replicate -> Server Webhook (`/api/webhooks/replicate`):** Replicate finishes -> POSTs result for the segment.
11. **Server (Webhook):** Verifies signature, processes transcription result for the segment, updates the corresponding `transcription_segments` row (status: `completed`, stores `content`).
12. **Supabase Trigger (`trigger_on_transcription_complete` / `trigger_on_transcription_translation_update`) -> Supabase Function (`on-transcription-complete`):** Triggered by the `transcription_segments` update.
13. **`on-transcription-complete` Function:**
    - **Processes current segment:** Calls `internalTranslateSegmentContent` (if needed) and `internalGenerateAudioChunk` via `/api/internal` for the time range of the _just completed_ segment (e.g., 0-180s). Updates `processing_status` (e.g., to `translating` or `generating_audio`).
    - **Triggers next segment:** If the segment just completed (`status` changed) and its `end_time` < `videoDuration`, it calls `internalRequestTranscriptionSegment` again for the _next_ time range (e.g., 180-360s).
14. **Mobile App (Realtime):** Receives `processing_status` updates (`translating`, `generating_audio`...). Listens for newly completed `transcription_segments` / `translated_audio_chunks` via separate Realtime subscriptions to populate local data maps.
15. **Server (Internal Actions - `internalTranslateSegmentContent`, `internalGenerateAudioChunk`):** Performs translation (updates `translations` field), generates TTS audio, uploads to `translated-audio`, inserts records into `translated_audio_chunks`.
16. **Supabase Trigger (`trigger_on_audio_chunk_insert`) -> Supabase Function (`on-audio-chunk-complete`):** Triggered by `translated_audio_chunks` inserts.
17. **`on-audio-chunk-complete` Function:** Calculates progress based on completed chunks vs. video duration. Updates `videos.processing_status` with progress. If all chunks are done, sets status to `completed`.
18. **Mobile App (Realtime):** Receives `processing_status` updates (progress, eventual completion). Plays available audio chunks via `useAudioPlayback` as `currentTime` advances.
19. **Mobile App (Seek):**
    - User seeks.
    - `handleSeek` pauses player, sets `isSeeking`.
    - `checkSeekCompletion` polls until `transcriptionSegments`, `translatedSegments` (via `isTranslationReadyForTime`), and `generatedChunks` (via `isAudioChunkReady`) contain the necessary data for the `seekTargetTime`.
    - Once data exists, `isSeeking` becomes false, player resumes.

## 7. TODOs / Pending Items

- **Refine Supabase Functions:** Review and test the implemented logic in `on-download-complete`, `on-transcription-complete`, `on-audio-chunk-complete`.
- **Review Internal Server Actions:** Ensure `videoInternal.ts` actions are robust.
- **Error Handling:** Improve error handling and status updates (`failed` status) within the backend pipeline (Supabase Functions, Server Actions).
- **Remove `audio-segmenter`:** Service is removed. Ensure all related code/references are cleaned up. Update storage bucket policies if needed (remove `transcription-segments` bucket if unused).
- **Regenerate Supabase Types:** Update `database.types.ts` in `server` and `mobile` after schema changes (adding `processing_status`).
- **Testing:** Thoroughly test the end-to-end backend processing flow and client interaction.
- **Error Handling:** Improve error handling and status updates (`failed` status) within the backend pipeline (Supabase Functions, Server Actions).
- Review/configure Supabase Storage policies.
- Review/improve logging across all services.
