# YouTube Dubbing Project Architecture

This document outlines the architecture of the YouTube Dubbing application, covering both the mobile client (React Native with Expo) and the server (Next.js), with a focus on their interaction.

## 1. Overall Architecture

The project allows users to watch YouTube videos with dubbed audio tracks generated via a **backend-driven processing pipeline**.

- **Project Structure:**
  - `mobile/`: Expo/React Native application (Client).
  - `server/`: Next.js backend (API, DB Interaction, Orchestration Trigger, Job Status Management).
  - `youtube-download/`: Python FastAPI service (YouTube full audio download, SRT subtitle download/processing & upload).
  - `server/supabase/functions/`: Deno Edge Functions for orchestrating backend processing steps (e.g., `on-download-complete`, `on-transcription-complete`, `on-translation-complete`).
- **Technology Stack:**
  - **Mobile:** React Native, Expo, TypeScript, Jotai, Supabase Client, Expo Router, `react-native-webview`, `expo-av`.
  - **Server:** Next.js (App Router), TypeScript, Supabase (Auth, DB, Functions), `next-safe-action`, Zod, Replicate Client (Transcription), OpenAI Client (TTS), Google Cloud Text-to-Speech Client, Anthropic Client (Translation).
  - **Downloader:** Python, FastAPI, `yt-dlp`, `supabase-py`.
  - **Supabase Functions:** Deno, TypeScript, Supabase Client.
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
- **Settings Integration:** Uses `useSettings` for initial language/voice/volume selections.
- **Hook Integration:**
  - `useVideoProcessingStatus`: Central hook to interpret `videos.processing_status` (including new statuses like `transcribing_full`, `translating_full`), player state, and errors to provide user-facing status messages and loading indicators.
  - `useVideoTranscription`: Fetches the existing completed **single** transcription row, subscribes to Realtime updates for that row.
  - `useVideoTranslation`: Fetches/manages translated segments based on Realtime updates to the single `transcription_segments.translations` field.
  - `useAudioGeneration`: Manages the `generatedChunks` state. Chunks are fetched via `fetchAudioChunks` when the backend status for the language/voice combination is detected as 'completed'.
  - `useAudioPlayback`: Plays available pre-generated audio chunks based on `currentTime`.
  - `useVideoSeekHandler`: Checks for the _existence_ of required data (from the single transcription row's `content` or `translations`, and `generatedChunks`) at the seek target time.
  - `useVideoHistory`, `useAuth`, `useSettings`.
- **Initialization:**
  - Calls `initiateVideoProcessingJobApi` on the server, providing the YouTube URL and desired language/voice combinations.
  - Subscribes to Supabase Realtime channel for `videos` table updates (specifically `processing_status` column) for the current `dbVideoId`.
  - Subscribes to `transcription_segments` (for the single row) Realtime channel to receive newly completed transcription/translation data.
  - Fetches any pre-existing completed data using `getCompletedTranscriptionSegmentsApi` and `getCompletedAudioChunksApi`.
- **Realtime Updates:**
  - Primarily listens to `videos` table for changes in `processing_status` to update the UI state via `useVideoProcessingStatus`.
  - Listens to the single `transcription_segments` row Realtime channel to populate local data (`transcriptionSegments`, `translatedSegments`).
- **Buffering:** Primarily handled by `useVideoProcessingStatus` based on the backend status and player state.
- **Seek Handling (`useVideoSeekHandler`):**
  - `YouTubePlayer` detects seek -> `onSeek` prop -> `handleSeek(targetTime)`.
  - `handleSeek` pauses player, sets `isSeeking` state (shows overlay).
  - Hook polls `checkSeekCompletion`.
  - `checkSeekCompletion` verifies if transcription data, translation, and audio _already exist_ for the `seekTargetTime`.
  - Once data exists, sets `isSeeking` false, resumes player, stops polling.
- **Player State (`onStateChange`):** Relays state to `VideoPlayerScreen`. Used by `useAudioPlayback` and `useVideoProcessingStatus`.
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
- **History/Favorites:** API calls (`updateHistoryApi`, `toggleFavoriteApi`, `getFavoriteStatusApi`).

### 2.4. Settings Management (`app/(tabs)/settings.tsx`)

- Unchanged.

## 3. Server Architecture (`server/`)

### 3.1. Core Structure

- **Next.js App Router.**
- **Directory Structure:**
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
  │   │   │   │
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
  │       └── on-audio-chunk-complete/   # Handles completion of TTS step
  │           └── index.ts
  ├── .env.local
  └── schema.sql
  ```

### 3.2. Supabase Integration

- **Clients:** Unchanged.
- **Database:**
  - `videos` table includes `processing_status` JSONB column to track status per language/voice (e.g., `{ "es_nova": { "status": "generating_audio", "progress": 0, "last_updated": "..." } }`). Valid statuses: `pending`, `downloading`, `transcribing_full`, `translating_full`, `generating_audio`, `completed`, `failed`.
    - **Atomic Updates:** A new SQL function `update_processing_status(video_uuid uuid, status_key text, status_value jsonb)` is used by server actions and Supabase functions to update individual language/voice keys within the `processing_status` JSONB field atomically, preventing race conditions.
  - `transcription_segments` table **now stores one row per video** containing the full transcription (`content` field) and all its translations (`translations` field, e.g., `{ "es": { "segments": [...] } }`).
  - `translated_audio_chunks` stores completed TTS chunks (one per original sub-segment).
  - Other tables (`profiles`, `download_jobs`, `favorites`, `history`) remain.
- **Realtime:** Enabled on `videos` (for `processing_status`), `transcription_segments` (single row updates), `translated_audio_chunks`.
- **Storage:**
  - `youtube-audio`: Stores full original audio.
  - `translated-audio`: Stores generated TTS audio chunks.
- **Functions:** Deno Edge Functions triggered by database webhooks orchestrate the processing pipeline by calling internal Next.js actions.

### 3.3. Server Actions (`app/actions/`)

- **Framework:** `next-safe-action`.
- **Setup:** Unchanged.
- **Error Handling:** Unchanged.
- **Client-Facing Actions (`video.ts`):**
  - `initiateVideoProcessingJob` (Protected): Main entry point.
    - Checks/creates the video record.
    - **Re-fetches** the video state (including `processing_status`) immediately after creation/lookup to get the latest status before proceeding.
    - Checks prerequisites (download, transcription, translation) based on the fetched state.
    - Determines the correct initial status for newly requested language/voice targets.
    - Uses the `update_processing_status` **RPC function** to atomically update the status for each new/updated target.
    - **Re-fetches** the status _again_ after attempting updates to ensure trigger decisions are based on the _committed_ state.
    - Triggers downstream actions (download, transcription, translation, TTS spawn) only if necessary based on the committed status.
    - Returns the video ID and the final committed processing status.
  - `getCompletedTranscriptionSegments` (Protected): Fetches the single completed transcription row for a video.
  - `getCompletedAudioChunks` (Protected): Fetches all completed audio chunks for a specific language/voice.
  - `updateHistory`, `toggleFavorite`, `getFavoriteStatus`, `getFavorites`, `getHistory`, `getSuggestedVideos`, `translateVideoTitle` (Protected): Unchanged.
- **Internal Actions (`videoInternal.ts` - Called by Supabase Functions):**
  - `internalRequestFullTranscription`: Called by `on-download-complete`. Gets full audio URL, starts Replicate job, updates the single `transcription_segments` row (status: `processing`).
  - `internalTranslateFullContent`: Called by `on-transcription-complete` (for non-English). Translates the entire `content` field, updates the `translations` field in the single `transcription_segments` row.
  - `internalGenerateAudioChunk`: Called by `internalSpawnTtsJobs`. Takes details for a specific sub-segment (start/end time), extracts text from the full `content` or `translations`, calls TTS API (OpenAI/Google), uploads chunk, inserts record into `translated_audio_chunks`.
  - `internalSpawnTtsJobs`: Called by `on-translation-complete`. Triggers `internalGenerateAudioChunk` **in batches** using `Promise.allSettled` for segments where `end_time <= 60`. If trigger errors occur, it uses the `update_processing_status` **RPC function** to set the `processing_status` to `failed`.

### 3.4. API Routes

- **`/api/actions/[...actionName]/route.ts`:** Handles calls from the mobile app for _client-facing_ server actions.
- **`/api/internal/trigger-action/route.ts`:** Secured endpoint (using `FUNCTION_SECRET`) for Supabase Functions to invoke internal server actions.
- **`/api/webhooks/replicate/route.ts`:** Handles Replicate completion webhook. Updates the **single** `transcription_segments` row for the video (status: `completed`, stores full `content`). This update triggers the `on-transcription-complete` function.

### 3.5. Supabase Functions (`supabase/functions/`)

- **Purpose:** Orchestrate the backend processing steps, triggered by database changes or webhooks. They primarily act as controllers, calling internal Next.js actions to perform the actual work.
- **Status Updates:** All functions now use the `update_processing_status` **RPC function** to atomically update the `videos.processing_status` JSONB field, preventing race conditions.
- **Implementation Details:**
  - `on-download-complete` (Triggered by `download_jobs` status -> `completed`):
    - Fetches video duration, updates `processing_status` (for relevant targets) to `transcribing_full` **via RPC**.
    - Calls `internalRequestFullTranscription` via `/api/internal` to trigger transcription for the **entire** audio file.
  - `on-transcription-complete` (Triggered by `transcription_segments` update: `status` -> `completed`):
    - Reads the completed `content` field from the updated row.
    - Iterates through target languages in `videos.processing_status` that are in the `transcribing_full` state.
    - For **English** targets:
      - Updates `processing_status` to `generating_audio` **via RPC**.
      - Calls `internalSpawnTtsJobs` (via API) to batch-trigger TTS for segments <= 60s.
    - For **non-English** targets:
      - Updates `processing_status` to `translating_full` **via RPC**.
      - Calls `internalTranslateFullContent` via `/api/internal` **once** for the entire transcription content and the target language.
  - `on-translation-complete` (Triggered by `transcription_segments` update: `translations` field changes):
    - Identifies which language(s) were newly added/updated in the `translations` field.
    - For each updated language, finds corresponding targets in `videos.processing_status` that are in the `translating_full` state.
    - For each matching target:
      - Updates `processing_status` to `generating_audio` **via RPC**.
      - Calls `internalSpawnTtsJobs` via `/api/internal` to **batch-trigger** `internalGenerateAudioChunk` for translated sub-segments **where `end_time <= 60` seconds**. If `internalSpawnTtsJobs` encounters errors triggering chunks, it will update the `processing_status` to `failed` (using RPC within the action).
  - `on-audio-chunk-complete` (Triggered by `translated_audio_chunks` inserts):
    - Calculates progress based on completed vs expected **initial chunks** (<= 60s).
    - If count of initial chunks matches total expected initial chunks, sets `processing_status` to `completed` **via RPC**.
    - Otherwise, updates `processing_status` progress percentage **via RPC**.

## 4. Downloader Service (`youtube-download/`)

- This service is responsible for downloading full audio from YouTube videos and also for downloading/processing SRT subtitles.
- **Audio Download (`/` endpoint in `app/main.py`):**
  - Downloads audio, uploads to Supabase Storage (`youtube-audio` bucket).
  - Updates `download_jobs` table in Supabase.
  - Its completion (status update in `download_jobs`) triggers the `on-download-complete` Supabase Function (located in `server/supabase/functions/`), which then initiates the transcription process on the main server.
- **SRT Subtitle Download & Processing (`/download-srt` endpoint in `app/main.py`):**
  - Accepts a YouTube URL and a target language code.
  - **Language Fallback Strategy:**
    - Attempts to download subtitles directly in the target language.
    - If not found, it searches for English (`en`) subtitles to use as a source.
    - If English is not found, it attempts to use any other available language as a source for translation.
  - **Formatting (via `app/services/subtitle_formatter.py`):**
    - **If translation is NOT required** (i.e., subtitles are successfully downloaded in the target language):
      - The raw downloaded SRT content is processed by the `subtitle_formatter.clean_srt_content` function.
      - This function parses the SRT content, removes duplicate consecutive subtitle lines (to reduce stutter common in auto-captions), and then reconstructs it back into a valid SRT formatted string.
      - The cleaned SRT string is returned as the response.
    - **If translation IS required** (i.e., subtitles were downloaded in a source language different from the target):
      - The raw downloaded SRT content is first processed by `subtitle_formatter.format_subtitle_text_for_translation`.
      - This function parses the SRT, removes duplicate consecutive lines, concatenates all subtitle text into a single block (normalizing internal newlines to spaces), and then splits this block into a list of complete sentences (primarily using `.`, `?`, `!` as delimiters).
      - This list of sentences is then passed to the translation service (`app/services/subtitle_translator.py`).
      - The translated sentences (typically joined into a single text block by the translator) are returned as the response.
  - **Translation (via `app/services/subtitle_translator.py`):**
    - If source subtitles need translation, the list of formatted sentences (from `format_subtitle_text_for_translation`) is translated in chunks.
    - This process uses the Gemini API (e.g., `gemini-1.5-flash-latest` model) for the actual translation task.

## 5. Communication Flow (Backend-Driven Processing - Full Transcription)

1.  **Mobile App -> Server API:** User selects video/language/voice -> `callServerAction('video/initiateVideoProcessingJob', { youtubeUrl, processingTargets: { 'es_nova': {...}, 'en_alloy': {...} } })`.
    - If a previous attempt for a specific language/voice combination resulted in a `failed` status, the mobile app can re-initiate by calling this action again with the same `processingTargets`. The server will then attempt to retry the failed target(s).
2.  **Server (`initiateVideoProcessingJob`):**
    - Finds/creates video record.
    - Re-fetches video status.
    - **For targets with a `failed` status:** Resets their status to an appropriate starting point (e.g., `pending`, `transcribing_full`), clears the error message, and resets progress. This allows the subsequent logic to re-trigger the necessary steps for that target.
    - Checks prerequisites (download, transcription, etc.) for all targets (including reset ones).
    - Calculates required status updates for new or reset targets.
    - Atomically updates `videos.processing_status` for each target **using RPC**.
    - Re-fetches final committed status.
    - Determines if download job needs creation/triggering based on committed status. Creates job if needed.
    - Triggers downloader service _if_ a new job was created.
    - Triggers transcription/translation/TTS spawn _if_ prerequisites are met based on committed status.
    - Returns `{ videoId, downloadJobId, initialProcessingStatus }` (with the committed status).
3.  **Mobile App (Realtime):** Subscribes to `videos` table for `videoId`. Receives `processing_status` updates. Displays status via `useVideoProcessingStatus`.
4.  **Downloader Service -> Supabase:** Downloads audio, uploads to `youtube-audio` bucket, updates `download_jobs` status to `completed`, sets `storage_path`, updates `videos` table with audio `duration`.
5.  **Supabase Trigger (`trigger_on_download_complete`) -> Supabase Function (`on-download-complete`):** Triggered by `download_jobs` update.
6.  **`on-download-complete` Function:** Atomically updates relevant targets in `processing_status` to `transcribing_full` **via RPC**. Calls internal action `internalRequestFullTranscription` via `/api/internal`.
7.  **Mobile App (Realtime):** Receives `processing_status` update (`transcribing_full`) -> Displays "Processing audio...".
8.  **Server (`internalRequestFullTranscription`):** Gets full audio URL, calls Replicate API for transcription, updates the **single** `transcription_segments` row (links Replicate ID, status: `processing`).
9.  **Replicate -> Server Webhook (`/api/webhooks/replicate`):** Replicate finishes -> POSTs full transcription result.
10. **Server (Webhook):** Verifies signature, processes transcription result, updates the **single** `transcription_segments` row (status: `completed`, stores full `content`).
11. **Supabase Trigger (`trigger_on_transcription_status_complete`) -> Supabase Function (`on-transcription-complete`):** Triggered by the `transcription_segments` status update.
12. **`on-transcription-complete` Function:**
    - Finds targets in `transcribing_full` state.
    - **For English targets:** Atomically updates status to `generating_audio` **via RPC**. Triggers `internalSpawnTtsJobs` (via API).
    - **For Non-English targets:** Atomically updates status to `translating_full` **via RPC**. Triggers `internalTranslateFullContent` (via API) **once** per target language.
13. **Mobile App (Realtime):** Receives `processing_status` updates (`translating_full`, `generating_audio`...). Listens for updates to the single `transcription_segments` row. When `processing_status` for the target lang/voice becomes `completed`, it can fetch all completed audio chunks. **Client is now responsible for requesting audio chunks beyond the initial pre-generated ones using `generateAudioChunk`.**
14. **Server (`internalTranslateFullContent`):** Translates text, updates the `translations` field in the single `transcription_segments` row.
15. **Supabase Trigger (`trigger_on_transcription_translation_update`) -> Supabase Function (`on-translation-complete`):** Triggered by the `translations` field update.
16. **`on-translation-complete` Function:**
    - Finds targets in `translating_full` state matching the updated language.
    - Atomically updates status to `generating_audio` **via RPC**.
    - Triggers `internalSpawnTtsJobs` (via API) to **batch-trigger** `internalGenerateAudioChunk` for translated sub-segments **where `end_time <= 60`**. If triggering fails for any chunk in a batch, the `internalSpawnTtsJobs` action will attempt to update the status for that lang/voice to `failed` **via RPC**.
17. **Server (`internalGenerateAudioChunk` / Client Action `generateAudioChunk`):** Receives request for a sub-segment (either from `internalSpawnTtsJobs` or client). Extracts text (original or translated), calls TTS (OpenAI/Google), uploads chunk, inserts record into `translated_audio_chunks`.
18. **Supabase Trigger (`trigger_on_audio_chunk_insert`) -> Supabase Function (`on-audio-chunk-complete`):** Updates `processing_status` progress/completion **via RPC** based on initial chunk count vs. total expected initial chunk count.
19. **Mobile App (Realtime):** Receives `processing_status` updates (progress, eventual completion, or `failed`). Fetches initially generated chunks. Plays available audio chunks via `useAudioPlayback`. **When approaching the end of available audio, triggers `generateAudioChunk` action for the next required segment(s).**
20. **Mobile App (Seek):**
    - User seeks.
    - `handleSeek` pauses player, sets `isSeeking`.
    - `checkSeekCompletion` polls until the single `transcription_segments` row's data (`content` or `translations`) is available **AND** the necessary `generatedChunks` contain the audio data for the `seekTargetTime`. **If audio chunk is missing, `handleSeek` (or a related mechanism) needs to trigger `generateAudioChunk` action for the required segment.**
    - Once data exists, `isSeeking` becomes false, player resumes.

## 6. TODOs / Pending Items

- **Review Client-Side Audio Chunk Triggering:** The client needs a robust way to trigger `generateAudioChunk` on demand (for seek/playback continuation). Needs a dedicated client-callable action.
- **Review/Refine Error Handling:** Ensure errors in internal actions consistently lead to a `failed` status update via RPC. Review Supabase Function error paths. The retry mechanism relies on this for client-initiated retries.
- **Client-Side Retry UI:** The mobile app and Chrome extension need UI elements (e.g., a "Retry" button) when a processing target enters a `failed` state, allowing the user to trigger `initiateVideoProcessingJob` again for the failed targets.
- **Regenerate Supabase Types:** Update `database.types.ts` in `server` and `mobile` to reflect latest schema (including the new SQL function).
- **Testing:** Thoroughly test the end-to-end backend processing flow with concurrent requests and various language/voice combinations, including the new retry logic for failed jobs.
- Review/configure Supabase Storage policies.
- Review/improve logging across all services.
- **Client-Side Logic:** Implement client-side logic in the mobile app to:
  - Request audio chunks on-demand using the `generateAudioChunk` action when playback nears the end of available chunks.
  - Request audio chunks on-demand during seek operations if the target time's chunk hasn't been generated yet.
- **Note:** Atomic updates for `processing_status` have been implemented using an SQL RPC function (`update_processing_status`) to mitigate race conditions.

## 7. Client-Side (Chrome Extension)

### 7.1. Overview

The Chrome Extension allows users to apply dubbing directly while watching videos on youtube.com or other supported movie/show platforms. It interacts with the existing backend server (`server/`) for initiating processing jobs (for movies/shows that require backend processing) and fetching generated audio data or subtitles. For YouTube videos, it can fetch subtitles directly without backend processing status tracking.

### 7.2. Extension User Flow

1.  **Video Detection & UI (`MovieSearchPage.tsx`, `MovieSearch.tsx`):**

    - The extension popup opens to `MovieSearchPage.tsx`.
    - It detects if the current tab is a YouTube video page.
    - **YouTube Video Flow:**
      - If a YouTube video is detected, a prominent button "Dub Current YouTube Video" (or similar) is shown.
      - Clicking this button dispatches `fetchAndPrepareYouTubeSubtitles` from `movieSlice.ts`. This thunk uses the globally selected language (from extension settings/Redux state) to fetch SRT subtitles directly via the `/download-srt` endpoint of the `youtube-download` service.
      - If successful, the SRT content is stored in Redux, and the UI navigates to `DubbingPage.tsx`.
    - **Movie/Show Search Flow:**
      - Users can search for movies or shows using the `MovieSearch.tsx` component.
      - When a movie/show is selected from the search results:
        - The selected item is displayed on `MovieSearchPage.tsx` (e.g., using `MovieCard.tsx`).
        - If the selected item is a series, input fields for season and episode numbers appear.
        - A "Fetch Subtitles" button is displayed.
      - Clicking "Fetch Subtitles":
        - Dispatches `selectSubtitle` from `movieSlice.ts`. This thunk uses the selected movie's IMDb ID, the globally selected language, season/episode numbers (if applicable), and the current tab's URL (for context, though subtitles are primarily fetched by IMDb ID) to get SRT subtitles from the backend (which in turn might use OpenSubtitles or similar providers).
        - If successful, the SRT content is stored in Redux, and the UI navigates to `DubbingPage.tsx`.
    - **SRT Upload:** Users can also upload an SRT file directly using `SubtitleUpload.tsx`. This also stores the SRT in Redux and navigates to `DubbingPage.tsx`.
    - Global language for dubbing is managed via `SettingsPage.tsx` and stored in Redux.

2.  **Dubbing Activation (`DubbingPage.tsx`):**

    - This page displays information about the selected movie/show or active YouTube URL, and the selected language.
    - It provides controls (`DubbingControls.tsx`) to start/stop the dubbing process.
    - Clicking "Start Dubbing":
      - Dispatches `toggleDubbingProcess` from `movieSlice.ts`.
      - This thunk sends a message (`initializeDubbing` or `initializeYouTubeDubbing`) to the content script (`content.ts`).
      - The message includes the SRT content, language code, voice selection, and relevant IDs (IMDb ID for movies, YouTube video ID string for YouTube).

3.  **Content Script (`content.ts`):**

    - Receives the initialization message.
    - Sets up `DubbingManager.ts` with the provided SRT content and other parameters.
    - `DubbingManager` uses `SubtitleManager` to parse and manage subtitles from the SRT.
    - `VideoManager` tracks video player state and time.
    - When dubbing is active, `AudioFileManager` (via `DubbingManager`) requests audio chunks from `background.ts` for the current subtitle text.

4.  **Background Script (`background.ts`):**

    - Handles `generateAudioChunk` messages from the content script.
    - **For YouTube videos (direct TTS):** It will call a simplified server action (e.g., `audio/generateDubbingAudioDirect`) that takes text, language, and voice, and returns a TTS audio URL directly, without database interaction for video processing status.
    - **For movies/shows (potentially with backend processing):** If the flow involved `initiateVideoProcessingJob` (not the case for the simplified YouTube flow described above, but kept for general movie dubbing that might still use backend jobs), it would interact with actions that might check database job statuses or fetch pre-generated chunks. However, the primary mode now for the extension after subtitle acquisition is on-demand TTS.

5.  **Audio Playback & Subtitle Display:**
    - `DubbingManager` coordinates playing audio chunks synchronized with video playback.
    - It also sends current subtitle information to the popup UI (`DubbingPage.tsx`) for display if needed.

**Simplified YouTube Flow (No Backend DB Job for the Video):**

1.  User on YouTube, opens extension.
2.  `MovieSearchPage.tsx` shows "Dub Current YouTube Video".
3.  User clicks button -> `fetchAndPrepareYouTubeSubtitles` (gets SRT for current YouTube video ID and global language).
4.  Navigate to `DubbingPage.tsx`. SRT content is now in Redux.
5.  User clicks "Start Dubbing" -> `toggleDubbingProcess` sends `initializeYouTubeDubbing` to `content.ts` with SRT, YouTube video ID string, language, voice.
6.  `content.ts` initializes. `AudioFileManager` requests audio for current subtitle text from `background.ts`.
7.  `background.ts` calls a direct TTS server action (no DB `videoId` needed, just text, lang, voice).
8.  Audio plays.

This revised flow removes the `LanguageSelectionPage.tsx` and streamlines the process by initiating subtitle fetching directly from `MovieSearchPage.tsx` for both movies and YouTube videos, then proceeding to `DubbingPage.tsx`.
The core backend processing for _movies and shows that might still use the job system_ (initiated via `initiateVideoProcessingJobApi` by the mobile app) remains largely the same on the server-side as described in sections 3-6, but the Chrome Extension's primary interaction after acquiring subtitles is geared towards on-demand TTS.

## 8. Authentication & Authorization

### 8.1. Authentication Flow

- **Provider:** Supabase Auth with Google OAuth
- **Authentication Flow:**
  1. User clicks "Sign in with Google" button
  2. Redirected to Google OAuth consent screen
  3. After successful authentication, redirected to `/auth/callback`
  4. Callback route exchanges code for session
  5. User is redirected to home page
  6. Session is maintained via cookies

### 8.2. Chrome Extension Authentication

- **Token Management:**

  - Website generates extension-specific token on login
  - Token stored in extension's local storage
  - Token used for all extension API calls
  - Token invalidated on website logout

- **Extension Auth Flow:**

  1. User logs in on website
  2. Extension receives auth token via message passing
  3. Extension stores token securely
  4. Token used for all dubbing operations
  5. Extension can initiate logout, clearing local token

- **Security:**
  - Tokens are short-lived (24 hours)
  - Automatic token refresh mechanism
  - Secure storage in extension
  - Token validation on all API calls

### 8.3. User Profiles

- **Profile Creation:**

  - Automatically created on first sign-in
  - Stored in `profiles` table with default values:
    - `subscription_status`: "free"
    - `daily_video_count`: 0

- **Profile Fields:**
  ```sql
  id: uuid (references auth.users)
  email: string
  full_name: string | null
  avatar_url: string | null
  subscription_status: "free" | "premium"
  daily_video_count: number
  last_video_date: string | null
  created_at: timestamp
  updated_at: timestamp
  ```

## 9. Subscription Plans & Features

### 9.1. Free Plan

- **Limitations:**

  - 4 videos per day
  - Basic voice options only
  - No access to premium voices

- **Features:**
  - Access to all basic dubbing features
  - Support for all languages
  - Basic voice quality

### 9.2. Premium Plan

- **Benefits:**

  - Unlimited videos per day
  - Access to all premium voices
  - Early access to new features

- **Features:**
  - All free plan features
  - Premium voice options
  - Advanced audio quality options

### 9.3. Subscription Management

- **Subscription Status Tracking:**

  - Stored in `profiles` table
  - Updated via Stripe webhooks
  - Affects user's daily limits and feature access

- **Usage Tracking:**
  - `daily_video_count` resets at midnight UTC
  - `last_video_date` tracks last video processing
  - Premium users bypass daily count checks

### 9.4. Feature Access Control

- **Middleware Protection:**

  - Only `/subscription` route requires authentication
  - All other routes are publicly accessible
  - Feature access controlled at component level

- **Component-Level Access:**
  - Premium features conditionally rendered based on `subscription_status`
  - Usage limits enforced in server actions
  - Premium voices only available to premium users

### 9.5. Subscription Flow

1. **Free User Flow:**

   - Can use basic features
   - Limited to 4 videos per day
   - Can upgrade to premium at any time
   - Redirected to subscription page when:
     - Daily limit exceeded
     - Attempting to use premium voice

2. **Premium User Flow:**

   - Unlimited video processing
   - Access to all premium features
   - Can manage subscription via `/subscription` page

3. **Upgrade Flow:**

   - User clicks upgrade button or hits limit
   - Redirected to Stripe checkout
   - After successful payment:
     - Subscription status updated
     - Premium features unlocked
     - Usage limits removed

4. **Downgrade Flow:**
   - User can cancel subscription
   - Continues to have premium access until end of billing period
   - Reverts to free plan after period ends
   - Access to premium features maintained until subscription expires

### 9.6. Usage Monitoring

- **Daily Limits:**

  - Free users: 4 videos per day
  - Premium users: Unlimited
  - Reset occurs at midnight UTC

- **Premium Voice Access:**

  - Free users redirected to subscription page
  - Premium users have full access
  - Grace period for cancelled subscriptions

- **Error Handling:**
  - Clear messaging for limit exceeded
  - Smooth upgrade flow
  - Graceful fallback to free features
