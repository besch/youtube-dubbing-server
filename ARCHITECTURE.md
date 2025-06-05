# YouTube Dubbing Project Architecture

This document outlines the architecture of the YouTube Dubbing application, covering the Chrome Extension client and the server (Next.js), with a focus on their interaction.

## 1. Overall Architecture

The project allows users to watch YouTube videos with dubbed audio tracks generated via a **backend-driven processing pipeline**.

- **Project Structure:**
  - `extension/`: Chrome Extension application (Client).
  - `server/`: Next.js backend (API, DB Interaction, Orchestration Trigger, Job Status Management).
  - `youtube-download/`: Python FastAPI service (YouTube full audio download, SRT subtitle download/processing & upload).
  - `server/supabase/functions/`: Deno Edge Functions for orchestrating backend processing steps (e.g., `on-download-complete`, `on-transcription-complete`, `on-translation-complete`).
- **Technology Stack:**
  - **Chrome Extension:** React, TypeScript, Redux Toolkit, Shadcn UI, Tailwind CSS, `react-router-dom`, Manifest V3.
  - **Server:** Next.js (App Router), TypeScript, Supabase (Auth, DB, Functions), `next-safe-action`, Zod, Replicate Client (Transcription), OpenAI Client (TTS), Google Cloud Text-to-Speech Client, Anthropic Client (Translation).
  - **Downloader:** Python, FastAPI, `yt-dlp`, `supabase-py`.
  - **Supabase Functions:** Deno, TypeScript, Supabase Client.

## 2. Server Architecture (`server/`)

### 2.1. Core Structure

