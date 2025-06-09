'use strict';
import { fetchHtml, MovieList, SubtitleList, type SubtitleInfo, type SubtitleOptions } from '../utils/download';

const SITE = 'https://www.moviesubtitles.org';

class MoviesSubtitlesMovieLink extends MovieList {
  constructor(title: string, link: string, options: SubtitleOptions) {
    super(title, link, options);
  }

  async toSubtitleLinks(): Promise<MoviesSubtitlesSubtitleLink[]> {
    const root = await fetchHtml(SITE + this.link);
    const subtitleElements = root.querySelectorAll('div[style="margin-bottom:0.5em; padding:3px;"]');
    let retval = Array.from(subtitleElements)
      .map(e => new MoviesSubtitlesSubtitleLink(this, e.lastElementChild?.getAttribute('href')!, {
        filename: e.textContent.split('\n', 1)[0],
        language: e.firstElementChild?.getAttribute('src')?.split('/')?.at(-1)?.split('.')[0],
      }))
      .filter(subtitle => subtitle._link != undefined)
      .map(lnk => (lnk._link = lnk._link.replace('subtitle', 'download'), lnk))
    ;

    if (this.options.language) {
      retval = retval.filter(e => e.info.language == this.options.language);
    }

    return retval;
  }
}

class MoviesSubtitlesSubtitleLink extends SubtitleList {
  isZip(): boolean { return true; }

  constructor(page: MoviesSubtitlesMovieLink, _link: string, info: SubtitleInfo) {
    super(page, _link, info);
  }

  async downloadLink(): Promise<string> {
    return SITE + this._link;
  }
}

export default async function fetchMovieSubtitlesOrg(query: string, options: SubtitleOptions = {}): Promise<MoviesSubtitlesMovieLink[]> {
  const formData = new URLSearchParams();
  formData.append('q', query);

  const root = await fetchHtml(SITE + '/search.php', {
    method: 'POST',
    body: formData,
  }, /* Always gives 500 for some reason */ false);
  const movieElements = root.querySelectorAll('div[style="width:500px"] > a');
  return Array.from(movieElements)
    .map(e => new MoviesSubtitlesMovieLink(e.textContent, e.getAttribute('href')!, options))
    .filter(movie => movie.title != undefined)
  ;
}

