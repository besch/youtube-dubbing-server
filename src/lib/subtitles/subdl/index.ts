import { DownloadedFile, MovieList, SubtitleList, type SubtitleOptions } from "./src/utils/download";
import fetchOpenSubtitlesCom from "./src/download/opensubtitles.com";
import fetchMovieSubtitlesOrg from "./src/download/moviesubtitles.org";
import fetchMoviesubtitlesrtCom from "./src/download/moviesubtitlesrt.com";
import fetchPodnapisiNet from "./src/download/podnapisi.net";
import fetchSubdlCom from "./src/download/subdl.com";
import fetchYifySubtitlesCh from "./src/download/yifysubtitles.ch";
import { search, sortKind, type FullOptions } from "fast-fuzzy";

export type Fetcher = (query: string, options: SubtitleOptions) => Promise<MovieList[]>;

export const FetchOpenSubtitlesCom: Fetcher = fetchOpenSubtitlesCom;
export const FetchMovieSubtitlesOrg: Fetcher = fetchMovieSubtitlesOrg;
export const FetchMoviesubtitlesrtCom: Fetcher = fetchMoviesubtitlesrtCom;
export const FetchPodnapisiNet: Fetcher = fetchPodnapisiNet;
export const FetchSubdlCom: Fetcher = fetchSubdlCom;
export const FetchYifySubtitlesCh: Fetcher = fetchYifySubtitlesCh;

export interface DownloadOptions {
  movieListQuery: string;
  movieListSorter: FullOptions<MovieList>;
  subtitleListQuery: string;
  subtitleListSorter: FullOptions<SubtitleList>;
}

export const ErrNoMovies = new Error("No movies found");
export const ErrNoSubtitles = new Error("No subtitles found");

// throws ErrNoMovies if no movies found
// throws ErrNoSubtitles if no subtitles found
export async function Download(
  query: string,
  searchOptions: SubtitleOptions,
  getter: Fetcher,
  downloadOptions: DownloadOptions,
): Promise<DownloadedFile> {
  let movieList = await getter(query, searchOptions);
  if (movieList.length === 0) throw ErrNoMovies;

  if (downloadOptions.movieListQuery) {
    movieList = search(downloadOptions.movieListQuery, movieList, Object.assign(downloadOptions.movieListSorter ?? searchOptions.searchOptions ?? {}, {
      ignoreCase: true,
      ignoreSymbols: true,
      normalizeWhitespace: true,
      sortBy: sortKind.bestMatch,
      keySelector(item: MovieList) {return item.title;},
      threshold: 0,
    }));
  }

  let subtitleList = await movieList[0].toSubtitleLinks();
  if (subtitleList.length === 0) throw ErrNoSubtitles;

  if (downloadOptions.subtitleListQuery) {
    subtitleList = search(downloadOptions.subtitleListQuery, subtitleList, Object.assign(downloadOptions.subtitleListSorter ?? searchOptions.searchOptions ?? {}, {
      ignoreCase: true,
      ignoreSymbols: true,
      normalizeWhitespace: true,
      sortBy: sortKind.bestMatch,
      keySelector(item: SubtitleList) {return item.info.filename!;},
      threshold: 0,
    }));
  }

  return await subtitleList[0].download();
}

