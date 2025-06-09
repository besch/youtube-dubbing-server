"use strict";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { parse, type HTMLElement } from "node-html-parser";
import * as JSZip from "jszip";
import { search, sortKind, type FullOptions } from "fast-fuzzy";

export interface SubtitleInfo {
  filename?: string;
  language?: string;
}

export interface SubtitleOptions {
  language?: LanguageID;

  // Following options are overridden in searchOptions
  // keySelector: () => string,
  // returnMatchData: false,
  // sortBy: sortKind.bestMatch,
  searchOptions?: FullOptions<SubtitleList>;
}

export class MovieList {
  constructor(
    public title: string,
    public link: string,
    public options: SubtitleOptions
  ) {}

  async toSubtitleLinks(): Promise<SubtitleList[]> {
    return [];
  }
}

export class SubtitleList {
  isZip(): boolean {
    return false;
  }

  // Populated after downloadLink is called
  link?: string;
  constructor(
    public page: MovieList,
    public _link: string,
    public info: SubtitleInfo
  ) {}

  // You may set link to `undefined` to force refetching
  // Note: in some cases _link and link may be the same so refetching is never done
  async downloadLink(): Promise<string | undefined> {
    return;
  }

  // Unpacks the zip file and returns the subtitle file inside
  private async unpackzip(
    data: ArrayBuffer
  ): Promise<DownloadedFileSubtitles[]> {
    const zip = await JSZip.loadAsync(data);

    const allFiles = Object.values(zip.files).filter((v: any) => !v.dir);
    let strFiles = allFiles.filter((v: any) => v.name.endsWith(".srt"));
    if (strFiles.length === 0) strFiles = allFiles;
    if (strFiles.length === 1)
      return [
        new DownloadedFileSubtitles(
          await strFiles[0].async("text"),
          strFiles[0].name
        ),
      ];

    const retval = search(this.info.filename!, strFiles as any[], {
      ignoreCase: true,
      ignoreSymbols: true,
      normalizeWhitespace: true,
      sortBy: sortKind.bestMatch,
      keySelector(item: any) {
        return item.name;
      },
      threshold: 0,
    }).map(
      async (v: any) =>
        new DownloadedFileSubtitles(await v.async("text"), v.name)
    );
    return Promise.all(retval);
  }

  // Downloads the subtitle file and unpacks to zip if necessary
  // Internally invokes downloadLink, so subsequent calls should not fetch again
  async download(): Promise<DownloadedFile> {
    const url = await this.downloadLink();
    if (!url) throw new Error("downloadLink returned undefined");

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const contentDisposition = response.headers.get("content-disposition");
    if (contentDisposition && !this.info.filename) {
      const filenameMatch = contentDisposition.match(/filename="([^"]+?)"/);
      if (filenameMatch && filenameMatch[1]) {
        this.info.filename = filenameMatch[1];
      }
    }

    let subtitles: string;
    if (this.isZip()) {
      const buffer = await response.arrayBuffer();
      try {
        return new DownloadedFile(await this.unpackzip(buffer), this);
      } catch (e) {
        console.error("error when unpacking zip", e);
        try {
          // try to treat it as plain text (I've seen a plaintext file named .zip on some sites)
          const string = new TextDecoder("utf-8", { fatal: true }).decode(
            buffer
          );
          subtitles = string;
        } catch (e2) {
          console.error("error when decoding as plaintext", e2);
          throw new Error(
            `Could not unpack ZIP file and could not treat it as plaintext\nZip: ${e}\nPlaintext: ${e2}`
          );
        }
      }
    } else {
      subtitles = await response.text();
    }

    return new DownloadedFile(
      [new DownloadedFileSubtitles(subtitles, this.info.filename)],
      this
    );
  }
}

