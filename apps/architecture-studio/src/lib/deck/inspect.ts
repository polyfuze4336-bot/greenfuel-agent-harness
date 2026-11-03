// Reads a finished .pptx and reports what is in it, so editability and completeness can be shown from the file and not from the generator's
// intentions: native slides, speaker notes, native charts, tables and live text, and how many pictures there are.
export interface PptxInspection {
  slides: number;
  notesSlides: number;
  charts: number;
  media: string[];
  /** Per slide: native tables, text runs, shapes and pictures. */
  perSlide: { index: number; tables: number; textRuns: number; shapes: number; pictures: number; titleText: string }[];
  coreTitle: string | null;
  coreSubject: string | null;
}

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

export async function inspectPptx(buf: Buffer): Promise<PptxInspection> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const slideFiles = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const perSlide: PptxInspection['perSlide'] = [];
  for (const [i, f] of slideFiles.entries()) {
    const xml = await zip.files[f]!.async('string');
    const firstText = /<a:t>([^<]*)<\/a:t>/.exec(xml)?.[1] ?? '';
    perSlide.push({ index: i + 1, tables: count(xml, /<a:tbl>/g), textRuns: count(xml, /<a:t>/g), shapes: count(xml, /<p:sp>/g), pictures: count(xml, /<p:pic>/g), titleText: firstText });
  }
  const core = zip.files['docProps/core.xml'] ? await zip.files['docProps/core.xml']!.async('string') : '';
  return {
    slides: slideFiles.length,
    notesSlides: names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).length,
    charts: names.filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)).length,
    media: names.filter((n) => n.startsWith('ppt/media/') && !n.endsWith('/')),
    perSlide,
    coreTitle: /<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1] ?? null,
    coreSubject: /<dc:subject>([^<]*)<\/dc:subject>/.exec(core)?.[1] ?? null,
  };
}