- **Next.js App Router.**
- **Directory Structure:**
  ```
  server/
  ├── src/
  │   ├── app/
  │   │   ├── api/
  │   │   │   ├── actions/[...actionName]/ # Client-facing actions (for Chrome Extension)
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

### 2.2. Supabase Integration

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

### 2.3. Server Actions (`app/actions/`)

- **Framework:** `next-safe-action`.
- **Setup:** Unchanged.
- **Error Handling:** Unchanged.
- **Client-Facing Actions (`video.ts` - for Chrome Extension):**
  - `initiateVideoProcessingJob` (Protected): Main entry point for backend processing jobs (typically for non-YouTube content or complex YouTube scenarios not handled by direct TTS in the extension).
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
  - `generateAudioChunk` (Protected): Client-callable action for the Chrome Extension to request generation of a specific audio chunk on-demand (e.g., for seeks or continuous playback).
    - **Authorization:** Checks if the user is authenticated and has a premium subscription if the requested voice is an OpenAI or Google TTS voice (which are considered premium). Returns a `FORBIDDEN` (403) error if a non-premium user attempts to use a premium voice, or `UNAUTHENTICATED` (401) if the user is not logged in for such a request. Free browser-based TTS voices are not handled by this server action.
  - `updateHistory`, `toggleFavorite`, `getFavoriteStatus`, `getFavorites`, `getHistory`, `getSuggestedVideos`, `translateVideoTitle` (Protected): Unchanged.
- **Internal Actions (`videoInternal.ts` - Called by Supabase Functions):**
  - `internalRequestFullTranscription`: Called by `on-download-complete`. Gets full audio URL, starts Replicate job, updates the single `transcription_segments` row (status: `processing`).
  - `internalTranslateFullContent`: Called by `on-transcription-complete` (for non-English). Translates the entire `content` field, updates the `translations` field in the single `transcription_segments` row.
  - `internalGenerateAudioChunk`: Called by `internalSpawnTtsJobs`. Takes details for a specific sub-segment (start/end time), extracts text from the full `content` or `translations`, calls TTS API (OpenAI/Google), uploads chunk, inserts record into `translated_audio_chunks`.
  - `internalSpawnTtsJobs`: Called by `on-translation-complete`. Triggers `internalGenerateAudioChunk` **in batches** using `Promise.allSettled` for segments where `end_time <= 60`. If trigger errors occur, it uses the `update_processing_status` **RPC function** to set the `processing_status` to `failed`.

### 2.4. API Routes

- **`/api/actions/[...actionName]/route.ts`:** Handles calls from the Chrome Extension for _client-facing_ server actions.
- **`/api/internal/trigger-action/route.ts`:** Secured endpoint (using `FUNCTION_SECRET`) for Supabase Functions to invoke internal server actions.
- **`/api/webhooks/replicate/route.ts`:** Handles Replicate completion webhook. Updates the **single** `transcription_segments` row for the video (status: `completed`, stores full `content`). This update triggers the `on-transcription-complete` function.

### 2.5. Supabase Functions (`supabase/functions/`)

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

### 2.6. Admin Logging Dashboard (`server/src/app/(admin)/dashboard/logs/`)

- **Purpose:** Provides a comprehensive interface for viewing, filtering, and analyzing application logs stored in the `app_logs` table.
- **Access:** Protected via server-side checks in the layout (`server/src/app/(admin)/layout.tsx`) and middleware in server actions, restricting access to a predefined admin email authenticated via Google. A "Logs" link appears in the main navigation for the admin user.
- **Key Features:**
  - **Log Table:** Displays paginated log entries (`id`, `created_at`, `log_level`, `service_name`, `action_name`, `error_message`, `user_id`). Log levels are color-coded for readability.
  - **Log Details Modal:** Clicking a log entry opens a dialog showing the full JSON of the `LogEntry`.
  - **Filtering:**
    - **Predefined Date Ranges:** Buttons for "Last 7 Days", "Last Month", "Last 3 Months", "Last 6 Months".
    - **Custom Date/Time Range:** Input fields for start and end date/time.
    - **Log Level:** Select dropdown.
    - **Service Name:** Text input (supports partial match).
    - **Action Name:** Text input (supports partial match).
    - **User ID:** Text input (exact match UUID).
    - Filters update both the log table and the displayed charts.
  - **Charts:**
    - **Logs by Level:** Pie chart showing distribution of logs by `log_level`.
    - **Logs by Service:** Vertical bar chart showing log counts per `service_name`.
    - **Top Error Codes:** Horizontal bar chart showing frequency of `error_code`.
    - **Daily Log Activity (Planned):** Line chart to show log counts per day for the selected period. Requires a new/modified RPC (`get_logs_by_time_granularity`) and server action (`getTimeBasedLogStatsAction`).
    - **Monthly Log Overview (Planned):** Bar chart to show log counts per month for the selected period. Also relies on the new RPC and server action.
- **Technology:**

  - Next.js App Router, React Server Components (layout) and Client Components (page).
  - `next-safe-action` for server actions (`getLogsAction`, `getLogStatsAction`, planned `getTimeBasedLogStatsAction`).
  - Zod for schema validation in actions.
  - `nuqs` for managing filter state in URL query parameters.
  - Shadcn UI components (`Table`, `Card`, `Dialog`, `Button`, `Input`, `Select`).
  - Recharts for rendering charts.
  - `date-fns` for date manipulations.
  - `sonner` for toast notifications.

  src/lib/logger.ts
  src/app/actions/admin/logs.ts
  src/app/(admin)/dashboard/logs/page.tsx
  src/app/actions/admin/schemas.ts

## 3. Downloader Service (`youtube-download/`)

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

## 4. Communication Flow (Backend-Driven Processing - Full Transcription)

This describes the flow when the Chrome Extension initiates a dubbing process that requires full backend processing (e.g., for a movie or a complex YouTube scenario not handled by direct TTS).

1.  **Chrome Extension -> Server API:** User selects video/language/voice -> `callServerAction('video/initiateVideoProcessingJob', { videoUrl, processingTargets: { 'es_nova': {...}, 'en_alloy': {...} } })`.
    - If a previous attempt for a specific language/voice combination resulted in a `failed` status, the extension can re-initiate by calling this action again with the same `processingTargets`. The server will then attempt to retry the failed target(s).
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
3.  **Chrome Extension (Realtime):** Subscribes to `videos` table for `videoId` (if backend processing was initiated). Receives `processing_status` updates. Displays status.
4.  **Downloader Service -> Supabase:** Downloads audio, uploads to `youtube-audio` bucket, updates `download_jobs` status to `completed`, sets `storage_path`, updates `videos` table with audio `duration`.
5.  **Supabase Trigger (`trigger_on_download_complete`) -> Supabase Function (`on-download-complete`):** Triggered by `download_jobs` update.
6.  **`on-download-complete` Function:** Atomically updates relevant targets in `processing_status` to `transcribing_full` **via RPC**. Calls internal action `internalRequestFullTranscription` via `/api/internal`.
7.  **Chrome Extension (Realtime):** Receives `processing_status` update (`transcribing_full`) -> Displays "Processing audio...".
8.  **Server (`internalRequestFullTranscription`):** Gets full audio URL, calls Replicate API for transcription, updates the **single** `transcription_segments` row (links Replicate ID, status: `processing`).
9.  **Replicate -> Server Webhook (`/api/webhooks/replicate`):** Replicate finishes -> POSTs full transcription result.
10. **Server (Webhook):** Verifies signature, processes transcription result, updates the **single** `transcription_segments` row (status: `completed`, stores full `content`).
11. **Supabase Trigger (`trigger_on_transcription_status_complete`) -> Supabase Function (`on-transcription-complete`):** Triggered by the `transcription_segments` status update.
12. **`on-transcription-complete` Function:**
    - Finds targets in `transcribing_full` state.
    - **For English targets:** Atomically updates status to `generating_audio` **via RPC**. Triggers `internalSpawnTtsJobs` (via API).
    - **For Non-English targets:** Atomically updates status to `translating_full` **via RPC**. Triggers `internalTranslateFullContent` (via API) **once** per target language.
13. **Chrome Extension (Realtime):** Receives `processing_status` updates (`translating_full`, `generating_audio`...). Listens for updates to the single `transcription_segments` row. When `processing_status` for the target lang/voice becomes `completed`, it can fetch all completed audio chunks. The Extension is responsible for requesting audio chunks beyond the initial pre-generated ones using `generateAudioChunk` action.
14. **Server (`internalTranslateFullContent`):** Translates text, updates the `translations` field in the single `transcription_segments` row.
15. **Supabase Trigger (`trigger_on_transcription_translation_update`) -> Supabase Function (`on-translation-complete`):** Triggered by the `translations` field update.
16. **`on-translation-complete` Function:**
    - Finds targets in `translating_full` state matching the updated language.
    - Atomically updates status to `generating_audio` **via RPC**.
    - Triggers `internalSpawnTtsJobs` (via API) to **batch-trigger** `internalGenerateAudioChunk` for translated sub-segments **where `end_time <= 60`**. If triggering fails for any chunk in a batch, the `internalSpawnTtsJobs` action will attempt to update the status for that lang/voice to `failed` **via RPC**.
17. **Server (`internalGenerateAudioChunk` / Client Action `generateAudioChunk`):** Receives request for a sub-segment (either from `internalSpawnTtsJobs` or Chrome Extension). Extracts text (original or translated), calls TTS (OpenAI/Google), uploads chunk, inserts record into `translated_audio_chunks`.
18. **Supabase Trigger (`trigger_on_audio_chunk_insert`) -> Supabase Function (`on-audio-chunk-complete`):** Updates `processing_status` progress/completion **via RPC** based on initial chunk count vs. total expected initial chunk count.
19. **Chrome Extension (Realtime):** Receives `processing_status` updates (progress, eventual completion, or `failed`). Fetches initially generated chunks. Plays available audio chunks. When approaching the end of available audio, triggers `generateAudioChunk` action for the next required segment(s).
20. **Chrome Extension (Seek):**
    - User seeks.
    - `content.ts` (via `DubbingManager`) pauses audio.
    - `DubbingManager` checks if transcription/translation data (from `SubtitleManager`) and audio chunk (`AudioFileManager`) are available for the seek target.
    - If audio chunk is missing, `AudioFileManager` (via `background.ts`) triggers the `generateAudioChunk` server action for the required segment.
    - Once data exists, audio resumes.

## 5. TODOs / Pending Items

- **Review Extension-Side Audio Chunk Triggering:** The Chrome Extension needs a robust way to trigger `generateAudioChunk` on demand (for seek/playback continuation).
- **Review/Refine Error Handling:** Ensure errors in internal actions consistently lead to a `failed` status update via RPC. Review Supabase Function error paths. The retry mechanism relies on this for client-initiated retries.
- **Extension-Side Retry UI:** The Chrome extension needs UI elements (e.g., a "Retry" button) when a processing target enters a `failed` state, allowing the user to trigger `initiateVideoProcessingJob` again for the failed targets.
- **Regenerate Supabase Types:** Update `database.types.ts` in `server` and `extension` to reflect latest schema (including the new SQL function).
- **Testing:** Thoroughly test the end-to-end backend processing flow with concurrent requests and various language/voice combinations, including the new retry logic for failed jobs.
- Review/configure Supabase Storage policies.
- Review/improve logging across all services.
- **Note:** Atomic updates for `processing_status` have been implemented using an SQL RPC function (`update_processing_status`) to mitigate race conditions.

## 6. Client-Side (Chrome Extension)

### 6.1. Overview

The Chrome Extension allows users to apply dubbing directly while watching videos on youtube.com or other supported movie/show platforms. It interacts with the existing backend server (`server/`) for initiating processing jobs (for movies/shows that require backend processing) and fetching generated audio data or subtitles. For YouTube videos, it primarily fetches subtitles directly via the `youtube-download` service and then uses on-demand TTS via the main server (without creating a persistent backend video processing job for that specific YouTube video unless explicitly chosen for a more complex workflow).

### 6.2. Extension User Flow

1.  **Video Detection & UI (`MovieSearchPage.tsx`, `MovieSearch.tsx`):**

    - The extension popup opens to `MovieSearchPage.tsx`.
    - It detects if the current tab is a YouTube video page.
    - **YouTube Video Flow:**
      - If a YouTube video is detected, a prominent button "Dub Current YouTube Video" (or similar) is shown.
      - Clicking this button dispatches `fetchAndPrepareYouTubeSubtitles` from `movieSlice.ts`. This thunk uses the globally selected language (from extension settings/Redux state) to fetch SRT subtitles directly via the `/download-srt` endpoint of the `youtube-download` service.
      - If successful, the SRT content is stored in Redux, and the UI navigates to `DubbingPage.tsx`.
    - **Movie/Show Search Flow (Potentially Involving Backend Processing):**
      - Users can search for movies or shows using the `MovieSearch.tsx` component.
      - When a movie/show is selected from the search results:
        - The selected item is displayed on `MovieSearchPage.tsx` (e.g., using `MovieCard.tsx`).
        - If the selected item is a series, input fields for season and episode numbers appear.
        - A "Fetch Subtitles" button is displayed.
      - Clicking "Fetch Subtitles":
        - Dispatches `selectSubtitle` from `movieSlice.ts`. This thunk uses the selected movie's IMDb ID, the globally selected language, season/episode numbers (if applicable) to get SRT subtitles from the backend (which in turn might use OpenSubtitles or similar providers, or trigger a full backend processing job if subtitles aren't readily available).
        - If successful (SRT obtained), the SRT content is stored in Redux, and the UI navigates to `DubbingPage.tsx`.
    - **SRT Upload:** Users can also upload an SRT file directly using `SubtitleUpload.tsx`. This also stores the SRT in Redux and navigates to `DubbingPage.tsx`.
    - Global language for dubbing is managed via `SettingsPage.tsx` and stored in Redux.

2.  **Dubbing Activation (`DubbingPage.tsx`):**

    - This page displays information about the selected movie/show or active YouTube URL, and the selected language.
    - It provides controls (`DubbingControls.tsx`) to start/stop the dubbing process.
    - Clicking "Start Dubbing":
      - Dispatches `toggleDubbingProcess` from `movieSlice.ts`.
      - This thunk sends a message (`initializeDubbing` for movies/uploaded SRTs, or direct initialization for YouTube with provided SRT) to the content script (`content.ts`).
      - The message includes the SRT content, language code, voice selection, and relevant IDs (IMDb ID for movies, YouTube video ID string for YouTube).

3.  **Content Script (`content.ts`):**

    - Receives the initialization message.
    - Sets up `DubbingManager.ts` with the provided SRT content and other parameters.
    - `DubbingManager` uses `SubtitleManager` to parse and manage subtitles from the SRT.
    - `VideoManager` tracks video player state and time.
    - When dubbing is active, `AudioFileManager` (via `DubbingManager`) requests audio chunks from `background.ts` for the current subtitle text.

4.  **Background Script (`background.ts`):**

    - Handles `generateAudioChunk` messages from the content script.
    - It calls the `generateAudioChunkApi` server action (a client-facing action in `server/src/app/actions/video.ts`) that takes text, language, and voice, and returns a TTS audio URL directly. This action performs the TTS generation without relying on the full backend video processing job system for these on-demand requests from the extension.

5.  **Audio Playback & Subtitle Display:**
    - `DubbingManager` coordinates playing audio chunks synchronized with video playback.
    - It also sends current subtitle information to the popup UI (`DubbingPage.tsx`) for display if needed.

**Simplified YouTube Flow (Direct TTS via Server Action, No Backend DB Job for the Video):**

1.  User on YouTube, opens extension.
2.  `MovieSearchPage.tsx` shows "Dub Current YouTube Video".
3.  User clicks button -> `fetchAndPrepareYouTubeSubtitles` (gets SRT for current YouTube video ID and global language from `youtube-download` service).
4.  Navigate to `DubbingPage.tsx`. SRT content is now in Redux.
5.  User clicks "Start Dubbing" -> `toggleDubbingProcess` sends initialization message to `content.ts` with SRT, YouTube video ID string, language, voice.
6.  `content.ts` initializes. `AudioFileManager` requests audio for current subtitle text from `background.ts`.
7.  `background.ts` calls `generateAudioChunkApi` server action (text, lang, voice).
8.  Audio plays.

This revised flow removes the `LanguageSelectionPage.tsx` and streamlines the process by initiating subtitle fetching directly from `MovieSearchPage.tsx` for both movies and YouTube videos, then proceeding to `DubbingPage.tsx`.

## 7. Authentication & Authorization

### 7.1. Authentication Flow (Server)

- **Provider:** Supabase Auth with Google OAuth and Email/Password.
- **Identifying the Initiator:** To differentiate between authentication flows started by the Chrome Extension versus the website, an `initiator_id` parameter is used.
  - When the extension opens the login page, it does so with `GET /login?initiator_id=CHROME_EXTENSION_RUNTIME_ID`.
- **Authentication Flow (Website-initiated for Extension, or direct Website login):**

  1. **Login Page (`/login`) - `AuthForm.tsx` Component:**

     - The `AuthForm` component on the `/login` page reads the `initiator_id` from its URL's query parameters.
     - **For Google OAuth or Email Sign-Up:**
       - If an `initiator_id` is present (indicating an extension-initiated flow), `AuthForm.tsx` sets a temporary cookie (e.g., `oauth_initiator_id`) containing this `initiator_id`. This cookie is short-lived (e.g., 5 minutes for OAuth, 15 minutes for email confirmation).
       - The `redirectTo` option for `supabase.auth.signInWithOAuth` (for Google) or `options.emailRedirectTo` for `supabase.auth.signUp` (for email confirmation) is set to the server's generic callback URL (e.g., `${process.env.REACT_APP_BASE_API_URL}/auth/callback`) _without_ the `initiator_id` in its query string.
     - **For Email Sign-In:**
       - `AuthForm.tsx` clears any `oauth_initiator_id` cookie.
       - After successful email/password sign-in, it constructs the redirect URL for `/auth/callback/success`.
       - If the `initiator_id` (read from the `/login` page's URL) matches a known extension ID, it appends the corresponding `extension_id` or `dev_extension_id` query parameter to the `/auth/callback/success` URL. Otherwise, these parameters are omitted.
       - It then redirects the browser directly to this constructed `/auth/callback/success` URL.

  2. **Server-Side Callback (`/auth/callback/route.ts` - GET handler):**

     - This route is hit after a successful Google OAuth authentication (Google redirects here) or when a user clicks an email confirmation link.
     - It first attempts to read the `initiator_id` from the `oauth_initiator_id` cookie. If found, the cookie's value is used as the `initiator_id`, and the cookie is immediately deleted.
     - If the cookie is not found, it attempts to read `initiator_id` from the request URL's query parameters (as a fallback, though less common for these flows now).
     - After exchanging the authorization code for a session with Supabase and fetching the user's profile:
       - It constructs the redirect URL for the frontend `/auth/callback/success` page.
       - It appends the session token and profile data (or profile error status) as query parameters.
       - **Conditionally appends extension identifiers**:
         - If the "effective `initiator_id`" (from cookie or query parameter) matches `process.env.NEXT_PUBLIC_EXTENSION_ID`, it adds `&extension_id=...` to the URL.
         - If it matches `process.env.NEXT_PUBLIC_DEV_EXTENSION_ID`, it adds `&dev_extension_id=...` to the URL.
         - If `initiator_id` is null or doesn't match, neither of these is added (indicating a website flow).
       - It then redirects the user to this fully constructed `/auth/callback/success` URL.

  3. **Frontend Success Page (`/auth/callback/success` - `AuthCallbackHandler.tsx`):**
     - Reads URL query parameters: `token`, profile data, `extension_id`, `dev_extension_id`.
     - **If `extension_id` or `dev_extension_id` is present (Extension Flow):**
       - It uses `chrome.runtime.sendMessage(targetExtensionId, payload)` to send the auth token and profile data to the extension's background script.
       - Displays a message: "Authentication successful! Securely sending data to the extension. This window will close automatically."
       - Attempts to close itself (`window.close()`).
     - **If neither `extension_id` nor `dev_extension_id` is present (Website Flow):**
       - Displays a message: "Authentication successful! Redirecting to the homepage..."
       - Redirects the user to the website's homepage (e.g., `/`) after a short delay.

### 7.2. Chrome Extension Authentication

- **Token Reception & Storage:**
  - `background.ts` (listening via `onMessageExternal` or `onMessage` for messages from the known server origin, specifically the `/auth/callback/success` page) receives the `{ type: "AUTH_TOKEN_FROM_SERVER", token, profile }` payload.
  - `background.ts` then forwards this payload to the extension's UI components (e.g., `App.tsx` through the `useChromeMessageListener` hook) using an internal `chrome.runtime.sendMessage({ action: "UPDATE_AUTH_STATE", payload: { token, profile } })`.
  - The `useChromeMessageListener` hook in `App.tsx` listens for `UPDATE_AUTH_STATE` message, then dispatches actions to `authSlice` (Redux) to store the token and user profile information (`isAuthenticated`, `userProfile` which includes `subscription_status`, `daily_video_count`, `stripe_customer_id`).
  - The hook also saves the `authToken` and `userProfile` to `chrome.storage.local` for persistence.
  - On app initialization, the `useInitialization` hook attempts to load `authToken` and `userProfile` from `chrome.storage.local` to rehydrate the Redux state.

### 7.3. User Profiles

- **Profile Creation:**
  - Automatically created on first sign-in via a Supabase Auth trigger.
- **Profile Fields (relevant to subscription & usage):**
  ```sql
  id: uuid (references auth.users)
  email: string
  stripe_customer_id: string | null       -- Stripe Customer ID
  subscription_status: "free" | "premium" | null -- Managed by Stripe webhooks
  subscription_id: string | null                -- Stripe Subscription ID
  subscription_end_date: timestamp | null       -- Current period end for the subscription
  daily_video_count: number | null            -- (May be deprecated if primarily counting from `daily_video_limits`)
  last_ip_address: text | null
  -- Removed premium_trials table and related fields/logic
  ```
- **`daily_video_limits` table:**
  ```sql
  id: uuid
  user_id: uuid (references profiles.id)
  video_id: text -- Changed from UUID. Stores the unique video URL or identifier like imdb:xxxx
  created_at: timestamp
  ```
  This table is used by the `checkVideoLimit` server action to count unique videos processed by a free user on a given day. The foreign key from `video_id` to `videos.id` has been removed.

## 8. Subscription Plans & Features

### 8.1. Free Plan

- **Limitations:**
  - **4 unique videos/movies per day.** This limit is checked by the `checkVideoLimit` server action against the `daily_video_limits` table.
  - Basic voice options only (browser-based TTS).
  - No access to premium voices (OpenAI/Google TTS via server).
- **Features:**
  - Access to all basic dubbing features using browser-based TTS.
  - Support for all languages (limited by browser TTS capabilities).
  - Basic voice quality (browser-based TTS).

### 8.2. Premium Plan

- **Benefits:**
  - Unlimited videos/movies per day.
  - Access to all premium voices (OpenAI/Google TTS via server).
  - Early access to new features.
- **Features:**
  - All free plan features.
  - Premium voice options (OpenAI/Google TTS).
  - Advanced audio quality options.

### 8.3. Subscription Management (Server)

- **Subscription Status Tracking:**
  - `subscription_status`, `subscription_id`, `stripe_customer_id`, and `subscription_end_date` in the `profiles` table.
  - Updated via Stripe webhooks (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`) processed by `/api/stripe/webhook/route.ts` calling `handleStripeWebhook` server action.
  - `handleStripeWebhook` uses an admin Supabase client (initialized directly with service role key from `@supabase/supabase-js`) for database updates.
