'use strict';
import { search, sortKind } from 'fast-fuzzy';
import { fetchHtml, type SubtitleOptions, type SubtitleInfo, MovieList, SubtitleList, LanguageNameMap } from '../utils/download';

const SITE = 'https://moviesubtitlesrt.com';

class MoviesubtitlesrtMovieLink extends MovieList {
  constructor(title: string, link: string, options: SubtitleOptions) {
    super(title, link, options);
  }
  async toSubtitleLinks(): Promise<MoviesubtitlesrtSubtitleLink[]> {
    const root = await fetchHtml(this.link);
    let lang = root.querySelector('tbody > tr:nth-child(2) > td:last-child')?.textContent?.trim();
    if (lang) lang = search(lang, Object.entries(LanguageNameMap), Object.assign(this.options.searchOptions ?? {}, {
      keySelector([_, v]: [string, string]) { return v; },
      returnMatchData: false,
      sortBy: sortKind.bestMatch,
    }))[0][0]


    let retval = [new MoviesubtitlesrtSubtitleLink(this, root.querySelector('center > a')?.getAttribute('href')!, {
      filename: this.title + '.zip',
      language: lang,
    })].filter(subtitle => subtitle._link != undefined);

    return retval;
  }
}

class MoviesubtitlesrtSubtitleLink extends SubtitleList {
  isZip(): boolean { return true; }

  constructor(page: MoviesubtitlesrtMovieLink, _link: string, info: SubtitleInfo) {
    super(page, _link, info);
  }

  async downloadLink(): Promise<string> {
    return this._link;
  }
}

export default async function fetchMoviesubtitlesrtCom(query: string, options: SubtitleOptions = {}): Promise<MoviesubtitlesrtMovieLink[]> {
  const root = await fetchHtml(SITE + '/?s=' + query);
  return Array.from(root.querySelectorAll('div[class="inside-article"] > header > h2 > a'))
    .map(e => new MoviesubtitlesrtMovieLink(e.textContent, e.getAttribute('href')!, options))
    .filter(movie => movie.title != undefined && movie.link != undefined);
  ;
}

