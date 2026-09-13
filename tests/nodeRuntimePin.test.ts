import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  loadNodeRuntimePin,
  loadPinnedLicense,
  PIN_DIRECTORY,
  PIN_FILE,
  SHASUMS_FILE,
  shasumsEntry,
  type NodeRuntimePin,
} from "../scripts/node-runtime-pin";

/**
 * The pin on the Node runtime Market OS redistributes.
 *
 * The defect these close: the build vendored `process.execPath` and recorded it as "a local Node
 * installation supplied to the build". That is a sentence, not a provenance — it accepts any binary
 * the build host happens to be running, and the only thing standing between a distribution and an
 * unidentifiable runtime was a major-version comparison. The licence was worse: the manifest said
 * `licenseTextIncluded: false` and explained why, which is an honest way to ship a redistributed
 * third-party binary without its notices.
 */

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** A synthetic repository, so the negative cases do not require damaging the real pin. */
function fakeRepo(
  over: {
    pin?: Partial<NodeRuntimePin>;
    shasums?: string;
    license?: string | null;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "mos-pin-"));
  const dir = join(root, ...PIN_DIRECTORY);
  mkdirSync(dir, { recursive: true });

  const licenseText = over.license === undefined ? "LICENCE TEXT\n" : (over.license ?? "");
  if (over.license !== null) {
    writeFileSync(join(dir, "LICENSE"), licenseText, "utf8");
  }

  const binaryHash = "a".repeat(64);
  const shasums = over.shasums ?? `${binaryHash}  win-x64/node.exe\n${"b".repeat(64)}  other\n`;
  writeFileSync(join(dir, SHASUMS_FILE), shasums, "utf8");

  const pin: NodeRuntimePin = {
    version: "v24.14.0",
    platform: "win-x64",
    binary: {
      upstreamPath: "win-x64/node.exe",
      sha256: binaryHash,
      bytes: 1,
      stagedAs: "node/node.exe",
    },
    license: {
      repositoryPath: `${PIN_DIRECTORY.join("/")}/LICENSE`,
      sha256: sha(licenseText),
      bytes: Buffer.byteLength(licenseText),
      stagedAs: "node/LICENSE",
      upstream: "https://example.invalid/LICENSE",
    },
    upstream: {
      release: "https://example.invalid/dist/",
      shasums: "https://example.invalid/SHASUMS256.txt",
      shasumsFile: `${PIN_DIRECTORY.join("/")}/${SHASUMS_FILE}`,
      shasumsSha256: sha(shasums),
      acquiredAt: "2026-09-13",
    },
    ...over.pin,
  };
  writeFileSync(join(dir, PIN_FILE), JSON.stringify(pin, null, 2), "utf8");
  return { root, dir, pin };
}

describe("reading an upstream release manifest", () => {
  it("matches a whole line, not a substring anywhere in the file", () => {
    // A substring search for the hash would be satisfied by the line for a completely different
    // artifact, which is how a pin ends up "verified" against the wrong download.
    const text = [
      `${"1".repeat(64)}  node-v24.14.0-win-x64.zip`,
      `${"2".repeat(64)}  win-x64/node.exe`,
      `${"3".repeat(64)}  win-x64/node.lib`,
    ].join("\n");
    expect(shasumsEntry(text, "win-x64/node.exe")).toBe("2".repeat(64));
    expect(shasumsEntry(text, "win-x64/node.li")).toBeUndefined();
    expect(shasumsEntry(text, "node.exe")).toBeUndefined();
  });

  it("returns nothing rather than guessing when the artifact is absent", () => {
    expect(shasumsEntry(`${"1".repeat(64)}  a\n`, "win-x64/node.exe")).toBeUndefined();
  });
});