- **Usage Tracking (Free Tier):**
  - `checkVideoLimit` server action (`subscription.ts`):
    - If user is free:
      - Counts unique `video_id` entries in `daily_video_limits` for the user for the current day (UTC).
      - If `videoUrlToCheck` is provided and it's a new video for the day and user is within limit, records it in `daily_video_limits`.
    - Returns `canProcess`, `dailyProcessedVideoCount`, `remainingVideos`, `isPremium`.
  - No trial period functionality.

### 8.4. Feature Access Control (Chrome Extension)

- **Dubbing Initiation (`DubbingPage.tsx` - `handleDubbingToggle`):**
  - **Authentication:** If not authenticated (checked via `authSlice.isAuthenticated`), opens server login page in a popup.
  - **Usage Limit & Premium Voice (if authenticated):**
    1. Calls `checkVideoLimit` server action (passing `videoUrlToCheck`).
    2. Gets `canProcess`, `remainingVideos`, `isPremium` from response.
    3. **Persistent Daily Limit Warning:** If `!isPremium` and `remainingVideos <= 0` (from the general limit check), a persistent red-colored banner is displayed at the bottom of `DubbingPage`.
    4. **Immediate Action Toast (Daily Limit):** If `!canProcess` (for the specific `videoUrlToCheck`) and `!isPremium`, an immediate Sonner toast is shown ("You've reached your daily limit...") with remaining count and "Go Premium" link; dubbing is blocked for this new video. Re-watches are allowed as `canProcess` will be true.
    5. If checks pass, proceeds to `toggleDubbingProcess`. (Server-side check in `generateAudioChunk` will still prevent premium voice usage for non-premium users).
