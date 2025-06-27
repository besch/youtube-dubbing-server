# Subtitle Service

A modular, extensible subtitle service with multiple provider support and automatic fallback. Supports OpenSubtitles.com (primary) and Subdl.com (fallback) with quality validation and translation capabilities.

## Architecture

The subtitle service is now organized around a provider-based architecture for better extensibility and fault tolerance:

### 📁 Module Structure

```
lib/subtitles/
├── index.ts               # Main exports (provider manager, service, types)
├── service.ts             # Main orchestration service
├── providers/             # Provider implementations
│   ├── index.ts          # Provider manager with fallback logic
│   ├── base.ts           # Provider interface and types
│   ├── opensubtitles.ts  # OpenSubtitles.com provider (primary)
│   ├── subdl.ts          # Subdl.com provider (fallback)
│   └── README.md         # Provider documentation
├── api-client.ts          # Subdl API client (internal)
├── downloader.ts          # File download and extraction (internal)
├── quality-validator.ts   # AI quality validation
├── translate.ts           # Translation service
├── utils.ts              # Utility functions
├── config.ts             # Configuration (internal)
└── README.md             # This file
```

### 🔧 Core Components

#### `SubtitleProviderManager` (`providers/index.ts`)

Manages multiple subtitle providers with automatic fallback logic.

**Key Features:**

- **Provider Priority System**: OpenSubtitles (priority 1) → Subdl (priority 2)
- **Automatic Fallback**: Seamlessly switches between providers
- **Availability Caching**: Checks provider health with 5-minute cache
- **Error Isolation**: Failed providers don't affect others
- **Comprehensive Logging**: Provider-specific error tracking

#### Provider System

**OpenSubtitles Provider** (Primary)

- Uses OpenSubtitles.com API v1
- Requires API key, optional authentication for higher limits
- Supports direct file ID downloads
- Language-specific search optimization

**Subdl Provider** (Fallback)

- Uses existing Subdl integration
- ZIP archive handling for TV episodes
- Reliable fallback when OpenSubtitles is unavailable

#### `SubtitleService` (`service.ts`)

Main orchestration service that coordinates providers, validation, and translation.

**Key Features:**

- Uses provider manager for source selection
- **Quality validation using Google Gemini AI**
- Automatic language detection and validation
- Translation fallback for non-target languages
- Comprehensive error handling and logging

## Usage

### Basic Usage

```typescript
import { subtitleService } from "@/lib/subtitles";

// Fetch movie subtitles with automatic provider fallback
const result = await subtitleService.getOrGenerateSubtitles({
  imdbID: "tt0111161",
  targetLanguage: "es",
});

// The service will automatically:
// 1. Try OpenSubtitles.com first
// 2. Fall back to Subdl.com if needed
// 3. Validate language using Google Gemini AI
// 4. Translate from best available language if needed

// Fetch TV show episode subtitles
const result = await subtitleService.getOrGenerateSubtitles({
  imdbID: "tt0944947",
  targetLanguage: "fr",
  seasonNumber: 1,
  episodeNumber: 1,
});
```

### Direct Provider Access

```typescript
import { subtitleProviderManager } from "@/lib/subtitles";

// Search with automatic fallback between providers
const searchResult = await subtitleProviderManager.searchWithFallback({
  imdbID: "tt1234567",
  targetLanguage: "en",
});

// Download from specific provider
const content = await subtitleProviderManager.downloadFromProvider(
  "opensubtitles",
  fileId, // For OpenSubtitles
  url // For Subdl
);
```

### Quality Validation

```typescript
import { subtitleQualityValidator } from "@/lib/subtitles";

// AI-powered language validation
const validationResult = await subtitleQualityValidator.validateSubtitleQuality(
  {
    content: srtContent,
    expectedLanguage: "en",
  }
);

console.log("Is valid:", validationResult.isValid);
console.log("Detected language:", validationResult.detectedLanguage);
console.log("Confidence:", validationResult.confidence);
```

## Configuration

### Environment Variables

```bash
# OpenSubtitles (Primary Provider)
OPENSUBTITLES_API_KEY=your_opensubtitles_api_key_here
OPENSUBTITLES_USERNAME=your_username  # Optional - for increased download limits
OPENSUBTITLES_PASSWORD=your_password  # Optional - for increased download limits

# Subdl (Fallback Provider)
SUBDL_API_KEY=your_subdl_api_key_here

# AI Quality Validation
GOOGLE_API_KEY=your_google_gemini_api_key_here
```

### Provider Availability

The system automatically detects which providers are available:

- **OpenSubtitles**: Requires API key, checks with simple search
- **Subdl**: Uses existing configuration, tests with known movie

Availability is cached for 5 minutes to prevent excessive health checks.

## Features

### 🎯 Multi-Provider Architecture

1. **Primary Provider**: OpenSubtitles.com with extensive API features
2. **Fallback Provider**: Subdl.com for reliability
3. **Automatic Switching**: Seamless fallback on errors or unavailability
4. **Provider Isolation**: Failures don't cascade between providers

### 🔄 Robust Error Handling

- **Service Errors**: Temporarily mark providers unavailable
- **Network Errors**: Automatic retry on next provider
- **Rate Limiting**: Graceful handling of API limits
- **Comprehensive Logging**: Provider-specific error context

### 📺 Universal Content Support

- **Movies**: Direct IMDB ID lookup
- **TV Shows**: Season/episode specific matching
- **Multiple Formats**: SRT, subtitle archives, direct downloads

### 🌐 Intelligent Language Handling

- **Direct Matching**: Target language priority
- **Quality Validation**: AI-powered language verification
- **Translation Fallback**: From best available source language
- **Language Detection**: Confidence scoring and validation

### 🔧 Type Safety & Extensibility

- **Provider Interface**: Easy addition of new subtitle sources
- **Full TypeScript**: No `any` types, comprehensive interfaces
- **Modular Design**: Clean separation of concerns

## Adding New Providers

The system is designed for easy extension. See `providers/README.md` for details on implementing new subtitle sources.

## Error Handling

```typescript
try {
  const result = await subtitleService.getOrGenerateSubtitles(options);
} catch (error) {
  if (error instanceof AppError) {
    console.log("Error code:", error.code);
    console.log("Error message:", error.message);
    // Message includes all provider errors for debugging
  }
}
```

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