describe("the repository's pin on the bundled runtime", () => {
  it("agrees with the Node project's own release manifest committed beside it", () => {
    // The real files. This is the check that makes the pin more than a number somebody typed.
    const pin = loadNodeRuntimePin(process.cwd());
    const shasums = readFileSync(join(process.cwd(), ...PIN_DIRECTORY, SHASUMS_FILE), "utf8");
    expect(shasumsEntry(shasums, pin.binary.upstreamPath)).toBe(pin.binary.sha256);
    expect(pin.version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(pin.binary.stagedAs).toBe("node/node.exe");
    expect(pin.license.stagedAs).toBe("node/LICENSE");
  });

  it("refuses a pin whose hash disagrees with that manifest", () => {
    // The mutation that matters: edit the pin to accept a different binary and the manifest beside
    // it stops agreeing. Without this, the pin is self-certifying.
    const { root } = fakeRepo({
      pin: {
        binary: {
          upstreamPath: "win-x64/node.exe",
          sha256: "c".repeat(64),
          bytes: 1,
          stagedAs: "node/node.exe",
        },
      },
    });
    try {
      expect(() => loadNodeRuntimePin(root)).toThrow(/upstream release manifest says/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a release manifest that has been altered", () => {
    const { root, dir } = fakeRepo();
    try {
      writeFileSync(join(dir, SHASUMS_FILE), `${"a".repeat(64)}  win-x64/node.exe\n# edited\n`);
      expect(() => loadNodeRuntimePin(root)).toThrow(/has been altered/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a manifest with no entry for the pinned artifact", () => {
    const shasums = `${"a".repeat(64)}  win-arm64/node.exe\n`;
    const { root } = fakeRepo({ shasums });
    try {
      expect(() => loadNodeRuntimePin(root)).toThrow(/no entry for win-x64\/node\.exe/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to build with no pin at all", () => {
    const root = mkdtempSync(join(tmpdir(), "mos-nopin-"));
    try {
      expect(() => loadNodeRuntimePin(root)).toThrow(/no Node runtime pin/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the licence that must travel with the binary", () => {
  it("is the real Node.js notice, not a placeholder", () => {
    const pin = loadNodeRuntimePin(process.cwd());
    const licence = loadPinnedLicense(pin, process.cwd());
    const text = licence.bytes.toString("utf8");
    expect(text).toContain("Node.js is licensed for use as follows");
    expect(text).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    // The third-party notices are the bulk of it, and the part a hand-written MIT blurb would omit.
    expect(text).toContain("dependencies");
    expect(licence.bytes.length).toBeGreaterThan(100_000);
    expect(licence.sha256).toBe(pin.license.sha256);
  });

  it("is kept out of git's line-ending rewriting, or the pin breaks on a fresh clone", () => {
    // `core.autocrlf` is true on the delivery machine. Without `-text` these files are rewritten to
    // CRLF on checkout, which changes their bytes, which changes their sha256 — so a fresh clone of
    // an untouched repository would refuse to build a distribution, reporting the licence as
    // altered. Caught by git's own staging warning, before it could happen on someone else's
    // machine, and asserted here rather than left to the hash check to report as tampering.
    const attributes = readFileSync(join(process.cwd(), ".gitattributes"), "utf8");
    for (const path of ["third-party/node/LICENSE", "third-party/node/SHASUMS256.txt"]) {
      expect(attributes, `${path} is not protected from line-ending conversion`).toContain(
        `${path} -text`,
      );
    }
  });

  it("refuses a missing licence", () => {
    const { root, pin } = fakeRepo({ license: null });
    try {
      expect(() => loadPinnedLicense(pin, root)).toThrow(/A redistributed runtime ships with/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an empty licence", () => {
    // An empty file satisfies "the licence is present" and satisfies nothing else.
    const { root, pin } = fakeRepo({ license: "" });
    try {
      expect(() => loadPinnedLicense(pin, root)).toThrow(/is empty/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an altered licence", () => {
    const { root, dir, pin } = fakeRepo();
    try {
      writeFileSync(join(dir, "LICENSE"), "LICENCE TEXT\nand something else\n", "utf8");
      expect(() => loadPinnedLicense(pin, root)).toThrow(/has been altered/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
