'use strict';

import { search, sortKind } from 'fast-fuzzy';
import { fetchHtml, LanguageNameMap, type SubtitleOptions, type SubtitleInfo, MovieList, SubtitleList, fetchJson } from '../utils/download';

const SITE = 'https://yifysubtitles.ch';

class YifySubtitlesMovieLink extends MovieList {
  constructor(title: string, link: string, options: SubtitleOptions) {
    super(title, link, options);
  }
  async toSubtitleLinks(): Promise<YifySubtitlesSubtitleLink[]> {
    const root = await fetchHtml(this.link);
    const table = root.getElementsByTagName('table')[0];

    let retval = Array.from(table.children).map(s => {
      const linkElem = s.querySelector('a > span[class="text-muted"]')?.parentNode;
      const filename = linkElem?.textContent.trim().split('\n', 1)[0];
      return new YifySubtitlesSubtitleLink(this, linkElem?.getAttribute('href')!, {
        filename: filename?.substring(filename.indexOf(' ')+1) + '.zip',
        language: s.querySelector('span[class="sub-lang"]')?.textContent,
      })
    }).filter(subtitle => subtitle._link != undefined);

    if (this.options.language) {
      const languageName = LanguageNameMap[this.options.language];
      retval = search(languageName, retval, Object.assign(this.options.searchOptions ?? {}, {
        keySelector: (e: YifySubtitlesSubtitleLink) => e.info.language,
        returnMatchData: false,
        sortBy: sortKind.bestMatch,
      }));
    }

    return retval;
  }
}

class YifySubtitlesSubtitleLink extends SubtitleList {
  isZip(): boolean { return true; }
  constructor(page: YifySubtitlesMovieLink, _link: string, info: SubtitleInfo) {
    super(page, _link, info);
  }

  async downloadLink(): Promise<string> {
    return (SITE + this._link + '.zip').replace('/subtitles/', '/subtitle/');
  }
}

interface YifySubtitlesSuggestion {
  movie: string;
  imdb: string;
}

export default async function fetchYifySubtitlesCh(query: string, options: SubtitleOptions = {}): Promise<YifySubtitlesMovieLink[]> {
  const {json} = await fetchJson(SITE + `/ajax/search/?mov=${query}`) as {json: YifySubtitlesSuggestion[]};
  return Array.from(json).map(e => new YifySubtitlesMovieLink(e.movie, SITE + '/movie-imdb/' + e.imdb, options));
}

