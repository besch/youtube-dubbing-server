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
  - **REMOVED:** `transcription-segments` bucket is no longer used.
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
  - `internalGenerateAudioChunk`: Called by `internalSpawnTtsJobs`. Takes details for a specific sub-segment (start/end time), extracts text from the full `content` or `translations`, calls TTS API (OpenAI/Google), uploads chunk, inserts record into `translated_audio_chunks`. **Client also needs an action to trigger this on-demand.**
  - `internalSpawnTtsJobs`: Called by `on-translation-complete`. Triggers `internalGenerateAudioChunk` **in batches** using `Promise.allSettled` for segments where `end_time <= 60`. If trigger errors occur, it uses the `update_processing_status` **RPC function** to set the `processing_status` to `failed`.

### 3.4. API Routes

- **`/api/actions/[...actionName]/route.ts`:** Handles calls from the mobile app for _client-facing_ server actions.
- **`/api/internal/trigger-action/route.ts`:** Secured endpoint (using `FUNCTION_SECRET`) for Supabase Functions to invoke internal server actions (`internalRequestFullTranscription`, `internalTranslateFullContent`, `internalSpawnTtsJobs`, `internalGenerateAudioChunk`).
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

- Unchanged conceptually, but its completion now triggers the `on-download-complete` Supabase Function.

## 5. Audio Segmenter Service (`audio-segmenter/`)

- **REMOVED:** This service is no longer required. The new backend processing flow transcribes the entire audio file at once. Supabase Functions (`on-transcription-complete`, `on-translation-complete`) trigger TTS for individual sub-segments derived from the full transcription/translation.

## 6. Communication Flow (Backend-Driven Processing - Full Transcription)

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

## 7. TODOs / Pending Items

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

## 8. Chrome Extension Architecture (`extension/`)

### 8.1. Overview

The Chrome Extension allows users to apply dubbing directly while watching videos on youtube.com. It interacts with the existing backend server (`server/`) for authentication, initiating processing jobs, and fetching generated audio data.

- **Manifest Version:** 3
- **Core Technologies:** React, TypeScript, Jotai, Tailwind CSS, Shadcn UI.
- **Build Tool:** Webpack (or similar, e.g., Vite, if changed).
- **Key Directories:**
  - `src/pages/`: Popup UI components (e.g., `Home.tsx`).
  - `src/components/`: Reusable UI components (e.g., `LanguageSelector.tsx`).
  - `src/extension/content/`: Core logic for content script (managers like `DubbingManager.ts`, `VideoManager.ts`, etc.).
  - `src/extension/`: Background script (`background.ts`), utility files (`utils.ts`).
  - `src/store/`: Jotai atoms (`settingsAtoms.ts`, `authAtoms.ts`).
  - `types/`: Shared TypeScript definitions (`index.ts`).

### 8.2. Components

