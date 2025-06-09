'use strict';
import { fetchHtml, type SubtitleOptions, type SubtitleInfo, MovieList, SubtitleList, fetchJson } from '../utils/download';

const SITE = 'https://www.podnapisi.net';

class PodnapisiMovieLink extends MovieList {
  constructor(title: string, link: string, options: SubtitleOptions) {
    super(title, link, options);
  }
  async toSubtitleLinks(): Promise<PodnapisiSubtitleLink[]> {
    const root = await fetchHtml(SITE + '/subtitles/search/' + this.link);
    const mt = new PodnapisiSubtitleLink(undefined!, undefined!, undefined!);

    let retval = Array.from(root.getElementsByTagName('tbody')[0].children).map(tr => {
      const lang = tr.getElementsByTagName('abbr')[0].textContent;
      if (this.options.language && lang != this.options.language) return mt;

      return new PodnapisiSubtitleLink(this, tr.querySelector('a[rel="nofollow"]')?.getAttribute('href')!, {
        filename: tr.querySelector('span[class="release"]')?.textContent,
        language: lang,
      });
    }).filter(subtitle => subtitle._link != undefined);

    return retval;
  }
}

class PodnapisiSubtitleLink extends SubtitleList {
  isZip(): boolean { return true; }

  constructor(page: PodnapisiMovieLink, _link: string, info: SubtitleInfo) {
    super(page, _link, info);
  }

  async downloadLink(): Promise<string> {
    return SITE + this._link;
  }
}

interface PodnapisiSuggestion {
  aliases: string[]
  id: string
  posters: {
    inline: string
    normal: string
    small: string
    title: string
  }
  providers: string[]
  slug: string
  title: string
  type: 'tv-series' | 'movie' | 'mini-series' | string
  year: number
}

interface PodnapisiSuggestionResult {
  aggs: unknown // {} in all responses
  data: PodnapisiSuggestion[]
  status: string
}

export default async function fetchPodnapisiNet(query: string, options: SubtitleOptions = {}): Promise<PodnapisiMovieLink[]> {
  const {json} = await fetchJson(SITE + '/moviedb/search/?keywords=' + query, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
    }
  }) as {json: PodnapisiSuggestionResult};

  return Array.from(json.data).map(e => new PodnapisiMovieLink(e.title, e.id, options));
}

