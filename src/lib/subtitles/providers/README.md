# Subtitle Providers

This directory contains the modular subtitle provider system that allows for multiple subtitle sources with automatic fallback.

## Overview

The provider system is designed to be extensible and fault-tolerant. It attempts to fetch subtitles from multiple sources in priority order, falling back to the next provider if one fails.

## Current Providers

### 1. OpenSubtitles Provider (Priority: 1)

- **Name**: `opensubtitles`
- **Primary provider** with highest priority
- Uses OpenSubtitles.com API
- Requires API key: `OPENSUBTITLES_API_KEY`
- Optional authentication with username/password for increased download limits
- Supports direct download with file IDs

**Environment Variables:**

```bash
OPENSUBTITLES_API_KEY=your_api_key_here
OPENSUBTITLES_USERNAME=your_username  # Optional
OPENSUBTITLES_PASSWORD=your_password  # Optional
```

### 2. Subdl Provider (Priority: 2)

- **Name**: `subdl`
- **Fallback provider** when OpenSubtitles fails
- Uses existing SubdlApiClient
- Requires Subdl API configuration

## Architecture

### Base Interface

All providers implement the `SubtitleProvider` interface:

```typescript
interface SubtitleProvider {
  readonly name: string;
  readonly priority: number;

  searchSubtitles(options: SubtitleFetchOptions): Promise<SubtitleSearchResult>;
  downloadSubtitle(options: SubtitleDownloadOptions): Promise<string>;
  isAvailable(): Promise<boolean>;
}
```

### Provider Manager

The `SubtitleProviderManager` handles:

- Provider registration and ordering
- Availability checking with caching
- Automatic fallback between providers
- Error handling and logging

### Fallback Logic

1. Check each provider's availability (cached for 5 minutes)
2. Try providers in priority order (lowest number = highest priority)
3. If a provider returns results, use them
4. If a provider fails with a service error, mark it unavailable temporarily
5. Continue to next provider if current one fails
6. Return error if all providers fail

## Usage

```typescript
import { subtitleProviderManager } from "./providers";

// Search with automatic fallback
const result = await subtitleProviderManager.searchWithFallback({
  imdbID: "tt1234567",
  targetLanguage: "en",
  seasonNumber: 1, // Optional for TV shows
  episodeNumber: 5, // Optional for TV shows
});

// Download from specific provider
const content = await subtitleProviderManager.downloadFromProvider(
  "opensubtitles",
  fileId, // For OpenSubtitles
  downloadUrl // For Subdl
);
```

## Adding New Providers

To add a new provider:

1. Create a new file implementing `SubtitleProvider`
2. Add it to the provider registration in `index.ts`
3. Set appropriate priority (lower = higher priority)
4. Implement availability checking
5. Handle provider-specific download methods

Example:

```typescript
export class NewProvider implements SubtitleProvider {
  readonly name = "newprovider";
  readonly priority = 3; // Lower priority than existing providers

  async isAvailable(): Promise<boolean> {
    // Check if provider is accessible
  }

  async searchSubtitles(
    options: SubtitleFetchOptions
  ): Promise<SubtitleSearchResult> {
    // Implement search logic
  }

  async downloadSubtitle(options: SubtitleDownloadOptions): Promise<string> {
    // Implement download logic
  }
}
```

## Error Handling

The system includes comprehensive error handling:

- Service errors temporarily mark providers as unavailable
- Network errors are retried on next provider
- All errors are logged with provider context
- Final error includes all provider errors for debugging

## Caching

- Provider availability is cached for 5 minutes
- Prevents unnecessary health checks
- Automatically refreshes when cache expires
- Can be manually invalidated by marking providers unavailable