export type LanguageID =
  | "an" // Aragonese
  | "ar" // Arabic
  | "at" // Asturian (non standard?)
  | "bg" // Bulgarian
  | "br" // Breton
  | "ca" // Catalan
  | "cs" // Czech
  | "da" // Danish
  | "de" // German
  | "el" // Greek
  | "en" // English
  | "eo" // Esperanto
  | "es" // Spanish
  | "et" // Estonian
  | "eu" // Basque
  | "fa" // Persian
  | "fi" // Finnish
  | "fr" // French
  | "gl" // Galician
  | "he" // Hebrew
  | "hi" // Hindi
  | "hr" // Croatian
  | "hu" // Hungarian
  | "hy" // Armenian
  | "id" // Indonesian
  | "is" // Icelandic
  | "it" // Italian
  | "ja" // Japanese
  | "ka" // Georgian
  | "km" // Khmer
  | "ko" // Korean
  | "mk" // Macedonian
  | "ms" // Malay
  | "nl" // Dutch
  | "no" // Norwegian
  | "oc" // Occitan
  | "pt-br" // Portuguese, Brazilian
  | "pl" // Polish
  | "pt" // Portuguese
  | "ro" // Romanian
  | "ru" // Russian
  | "si" // Sinhala
  | "sk" // Slovak
  | "sl" // Slovenian
  | "sq" // Albanian
  | "sr" // Serbian
  | "sv" // Swedish
  | "th" // Thai
  | "tl" // Tagalog
  | "tr" // Turkish
  | "tt" // Tatar
  | "uk" // Ukrainian
  | "uz" // Uzbek
  | "vi" // Vietnamese
  | "zh" // Chinese
  | "zh-tw"; // Chinese Traditional

export const LanguageNameMap: Record<LanguageID, string> = {
  an: "Aragonese",
  ar: "Arabic",
  at: "Asturian",
  bg: "Bulgarian",
  br: "Breton",
  ca: "Catalan",
  cs: "Czech",
  da: "Danish",
  de: "German",
  el: "Greek",
  en: "English",
  eo: "Esperanto",
  es: "Spanish",
  et: "Estonian",
  eu: "Basque",
  fa: "Persian",
  fi: "Finnish",
  fr: "French",
  gl: "Galician",
  he: "Hebrew",
  hi: "Hindi",
  hr: "Croatian",
  hu: "Hungarian",
  hy: "Armenian",
  id: "Indonesian",
  is: "Icelandic",
  it: "Italian",
  ja: "Japanese",
  ka: "Georgian",
  km: "Khmer",
  ko: "Korean",
  mk: "Macedonian",
  ms: "Malay",
  nl: "Dutch",
  no: "Norwegian",
  oc: "Occitan",
  "pt-br": "Brazilian Portuguese",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  si: "Sinhala",
  sk: "Slovak",
  sl: "Slovenian",
  sq: "Albanian",
  sr: "Serbian",
  sv: "Swedish",
  th: "Thai",
  tl: "Tagalog",
  tr: "Turkish",
  tt: "Tatar",
  uk: "Ukrainian",
  uz: "Uzbek",
  vi: "Vietnamese",
  zh: "Chinese",
  "zh-tw": "Traditional Chinese",
};

interface FetchResponse {
  bodyUsed: true;
  headers: Headers;
  ok: boolean;
  redirected: boolean;
  status: number;
  statusText: string;
  url: string;
}

export async function fetchResponse(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<FetchResponse & { body: string }> {
  const response = await fetch(input, init);
  return {
    headers: response.headers,
    ok: response.ok,
    redirected: response.redirected,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    body: await response.text(),
    bodyUsed: true,
  };
}

export async function fetchJson(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<FetchResponse & { json: any }> {
  const response = await fetch(input, init);
  if (!response.ok)
    throw new Error(
      `HTTP Error! status: ${response.status}\nBody: ${await response.text()}`
    );
  return {
    headers: response.headers,
    ok: response.ok,
    redirected: response.redirected,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    json: await response.json(),
    bodyUsed: true,
  };
}

export async function fetchHtml(
  input: RequestInfo | URL,
  init?: RequestInit,
  errorOnBadResponse: boolean = true
): Promise<HTMLElement> {
  const response = await fetch(input, init);
  if (!response.ok && errorOnBadResponse)
    throw new Error(
      `HTTP Error! status: ${response.status}\nBody: ${await response.text()}`
    );
  const dom = parse(await response.text());
  return dom;
}

export class DownloadedFileSubtitles {
  constructor(public subtitles: string, public filename?: string) {}
}

export class DownloadedFile {
  constructor(
    public subtitles: DownloadedFileSubtitles[],
    public parent: SubtitleList
  ) {}
}
