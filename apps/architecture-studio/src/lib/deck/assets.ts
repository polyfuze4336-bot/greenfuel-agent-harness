// Image and icon assets. A photograph or an official icon enters the deck only through a manifest entry that names its source and licence,
// records who approved it, and carries the file's hash. Anything that is missing falls back to original vector artwork or a labelled tile,
// and the deck's asset report says so: nothing is generated, scraped or assumed to be licensed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface AssetEntry {
  id: string;
  kind: 'photo' | 'illustration' | 'azure-icon';
  file: string;
  title: string;
  creator: string;
  source: string;
  licence: string;
  licenceUrl?: string;
  sha256: string;
  approved: boolean;
  approvedBy?: string;
  approvedAt?: string;
}

export interface AssetManifest {
  version: 1;
  assets: AssetEntry[];
}

export interface ResolvedAsset {
  entry: AssetEntry;
  absPath: string;
}

export interface AssetReport {
  slot: string;
  kind: 'photo' | 'azure-icon';
  /** What was used instead when no approved asset was available. */
  outcome: 'approved-asset' | 'fallback';
  detail: string;
}

export class Assets {
  readonly report: AssetReport[] = [];
  readonly dir: string;
  private manifest: AssetManifest;

  constructor(dir: string, manifest?: AssetManifest) {
    this.dir = dir;
    this.manifest = manifest ?? Assets.load(dir);
  }

  static load(dir: string): AssetManifest {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as AssetManifest;
      return m.version === 1 && Array.isArray(m.assets) ? m : { version: 1, assets: [] };
    } catch {
      return { version: 1, assets: [] };
    }
  }

  /** The approved, hash-verified asset for a slot, or null. */
  resolve(slot: string, kind: 'photo' | 'azure-icon'): ResolvedAsset | null {
    const entry = this.manifest.assets.find((a) => a.id === slot && a.kind === kind);
    const note = (outcome: AssetReport['outcome'], detail: string) => this.report.push({ slot, kind, outcome, detail });
    if (!entry) return note('fallback', 'No manifest entry.'), null;
    if (!entry.approved || !entry.approvedBy) return note('fallback', 'Not approved by a named person.'), null;
    if (!entry.licence || !entry.source) return note('fallback', 'Source or licence is not recorded.'), null;
    const abs = path.resolve(this.dir, entry.file);
    if (!abs.startsWith(path.resolve(this.dir) + path.sep)) return note('fallback', 'The file is outside the assets folder.'), null;
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(abs);
    } catch {
      return note('fallback', 'The file is missing.'), null;
    }
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) return note('fallback', 'The file does not match the recorded hash.'), null;
    note('approved-asset', `${entry.title} by ${entry.creator}, ${entry.licence}`);
    return { entry, absPath: abs };
  }
}
