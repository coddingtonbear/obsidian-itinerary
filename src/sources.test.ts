import { describe, test, expect, vi } from "vitest";
import { SourceLookup, resolveSourcePath } from "./sources";

function lookup(
  links: Record<string, string>,
  files: string[]
): SourceLookup {
  return {
    resolveLink: (linkpath) => links[linkpath] ?? null,
    fileExists: (path) => files.includes(path),
  };
}

describe("resolveSourcePath", () => {
  const vault = lookup(
    { Trip: "plans/Trip.md", "plans/Trip": "plans/Trip.md" },
    ["plans/Trip.md", "Root.md"]
  );

  test("resolves a link", () => {
    expect(resolveSourcePath("[[Trip]]", "index.md", vault)).toBe(
      "plans/Trip.md"
    );
  });

  test("resolves a link with a folder", () => {
    expect(resolveSourcePath("[[plans/Trip]]", "index.md", vault)).toBe(
      "plans/Trip.md"
    );
  });

  test("ignores display text and headings in a link", () => {
    expect(
      resolveSourcePath("[[Trip#Oaxaca|the trip]]", "index.md", vault)
    ).toBe("plans/Trip.md");
  });

  test("passes the linking note to link resolution", () => {
    const resolveLink = vi.fn(() => "x.md");
    resolveSourcePath("[[Trip]]", "folder/index.md", {
      resolveLink,
      fileExists: () => false,
    });
    expect(resolveLink).toHaveBeenCalledWith("Trip", "folder/index.md");
  });

  test("rejects an unresolved link", () => {
    expect(() => resolveSourcePath("[[Missing]]", "index.md", vault)).toThrow(
      "Could not resolve [[Missing]] to a note."
    );
  });

  test("accepts a vault-relative path", () => {
    expect(resolveSourcePath("plans/Trip.md", "index.md", vault)).toBe(
      "plans/Trip.md"
    );
  });

  test("accepts a vault-relative path without its extension", () => {
    expect(resolveSourcePath("Root", "index.md", vault)).toBe("Root.md");
  });

  test("uses a path with no file yet as written", () => {
    // As in version 1: the note may not have been created yet, and its
    // events appear once it is.
    expect(resolveSourcePath("nowhere.md", "index.md", vault)).toBe(
      "nowhere.md"
    );
  });
});
