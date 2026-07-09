import {
  buildOpenSubtitlesSearchParams,
} from "@/lib/subtitles/providers/opensubtitles";
import {
  normalizeSubtitleLanguageCode,
  getLanguageSearchStrategy,
} from "@/lib/subtitles/utils";

describe("OpenSubtitles search param building", () => {
  it("excludes AI/machine translated and foreign-parts-only subs", () => {
    const p = buildOpenSubtitlesSearchParams(
      { imdbID: "tt0111161", targetLanguage: "fr" },
      "fr",
      { imdb_id: "0111161" }
    );
    expect(p.get("ai_translated")).toBe("exclude");
    expect(p.get("machine_translated")).toBe("exclude");
    expect(p.get("foreign_parts_only")).toBe("exclude");
  });

  it("marks movie searches with type=movie", () => {
    const p = buildOpenSubtitlesSearchParams(
      { imdbID: "tt0111161", targetLanguage: "fr" },
      "fr",
      { imdb_id: "0111161" }
    );
    expect(p.get("type")).toBe("movie");
    expect(p.get("season_number")).toBeNull();
  });

  it("marks TV episode searches with type=episode + season/episode", () => {
    const p = buildOpenSubtitlesSearchParams(
      {
        imdbID: "tt0111161",
        targetLanguage: "fr",
        seasonNumber: 4,
        episodeNumber: 8,
      },
      "fr",
      { imdb_id: "0111161" }
    );
    expect(p.get("type")).toBe("episode");
    expect(p.get("season_number")).toBe("4");
    expect(p.get("episode_number")).toBe("8");
  });

  it("orders by download_count desc", () => {
    const p = buildOpenSubtitlesSearchParams(
      { imdbID: "tt0111161", targetLanguage: "fr" },
      "fr",
      { imdb_id: "0111161" }
    );
    expect(p.get("order_by")).toBe("download_count");
    expect(p.get("order_direction")).toBe("desc");
  });
});

describe("language code normalization", () => {
  it("collapses pt-BR / pt-PT to pt (avoids known API bug)", () => {
    expect(normalizeSubtitleLanguageCode("pt-BR")).toBe("pt");
    expect(normalizeSubtitleLanguageCode("pt-PT")).toBe("pt");
  });

  it("collapses zh-CN / zh-TW to zh and fil to tl", () => {
    expect(normalizeSubtitleLanguageCode("zh-CN")).toBe("zh");
    expect(normalizeSubtitleLanguageCode("zh-TW")).toBe("zh");
    expect(normalizeSubtitleLanguageCode("fil")).toBe("tl");
  });

  it("strips region subtag for generic codes", () => {
    expect(normalizeSubtitleLanguageCode("en-US")).toBe("en");
  });
});

describe("language search strategy", () => {
  it("uses target language as primary, never includes it in fallback", () => {
    const s = getLanguageSearchStrategy("de");
    expect(s.primary).toBe("de");
    expect(s.fallback.split(",")).not.toContain("de");
    expect(s.fallback.split(",")).toContain("en");
  });
});
