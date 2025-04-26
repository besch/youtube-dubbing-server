# YouTube Dubbing Project Architecture

This document outlines the architecture of the YouTube Dubbing application, covering both the mobile client (React Native with Expo) and the server (Next.js), with a focus on their interaction.

## 1. Overall Architecture

The project allows users to watch YouTube videos with dubbed audio tracks generated via a **backend-driven processing pipeline**.

- **Project Structure:**
  - `mobile/`: Expo/React Native application (Client).
  - `server/`: Next.js backend (API, DB Interaction, Orchestration Trigger, Job Status Management).
  - `youtube-download/`: Python FastAPI service (YouTube full audio download & upload).
  - `server/supabase/functions/`: Deno Edge Functions for orchestrating backend processing steps (e.g., `on-download-complete`, `on-transcription-complete`, `on-translation-complete`).
  - **REMOVED:** `audio-segmenter/`: Python FastAPI service (No longer needed with full audio transcription).
- **Technology Stack:**
  - **Mobile:** React Native, Expo, TypeScript, Jotai, Supabase Client, Expo Router, `react-native-webview`, `expo-av`.
  - **Server:** Next.js (App Router), TypeScript, Supabase (Auth, DB, Functions), `next-safe-action`, Zod, Replicate Client (Transcription), OpenAI Client (TTS), Google Cloud Text-to-Speech Client, Anthropic Client (Translation).
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
  - Stores **completed** transcription segments (`transcriptionSegments` - from the single row) fetched via `useVideoTranscription`.
  - Stores **completed** translated segments (`translatedSegments`) fetched via `useVideoTranslation` (populated based on the single transcription row's `translations` field).
  - Stores **completed** generated audio chunk data (`generatedChunks`) fetched via `useAudioGeneration`.
  - **REMOVED:** No longer tracks requested segment end times or translation status per segment actively.
- **Settings Integration:** Uses `useSettings` for initial language/voice/volume selections.
- **Hook Integration:**
  - `useVideoProcessingStatus`: Central hook to interpret `videos.processing_status` (including new statuses like `transcribing_full`, `translating_full`), player state, and errors to provide user-facing status messages and loading indicators.
  - `useVideoTranscription`: Fetches the existing completed **single** transcription row, subscribes to Realtime updates for that row. **Does not trigger transcription.**
  - `useVideoTranslation`: Fetches/manages translated segments based on Realtime updates to the single `transcription_segments.translations` field. **Does not trigger translation.**
  - `useAudioGeneration`: Manages the `generatedChunks` state. **Does not trigger audio generation.** Chunks are fetched via `fetchAudioChunks` when the backend status for the language/voice combination is detected as 'completed'. **REMOVED:** Realtime listening for individual chunk inserts within the hook.
  - `useAudioPlayback`: Plays available pre-generated audio chunks based on `currentTime`.
  - `useVideoSeekHandler`: Checks for the _existence_ of required data (from the single transcription row's `content` or `translations`, and `generatedChunks`) at the seek target time.
  - `useVideoHistory`, `useAuth`, `useSettings` (Largely unchanged).
- **Initialization:**
  - Calls `initiateVideoProcessingJobApi` on the server, providing the YouTube URL and desired language/voice combinations. This triggers the entire backend pipeline if necessary.
  - Subscribes to Supabase Realtime channel for `videos` table updates (specifically `processing_status` column) for the current `dbVideoId` (via `useVideoProcessingStatus` or directly).
  - Subscribes to `transcription_segments` (for the single row) Realtime channel to receive newly completed transcription/translation data.
  - **REMOVED:** Subscription to `translated_audio_chunks` Realtime channel within `useAudioGeneration`.
  - Fetches any pre-existing completed data using `getCompletedTranscriptionSegmentsApi` (for the single row) and `getCompletedAudioChunksApi`. The audio chunk fetch is triggered when the `videoProcessingStatus` for the current language/voice is detected as `completed` (either on initial load or through a Realtime update).
- **Realtime Updates:**
  - Primarily listens to `videos` table for changes in `processing_status` to update the UI state via `useVideoProcessingStatus`. This 'completed' status update also triggers the fetch of audio chunks.
  - Listens to the single `transcription_segments` row Realtime channel to populate local data (`transcriptionSegments`, `translatedSegments`).
  - **REMOVED:** The app no longer directly populates `generatedChunks` via a Realtime subscription to `translated_audio_chunks` within the hook.
- **Buffering:** Primarily handled by `useVideoProcessingStatus` based on the backend status (`generating_audio`, `transcribing_full`, `translating_full`, etc.) and player state. The app waits for the backend to make data available.
- **Seek Handling (`useVideoSeekHandler`):**
  - `YouTubePlayer` detects seek -> `onSeek` prop -> `handleSeek(targetTime)`.
  - `handleSeek` pauses player, sets `isSeeking` state (shows overlay).
  - **No longer calls `requestTranscriptionSegment`.**
  - Hook polls `checkSeekCompletion`.
  - `checkSeekCompletion` verifies if transcription data (from the single row `transcriptionSegments`), translation (`isTranslationReadyForTime` - checking the single row), and audio (`isAudioChunkReady` - checking `generatedChunks`) _already exist_ for the `seekTargetTime`.
  - Once data exists, sets `isSeeking` false, resumes player, stops polling.
- **Player State (`onStateChange`):** Relays state to `VideoPlayerScreen`. Used by `useAudioPlayback` and `useVideoProcessingStatus`.
- **REMOVED:** No client-side lookahead logic for triggering transcription, translation, or audio generation.
- **Audio Playback (`useAudioPlayback`):**
  - Finds the completed audio chunk (from `generatedChunks`) corresponding to `currentTime`.
  - Uses `expo-av` to load and play the chunk URL.
  - Pauses/resumes/syncs rate based on `playerState`.
  - **Note:** Seek tolerance adjusted previously.
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
- **Directory Structure:** Added `/api/internal` route, added `on-translation-complete`.
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
  │   │   ├── actions/                   # Server action definitions (video.ts, videoInternal.ts)
  │   │   ├── (app)/
  │   │   └── layout.tsx
  │   ├── lib/                           # Supabase, Replicate, OpenAI, Google TTS, Anthropic clients
  │   ├── types/
  │   └── ...
  ├── public/
  ├── supabase/                          # Supabase Functions source code
  │   └── functions/
  │       ├── on-download-complete/
  │       │   └── index.ts
  │       ├── on-transcription-complete/
  │       │   └── index.ts
  │       ├── on-translation-complete/   # Handles completion of translation step
  │       │   └── index.ts
  │       └── on-audio-chunk-complete/   # Optional: For fine-grained progress tracking
  │           └── index.ts
  ├── .env.local
  └── schema.sql
  ```

### 3.2. Supabase Integration

- **Clients:** Unchanged.
- **Database:**
  - `videos` table includes `processing_status` JSONB column to track status per language/voice (e.g., `{ "es_nova": { "status": "generating_audio", "progress": 0, "last_updated": "..." } }`). Valid statuses: `pending`, `downloading`, `transcribing_full`, `translating_full`, `generating_audio`, `completed`, `failed`.
  - `transcription_segments` table **now stores one row per video** containing the full transcription (`content` field) and all its translations (`translations` field, e.g., `{ "es": { "segments": [...] } }`).
  - `translated_audio_chunks` stores completed TTS chunks (one per original sub-segment).
  - Other tables (`profiles`, `download_jobs`, `favorites`, `history`) remain.
- **Realtime:** Enabled on `videos` (for `processing_status`), `transcription_segments` (single row updates), `translated_audio_chunks`.
- **Storage:**
  - `youtube-audio`: Stores full original audio.
  - **REMOVED:** `transcription-segments` bucket is no longer used.
  - `translated-audio`: Stores generated TTS audio chunks.
- **Functions:** Deno Edge Functions triggered by database webhooks orchestrate the processing pipeline by calling internal Next.js actions.

### 3.3. Server Actions (`app/actions/`)

- **Framework:** `next-safe-action`.
- **Setup:** Unchanged.
- **Error Handling:** Unchanged.
- **Client-Facing Actions (`video.ts`):**
  - `initiateVideoProcessingJob` (Protected): Main entry point. Checks `processing_status`, finds/creates video, potentially triggers download, updates `processing_status`.
  - `getCompletedTranscriptionSegments` (Protected): Fetches the single completed transcription row for a video.
  - `getCompletedAudioChunks` (Protected): Fetches all completed audio chunks for a specific language/voice.
  - `updateHistory`, `toggleFavorite`, `getFavoriteStatus`, `getFavorites`, `getHistory`, `getSuggestedVideos`, `translateVideoTitle` (Protected): Unchanged.
- **Internal Actions (`videoInternal.ts` - Called by Supabase Functions):**
  - `internalRequestFullTranscription`: Called by `on-download-complete`. Gets full audio URL, starts Replicate job, updates the single `transcription_segments` row (status: `processing`).
  - `internalTranslateFullContent`: Called by `on-transcription-complete` (for non-English). Translates the entire `content` field, updates the `translations` field in the single `transcription_segments` row.
  - `internalGenerateAudioChunk`: Called by `on-translation-complete` (for initial chunks) or directly by the client via `generateAudioChunk` action. Takes details for a specific sub-segment (start/end time), extracts text from the full `content` or `translations`, calls TTS API (OpenAI/Google), uploads chunk, inserts record into `translated_audio_chunks`.

### 3.4. API Routes

- **`/api/actions/[...actionName]/route.ts`:** Handles calls from the mobile app for _client-facing_ server actions.
- **`/api/internal/trigger-action/route.ts`:** Secured endpoint (using `FUNCTION_SECRET`) for Supabase Functions to invoke internal server actions (`internalRequestFullTranscription`, `internalTranslateFullContent`, `internalGenerateAudioChunk`).
- **`/api/webhooks/replicate/route.ts`:** Handles Replicate completion webhook. Updates the **single** `transcription_segments` row for the video (status: `completed`, stores full `content`). This update triggers the `on-transcription-complete` function.

### 3.5. Supabase Functions (`supabase/functions/`)

- **Purpose:** Orchestrate the backend processing steps, triggered by database changes or webhooks. They primarily act as controllers, calling internal Next.js actions to perform the actual work.
- **Implementation Details:**
  - `on-download-complete` (Triggered by `download_jobs` status -> `completed`):
    - Fetches video duration, updates `videos.processing_status` (for relevant targets) to `transcribing_full`.
    - Calls `internalRequestFullTranscription` via `/api/internal` to trigger transcription for the **entire** audio file.
  - `on-transcription-complete` (Triggered by `transcription_segments` update: `status` -> `completed`):
    - Reads the completed `content` field from the updated row.
    - Iterates through target languages in `videos.processing_status` that are in the `transcribing_full` state.
    - For **English** targets:
      - Updates `processing_status` to `generating_audio`. **Does not trigger audio generation automatically.** Audio chunks must be requested on-demand by the client.
    - For **non-English** targets:
      - Updates `processing_status` to `translating_full`.
      - Calls `internalTranslateFullContent` via `/api/internal` **once** for the entire transcription content and the target language.
  - `on-translation-complete` (Triggered by `transcription_segments` update: `translations` field changes):
    - Identifies which language(s) were newly added/updated in the `translations` field.
    - For each updated language, finds corresponding targets in `videos.processing_status` that are in the `translating_full` state.
    - For each matching target:
      - Updates `processing_status` to `generating_audio`.
      - Reads the translated sub-segments for that language.
      - Calls `internalGenerateAudioChunk` via `/api/internal` **for each translated sub-segment where `end_time <= 60` seconds** (parallel triggers for the first minute). Subsequent chunks must be requested on-demand by the client.
  - `on-audio-chunk-complete` (Optional: Triggered by `translated_audio_chunks` inserts):
    - Can be used to calculate fine-grained progress for the `generating_audio` step.
    - Fetches total expected sub-segments (from `transcription_segments.content` or `translations`).
    - Counts completed chunks for the specific video/language/voice.
    - Updates `videos.processing_status` with progress percentage (based on total expected chunks).
    - If count matches total expected, sets `processing_status` to `completed`.

## 4. Downloader Service (`youtube-download/`)

- Unchanged conceptually, but its completion now triggers the `on-download-complete` Supabase Function.

## 5. Audio Segmenter Service (`audio-segmenter/`)

- **REMOVED:** This service is no longer required. The new backend processing flow transcribes the entire audio file at once. Supabase Functions (`on-transcription-complete`, `on-translation-complete`) trigger TTS for individual sub-segments derived from the full transcription/translation.

## 6. Communication Flow (Backend-Driven Processing - Full Transcription)

1.  **Mobile App -> Server API:** User selects video/language/voice -> `callServerAction('video/initiateVideoProcessingJob', { youtubeUrl, processingTargets: { 'es_nova': {...}, 'en_alloy': {...} } })`.
2.  **Server (`initiateVideoProcessingJob`):** Checks `videos.processing_status`. If needed, creates/updates video record, inserts `download_jobs` record (status: pending), updates `videos.processing_status` (e.g., `{ "es_nova": { "status": "pending" }, "en_alloy": { "status": "pending" } }`). Returns `{ videoId, initialProcessingStatus }`.
3.  **Server -> Downloader Service:** Triggers download via POST request.
4.  **Mobile App (Realtime):** Subscribes to `videos` table for `videoId`. Receives `processing_status` updates. Displays "Preparing..." via `useVideoProcessingStatus`.
5.  **Downloader Service -> Supabase:** Downloads audio, uploads to `youtube-audio` bucket, updates `download_jobs` status to `completed`, sets `storage_path`, updates `videos` table with audio `duration`.
6.  **Supabase Trigger (`trigger_on_download_complete`) -> Supabase Function (`on-download-complete`):** Triggered by `download_jobs` update.
7.  **`on-download-complete` Function:** Updates relevant targets in `processing_status` to `transcribing_full`. Calls internal action `internalRequestFullTranscription` via `/api/internal`.
8.  **Mobile App (Realtime):** Receives `processing_status` update (`transcribing_full`) -> Displays "Processing audio...".
9.  **Server (`internalRequestFullTranscription`):** Gets full audio URL, calls Replicate API for transcription, updates the **single** `transcription_segments` row (links Replicate ID, status: `processing`).
10. **Replicate -> Server Webhook (`/api/webhooks/replicate`):** Replicate finishes -> POSTs full transcription result.
11. **Server (Webhook):** Verifies signature, processes transcription result, updates the **single** `transcription_segments` row (status: `completed`, stores full `content`).
12. **Supabase Trigger (`trigger_on_transcription_status_complete`) -> Supabase Function (`on-transcription-complete`):** Triggered by the `transcription_segments` status update.
13. **`on-transcription-complete` Function:**
    - Finds targets in `transcribing_full` state.
    - **For English targets:** Updates status to `generating_audio`. **No automatic audio generation.** Client needs to request chunks using `generateAudioChunk` action.
    - **For Non-English targets:** Updates status to `translating_full`. Triggers `internalTranslateFullContent` (via API) **once** per target language.
14. **Mobile App (Realtime):** Receives `processing_status` updates (`translating_full`, `generating_audio`...). Listens for updates to the single `transcription_segments` row. When `processing_status` for the target lang/voice becomes `completed`, it can fetch all completed audio chunks. **Client is now responsible for requesting audio chunks beyond the initial pre-generated ones using `generateAudioChunk`.**
15. **Server (`internalTranslateFullContent`):** Translates text, updates the `translations` field in the single `transcription_segments` row.
16. **Supabase Trigger (`trigger_on_transcription_translation_update`) -> Supabase Function (`on-translation-complete`):** Triggered by the `translations` field update.
17. **`on-translation-complete` Function:**
    - Finds targets in `translating_full` state matching the updated language.
    - Updates status to `generating_audio`.
    - Triggers `internalGenerateAudioChunk` (via API) **in parallel** for translated sub-segments **where `end_time <= 60`**.
18. **Server (`internalGenerateAudioChunk` / Client Action `generateAudioChunk`):** Receives request for a sub-segment (either from `on-translation-complete` or client). Extracts text (original or translated), calls TTS (OpenAI/Google), uploads chunk, inserts record into `translated_audio_chunks`.
19. **(Optional) Supabase Trigger (`trigger_on_audio_chunk_insert`) -> Supabase Function (`on-audio-chunk-complete`):** Updates `processing_status` progress/completion based on chunk count vs. total expected count.
20. **Mobile App (Realtime):** Receives `processing_status` updates (progress, eventual completion). Fetches initially generated chunks. Plays available audio chunks via `useAudioPlayback`. **When approaching the end of available audio, triggers `generateAudioChunk` action for the next required segment(s).**
21. **Mobile App (Seek):**
    - User seeks.
    - `handleSeek` pauses player, sets `isSeeking`.
    - `checkSeekCompletion` polls until the single `transcription_segments` row's data (`content` or `translations`) is available **AND** the necessary `generatedChunks` contain the audio data for the `seekTargetTime`. **If audio chunk is missing, `handleSeek` (or a related mechanism) needs to trigger `generateAudioChunk` action for the required segment.**
    - Once data exists, `isSeeking` becomes false, player resumes.

## 7. TODOs / Pending Items

- **Refine Supabase Functions:** Review and test logic in `on-download-complete`, `on-transcription-complete`, `on-translation-complete`, `on-audio-chunk-complete` (if implemented).
- **Review Internal Server Actions:** Ensure `videoInternal.ts` actions (`internalRequestFullTranscription`, `internalTranslateFullContent`, `internalGenerateAudioChunk`) are robust and handle errors correctly.
- **Error Handling:** Improve error handling throughout the backend pipeline (Supabase Functions, Server Actions). Ensure `failed` status is set appropriately in `processing_status`.
- **Regenerate Supabase Types:** Update `database.types.ts` in `server` and `mobile` to reflect latest schema.
- **Testing:** Thoroughly test the end-to-end backend processing flow (full transcription -> translation -> TTS) and client interaction.
- Review/configure Supabase Storage policies.
- Review/improve logging across all services.
- **Client-Side Logic:** Implement client-side logic in the mobile app to:
  - Request audio chunks on-demand using the `generateAudioChunk` action when playback nears the end of available chunks.
  - Request audio chunks on-demand during seek operations if the target time's chunk hasn't been generated yet.