- \*\*Settings Page (`SettingsPage.tsx`):
  - Allows free users to _select_ premium voices (stores in Redux state), but the `generateAudioChunk` server action will block their use if the user is not premium.
  - A warning is displayed on the settings page if a non-premium user selects a premium voice.
- No trial-related UI or logic.

## 8. TTS Statistics Logging

### 8.1. Overview

The system now includes comprehensive statistics collection and logging for local Chrome TTS usage. This provides analytics to understand user behavior and TTS performance across different languages, voices, and usage patterns.

### 8.2. Implementation Components

**Chrome Extension Components:**

1. **TtsManager Statistics Collection (`extension/src/extension/content/TtsManager.ts`):**

   - Tracks utterance counts, durations, success/failure rates
   - Records language and voice usage patterns
   - Measures session timing and performance metrics
   - Provides methods to get and clear statistics

2. **DubbingManager Integration (`extension/src/extension/content/DubbingManager.ts`):**

   - Exposes methods to retrieve TTS statistics from TtsManager
   - Automatically collects statistics when dubbing stops
   - Returns statistics as part of the stop operation

3. **Content Script Response (`extension/src/extension/content.ts`):**

   - Includes TTS statistics in the response when stopping dubbing
   - Passes statistics from DubbingManager to the popup

4. **Popup UI Integration (`extension/src/pages/DubbingPage.tsx`):**
   - Collects TTS statistics when user clicks "Stop Dubbing"
   - Sends statistics to server via API call
   - Includes contextual information (current URL, video ID)