- **`manifest.json`:** Defines permissions (`storage`, `activeTab`, `scripting`, `tts`, `identity`, `alarms`), host permissions (`youtube.com`), content scripts, background service worker, popup action, and icons.
- **Popup (`src/pages/Home.tsx`, `popup.html`):**
  - React-based UI.
  - Handles user authentication (Supabase Google OAuth via `chrome.identity`).
  - Displays login/logout status.
  - Provides core dubbing controls: Enable/Disable, Target Language Selector (using `LanguageSelector.tsx`), Voice Selector, Original Video Volume, Dubbing Audio Volume.
  - Sends settings changes to the active content script via `chrome.tabs.sendMessage` using `ApplySettingsChangesMessage`.
  - Uses Jotai (`sessionAtom`, `userProfileAtom`, `settingsAtoms`) for state, persisting settings via `chrome.storage.local` (managed by Jotai's `atomWithStorage` and custom storage adapters).
- **Content Script (`src/extension/content.ts`):**
  - Injected into `youtube.com/watch` pages.
  - **Manager-Based Architecture:**
    - `DubbingManager`: Central orchestrator. Manages overall state (`DubbingManagerState`), video context, auth state from background, and applies settings. Initiates backend processing jobs and data fetching by sending messages to `background.ts`. Handles video state changes received from `VideoManager`. Contains logic to find relevant subtitle/transcription segments (`findSubtitleForTime`) and decides audio playback strategy (`playAudioForSubtitle`).
    - `VideoManager`: Detects the YouTube HTML5 video player, attaches event listeners (play, pause, seek, timeupdate, etc.), and reports video state changes to `DubbingManager`. Adjusts video element volume based on dubbing activity.
    - `AudioPlayer`: Handles playback of pre-rendered audio chunks (typically for paid tier users) using the Web Audio API. Integrated with `AudioFileManager` for efficient caching of audio data.
    - `TtsManager`: Manages Text-to-Speech playback using `chrome.tts.speak` (typically for free tier users or as a fallback).
    - `AudioFileManager`: Implements a multi-layer audio caching strategy: an in-memory cache for `AudioBuffer` objects and persistent storage in IndexedDB (via `AudioCache`) for `ArrayBuffer` objects. Provides methods like `getOrFetchAudioBuffer` to streamline cache access and network requests.
    - `AudioCache`: A wrapper around IndexedDB for storing and retrieving audio `ArrayBuffer` data.
    - `SubtitleManager`: Currently a placeholder; core subtitle processing logic (finding segments for current time) is within `DubbingManager`.
    - `config.ts`: Holds content-script specific configurations (e.g., default volumes, offsets).
  - Listens for `ApplySettingsChangesMessage` from the popup to update its behavior.
  - Requests initial settings and auth state from the background script on load.
- **Background Service Worker (`src/extension/background.ts`):**
  - Handles messages from content scripts and the popup.
  - **API Proxy:** Forwards requests from `DubbingManager` (e.g., `INITIATE_PROCESSING`, `GET_TRANSCRIPTION`, `GET_AUDIO_CHUNKS`) to the backend server API.
  - **Realtime Updates:** Establishes and manages Supabase Realtime subscriptions for changes in video processing status and transcription data from the backend. Relays these updates to the appropriate content script tab.
  - **State Provider:** Responds to `GET_AUTH_STATE` and `REQUEST_SETTINGS` messages by accessing the Jotai store (which syncs with `chrome.storage.local`).
  - Manages user session initialization with Supabase.
  - **TODO:** Implement free tier daily usage limit logic (potentially using `chrome.alarms`).
- **Shared Modules:**
  - `src/lib/supabase.ts` (or `src/supabaseClient.ts`): Initializes Supabase client.
  - `src/store/`: Jotai atoms for auth (`authAtoms.ts`) and settings (`settingsAtoms.ts`).
  - `types/index.ts`: Centralized TypeScript interfaces for messages, settings, backend responses, etc.
  - `src/extension/utils.ts`: Utility functions like `base64ToArrayBuffer`.
  - `src/components/ui/`: Reusable Shadcn UI components for the popup.

### 8.3. Communication Flows

#### 8.3.1. Popup -> Content Script (Settings Update)

1.  User changes a setting in the Popup UI (`Home.tsx`).
2.  Jotai atom for that setting is updated (persisting if configured).
3.  `Home.tsx` sends an `ApplySettingsChangesMessage` with the relevant payload to the active content script tab using `chrome.tabs.sendMessage`.
4.  `DubbingManager` in `content.ts` receives the message and updates its internal state and behavior (e.g., changes target language, updates TTS voice, adjusts volume settings for `AudioPlayer` or `VideoManager`).

#### 8.3.2. Content Script -> Background Script -> Backend Server (Data/Job Operations)

1.  `DubbingManager` needs to initiate a job or fetch data (e.g., on video load, or when new data is required).
2.  It sends a specific message (e.g., `INITIATE_PROCESSING`, `GET_TRANSCRIPTION`) to `background.ts` using `chrome.runtime.sendMessage`.
3.  `background.ts` receives the message.
4.  `background.ts` calls the appropriate backend API endpoint (e.g., using `fetch` to a Next.js server action endpoint), including authentication tokens if required.
5.  The backend server processes the request.
6.  `background.ts` receives the response from the server and forwards it back to the `DubbingManager` in the content script via the `sendResponse` callback.

#### 8.3.3. Backend Server -> Background Script -> Content Script (Realtime Updates)

1.  Backend data changes (e.g., video processing status update in Supabase DB, new transcription segment available).
2.  `background.ts` has active Supabase Realtime subscriptions listening for these changes.
3.  When a Realtime event is received, `background.ts` processes it.
4.  `background.ts` identifies the relevant content script tab (based on `videoId` or other context stored when the subscription was initiated).
5.  `background.ts` sends a message (e.g., `VIDEO_PROCESSING_UPDATE`, `TRANSCRIPTION_TRANSLATION_UPDATE`) to the specific tab's content script using `chrome.tabs.sendMessage`.
6.  `DubbingManager` in `content.ts` receives the update and modifies its state, potentially triggering UI changes or further actions (e.g., playing newly available audio).

### 8.4. TODOs / Pending Items (Extension)

- Implement robust on-demand audio chunk generation requests from `DubbingManager` to the backend if pre-generated chunks are exhausted or for seek targets (paid tier).
- Refine error handling and user-facing status messages in the content script (relayed from `DubbingManager` to a potential UI overlay).
- Enhance the UI injected by the content script (currently minimal, could be a more integrated React component via Shadow DOM).
- Implement free tier daily usage limit tracking and enforcement in `background.ts`.
- Dynamically fetch available languages/voices from the backend for selectors in the popup if they are not static.
- Ensure robust handling of YouTube's Single Page Application (SPA) navigation within the content script (e.g., re-initialization of managers on new video loads without a full page refresh).
- Optimize performance of manager interactions and state updates within the content script.
- Finalize and test all audio playback synchronization logic with video timing.
