import { parse } from 'node-html-parser';
import { fetchResponse, MovieList, SubtitleList, type SubtitleOptions, type SubtitleInfo, fetchJson } from '../utils/download';

const SITE = 'https://www.opensubtitles.com';

class OpenSubtitlesMovieLink extends MovieList {
  constructor(title: string, link: string, options: SubtitleOptions) {
    super(title, link, options);
  }
  async toSubtitleLinks(): Promise<OpenSubtitlesSubtitleLink[]> {
    const {body} = await fetchResponse(this.link);
    const {data} = JSON.parse(body) as {data: string[][]};

    return data.map(s => new OpenSubtitlesSubtitleLink(this, parse(s.at(-1)!).querySelector('a[data-remote="true"]')?.getAttribute('href')!, {
      filename: parse(s[2]).textContent?.split('\n', 1)?.[0],
      language: parse(s[1]).firstElementChild?.getAttribute('title'),
    })).filter(subtitle => subtitle._link != undefined);
  }
}

class OpenSubtitlesSubtitleLink extends SubtitleList {
  constructor(page: OpenSubtitlesMovieLink, _link: string, info: SubtitleInfo) {
    super(page, _link, info);
  }

  async downloadLink(): Promise<string | undefined> {
    if (this.link) return this.link;

    const { body } = await fetchResponse(SITE + this._link, {
      headers: {
        'x-csrf-token': 'SZHfvYUiNV3uhpKkRPfQPcfhqtrdJVw9hCwxAc+XknB5Wsct+7gZOHlrwJqWElrevrWoZlReTBeJmSPPIVWmzw==',
        'x-requested-with': 'XMLHttpRequest',
      }
    });

    const match = body.match(/file_download\('([^']*?)','([^']*?)'/);
    const filename = match?.[1];
    const downloadLink = match?.[2];
    this.info.filename = filename ?? this.info.filename;

    this.link = downloadLink;
    return downloadLink;
  }
}

interface OpenSubtitlesSuggestion {
  title: string;
  year: string;
  id: string;
  poster: string;
  rating: number;
  subtitles_count: number;
  type: string;
  path: string;
}

export default async function fetchOpenSubtitlesCom(query: string, options: SubtitleOptions = {}): Promise<OpenSubtitlesMovieLink[]> {
  const languageID = options.language ?? 'en';
  const {json} = await fetchJson(SITE + `/en/en/search/autocomplete/${query}.json`) as {json: OpenSubtitlesSuggestion[]};

  return Array.from(json).map(e => new OpenSubtitlesMovieLink(
    e.title,
    SITE + '/' + languageID + e.path.replace('current_locale', languageID).replace('movies', 'features') + '/subtitles.json',
    options,
  ));
}