**Server Components:**

5. **Server Action (`server/src/app/actions/admin/logs.ts`):**

   - `logTtsStatisticsAction`: Processes and logs TTS statistics
   - Calculates derived metrics (error rates, usage patterns)
   - Stores comprehensive log entries in the database

6. **API Route Integration (`server/src/app/api/actions/[...actionName]/route.ts`):**
   - Exposes `admin/logTtsStatistics` endpoint
   - Handles authentication and request validation

### 8.3. Data Collection

**Statistics Tracked:**

- Total utterances attempted and completed
- Success vs. failure rates
- Session duration and timing metrics
- Language usage patterns by frequency
- Voice usage patterns by frequency
- Average utterance duration
- Session context (URL, video ID)

**Derived Analytics:**

- Error rates and success rates
- Utterances per minute (usage intensity)
- Primary language and voice preferences
- Session activity patterns

### 8.4. Data Flow

1. **Collection Phase:**

   - TtsManager tracks statistics during active dubbing session
   - Statistics accumulate across all TTS operations
   - Timing and performance data recorded in real-time

2. **Transmission Phase:**

   - User clicks "Stop Dubbing" in extension popup
   - DubbingManager collects final statistics from TtsManager
   - Content script returns statistics in stop response
   - Popup sends statistics to server via API

3. **Storage Phase:**
   - Server validates and processes statistics
   - Calculates additional metrics and insights
   - Stores structured log entry in `app_logs` table
   - Data available for admin dashboard analytics

### 8.5. Benefits

- **User Behavior Insights:** Understanding language preferences and usage patterns
- **Performance Monitoring:** Tracking TTS success rates and error patterns
- **Feature Usage:** Measuring adoption of different voices and modes
- **Quality Metrics:** Identifying common failure scenarios
- **Usage Analytics:** Understanding session lengths and user engagement

### 8.6. Privacy & Security

- Statistics are only collected for authenticated users
- No sensitive personal data is stored in statistics
- URL and video IDs provide context without exposing private content
- Data used for aggregate analytics and system improvement
