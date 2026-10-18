import { DocumentPath } from "./types";

/** The vault lookups needed to turn a `source` into a document path. */
export interface SourceLookup {
  /** Resolves a link's target the way Obsidian does for `[[links]]`. */
  resolveLink(linkpath: string, fromPath: DocumentPath): DocumentPath | null;
  /** Whether a file exists at a vault-relative path. */
  fileExists(path: DocumentPath): boolean;
}

/** Resolves one `source` entry -- a `[[link]]` or a vault-relative path --
 * to the path of the document it names. */
export function resolveSourcePath(
  source: string,
  fromPath: DocumentPath,
  lookup: SourceLookup
): DocumentPath {
  const trimmed = source.trim();
  if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
    // Drop any display text (`[[Note|Shown]]`) and subpath (`[[Note#Heading]]`)
    const linkpath = trimmed.slice(2, -2).split("|")[0].split("#")[0].trim();
    const resolved = lookup.resolveLink(linkpath, fromPath);
    if (resolved === null) {
      throw new Error(`Could not resolve ${source} to a note.`);
    }
    return resolved;
  }

  if (lookup.fileExists(trimmed)) {
    return trimmed;
  }
  if (lookup.fileExists(`${trimmed}.md`)) {
    return `${trimmed}.md`;
  }
  throw new Error(`Could not find a note at "${source}".`);
}
