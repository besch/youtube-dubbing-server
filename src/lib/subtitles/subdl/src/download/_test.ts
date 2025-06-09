import type { MovieList, SubtitleOptions } from "../utils/download";
import fetchMovieSubtitlesOrg from "./moviesubtitles.org";
import fetchMoviesubtitlesrtCom from "./moviesubtitlesrt.com";
import fetchOpenSubtitlesCom from "./opensubtitles.com";
import fetchPodnapisiNet from "./podnapisi.net";
import fetchSubdlCom from "./subdl.com";
import fetchYifySubtitlesCh from "./yifysubtitles.ch";

async function testGetters(
  getter: (query: string, options: SubtitleOptions) => Promise<MovieList[]>
) {
  console.log(getter);

  const list = await getter("The Matrix", { language: "en" });
  console.log(list);

  const subtitles = await list[0].toSubtitleLinks();
  console.log(subtitles[0]);

  const file = await subtitles[0].download();
  console.log(
    file.subtitles[0].filename + ":",
    file.subtitles[0].subtitles.slice(0, 100)
  );
}

async function test() {
  const funcs = [
    fetchOpenSubtitlesCom,
    //fetchMovieSubtitlesOrg,
    //fetchYifySubtitlesCh,
    //fetchSubdlCom,
    //fetchPodnapisiNet,
    //fetchMoviesubtitlesrtCom,
  ];

  for (const func of funcs) {
    await testGetters(func);
    console.log("\n---\n");
  }
}

test();
