// Runs the PowerPoint render script (scripts/render-deck.ps1). PowerPoint produces the PDF, the slide images, and the measurements the quality
// checks use. It needs Windows and an installed Microsoft PowerPoint; without them the deck can still be built, but it is reported as not rendered.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { RenderedLayout } from './qa.ts';

const PATHS = [
  'C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
  'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
  'C:\\Program Files\\Microsoft Office\\Office16\\POWERPNT.EXE',
  'C:\\Program Files (x86)\\Microsoft Office\\Office16\\POWERPNT.EXE',
];

export const powerpointAvailable = (): boolean => process.platform === 'win32' && PATHS.some((p) => fs.existsSync(p));

function scriptPath(): string | null {
  const cands = [process.env.STUDIO_RENDER_SCRIPT, path.join(process.cwd(), 'scripts', 'render-deck.ps1'), path.join(process.cwd(), 'apps', 'architecture-studio', 'scripts', 'render-deck.ps1')].filter(Boolean) as string[];
  return cands.find((p) => fs.existsSync(p)) ?? null;
}

export interface Rendered {
  dir: string;
  pdf: string;
  layout: RenderedLayout;
  pngs: string[];
}

export async function renderDeck(pptx: string, outDir: string): Promise<Rendered> {
  if (!powerpointAvailable()) throw new Error('Microsoft PowerPoint is not installed here, so the deck cannot be rendered.');
  const script = scriptPath();
  if (!script) throw new Error('The render script scripts/render-deck.ps1 was not found.');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Pptx', pptx, '-OutDir', outDir], { timeout: 240_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(new Error(`PowerPoint rendering failed: ${(stderr || err.message).slice(0, 400)}`));
      else resolve();
    });
  });
  const layout = JSON.parse(fs.readFileSync(path.join(outDir, 'layout.json'), 'utf8').replace(/^\uFEFF/, '')) as RenderedLayout;
  const pngs = fs.readdirSync(outDir).filter((f) => /^slide-\d+\.png$/.test(f)).sort().map((f) => path.join(outDir, f));
  return { dir: outDir, pdf: path.join(outDir, 'deck.pdf'), layout, pngs };
}
