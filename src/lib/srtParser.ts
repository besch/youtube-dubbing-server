export interface SrtObject {
  index?: string;
  timestamp?: string;
  start?: string;
  end?: string;
  text: string;
}

export default function parseSrt(srtContent: string): SrtObject[] {
  const srtObjects: SrtObject[] = [];
  const blocks = srtContent.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;

    const [index, timestamp, ...textLines] = lines;
    const [start, end] = timestamp.split(" --> ");

    const text = textLines
      .join(" ")
      .replace(/\s+/g, " ")
      .replace(/(<[^>]+>) /g, "$1") // Remove space after HTML-like tags
      .replace(/\s*(\{\\[^}]+\})\s*/g, "$1") // Handle SRT formatting tags
      .trim();

    srtObjects.push({
      index,
      timestamp,
      start,
      end,
      text,
    });
  }

  return srtObjects;
}
