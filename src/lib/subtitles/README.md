# Subtitle Service

A modular, type-safe subtitle downloading and translation service that fetches subtitles from Subdl API and provides translation capabilities.

## Architecture

The subtitle service is organized into focused modules:

### 📁 Module Structure

```
lib/subtitles/
├── index.ts          # Main exports
├── service.ts        # Main orchestration service
├── api-client.ts     # Subdl API client with retry logic
├── downloader.ts     # File download and extraction
├── utils.ts          # Utility functions
├── config.ts         # Configuration and constants
└── README.md         # This file
```

### 🔧 Core Components

#### `SubtitleService` (`service.ts`)

Main orchestration service that coordinates fetching, downloading, and translating subtitles.

**Key Features:**

- Attempts direct language matches first
- Falls back to translation from best available subtitle
- Comprehensive error handling and logging
- Type-safe interfaces

#### `SubdlApiClient` (`api-client.ts`)

Handles all API communication with Subdl service.

**Key Features:**

- Automatic retry logic with exponential backoff
- Intelligent language priority querying
- Comprehensive error handling
- Request/response logging

#### Downloader (`downloader.ts`)

Handles downloading and extracting subtitle files from zip archives.

**Key Features:**

- Episode-specific file matching for TV shows
- Automatic encoding detection
- Multiple file format support
- Structured error handling

## Usage

### Basic Usage

```typescript
import { subtitleService } from "@/lib/subtitles";

// Fetch movie subtitles
const result = await subtitleService.getOrGenerateSubtitles({
  imdbID: "tt0111161",
  targetLanguage: "es",
});

// Fetch TV show episode subtitles
const result = await subtitleService.getOrGenerateSubtitles({
  imdbID: "tt0944947",
  targetLanguage: "fr",
  seasonNumber: 1,
  episodeNumber: 1,
});
```

### Response Format

```typescript
interface SubtitleDownloadResult {
  content: string; // SRT content
  generated: boolean; // Whether content was translated
  sourceLanguage?: string; // Original language if translated
}
```

## Configuration

### Environment Variables

```bash
SUBDL_API_KEY=your_subdl_api_key_here
```

### Supported Languages

- English (en)
- Spanish (es)
- French (fr)
- Russian (ru)
- German (de)
- Italian (it)
- Portuguese (pt)
- Japanese (ja)
- Chinese (zh)

## Features

### 🎯 Smart Language Matching

1. **Direct Match**: Attempts to find subtitles in target language
2. **Translation Fallback**: Translates from best available language
3. **Priority Querying**: Optimizes API calls based on target language

### 🔄 Robust Error Handling

- Automatic retries with exponential backoff
- Graceful degradation on download failures
- Comprehensive error logging and context

### 📺 TV Show Support

- Episode-specific file pattern matching
- Multiple naming convention support:
  - `S01E01` format
  - `1x01` format
  - Episode number with dash
  - Season/episode with prefix

### 🔧 Type Safety

- Full TypeScript coverage
- No `any` types
- Comprehensive interfaces for all data structures

### 📊 Detailed Logging

- Structured operation logging
- Performance metrics
- Error context and debugging information

## Error Handling

The service provides detailed error information:

```typescript
try {
  const result = await subtitleService.getOrGenerateSubtitles(options);
} catch (error) {
  if (error instanceof AppError) {
    console.log("Error code:", error.code);
    console.log("Error message:", error.message);
  }
}
```

### Common Error Codes

- `CONFIGURATION_ERROR`: Missing API key
- `RECORD_NOT_FOUND`: No subtitles found
- `SERVICE_ERROR`: API communication issues
- `UNEXPECTED_ERROR`: Unexpected failures

## Performance Optimizations

### Caching Strategy

- API responses can be cached at application level
- Download failures are retried automatically
- Connection pooling for HTTP requests

### Parallel Processing

- Multiple subtitle candidates tried in parallel
- Concurrent download attempts for redundancy

### Smart Querying

- Language priority optimization
- Reduced API calls through intelligent fallbacks

## Testing

```bash
# Run subtitle service tests
npm test -- subtitles

# Test specific functionality
npm test -- subtitles/api-client
npm test -- subtitles/downloader
```

## Contributing

When adding new features:

1. **Follow Module Structure**: Keep related functionality in focused modules
2. **Maintain Type Safety**: No `any` types, comprehensive interfaces
3. **Add Logging**: Use structured logging for debugging
4. **Error Handling**: Provide meaningful error messages and codes
5. **Documentation**: Update this README with new features

## Migration from Legacy Code

The new modular structure replaces the monolithic `fetch.ts` implementation:

### Before (Legacy)

```typescript
// All functionality in one large file
import { getBestSubtitle } from "./fetch";
```

### After (New)

```typescript
// Clean, modular imports
import { subtitleService } from "@/lib/subtitles";
import type { SubtitleFetchOptions } from "@/lib/subtitles";
```

### Benefits of Migration

- ✅ Better code organization and maintainability
- ✅ Improved error handling and logging
- ✅ Full type safety with no `any` types
- ✅ Easier testing and debugging
- ✅ More robust retry and fallback logic
- ✅ Better separation of concerns
