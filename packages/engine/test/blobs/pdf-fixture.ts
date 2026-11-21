/**
 * Real PDFs for the attachment tests, built by hand so no fixture file or
 * second library is needed: one page per entry, each holding its text in a
 * text layer, or nothing at all (`null`, a page as a scan leaves it).
 */
import { randomBytes } from "node:crypto";

const ascii = (text: string): Buffer => Buffer.from(text, "ascii");

/**
 * A PDF with one page per entry of `pages`, each `\n` a new line. Text is
 * ASCII with no parentheses or backslashes.
 *
 * `options.padTo` makes the file exactly that many bytes. The spare bytes
 * are one stream of random data, listed in the cross-reference table, so a
 * parser still opens the pages. Two calls differ. Throws when `padTo` is
 * not larger than the PDF without the pad.
 */
export function makePdf(
  pages: ReadonlyArray<string | null>,
  options?: { padTo?: number },
): Uint8Array<ArrayBuffer> {
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((text, i) => {
    // One text-showing operator per line: a line is a run of text in the page's layer.
    const content =
      text === null ? "" : `BT /F1 12 Tf 14 TL 72 720 Td ${text.split("\n").map((line) => `(${line}) Tj T*`).join(" ")} ET`;
    objects[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objects[5 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  return assemble(objects.slice(1), options?.padTo);
}

/** Header, one object per body, an optional pad stream, then one xref. */
function assemble(bodies: string[], padTo?: number): Uint8Array<ArrayBuffer> {
  const header = ascii("%PDF-1.4\n");
  const objects = bodies.map((body, index) => ascii(`${index + 1} 0 obj\n${body}\nendobj\n`));
  const chunks: Buffer[] = [header, ...objects];
  if (padTo !== undefined) {
    const before = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    chunks.push(padStream(bodies.length + 1, bodies.length + 2, before, padTo));
  }

  const body = Buffer.concat(chunks);
  const starts: number[] = [];
  let cursor = header.length;
  for (const object of chunks.slice(1)) {
    starts.push(cursor);
    cursor += object.length;
  }
  const file = Buffer.concat([body, xref(body.length, starts, chunks.length)]);
  if (padTo !== undefined && file.length !== padTo) throw new Error(`padTo ${padTo} produced ${file.length} bytes`);
  return new Uint8Array(file);
}

/**
 * One stream object whose random payload makes the finished file `padTo`
 * bytes. The digits of `/Length` and of the xref offset are part of that
 * size, so both have to settle before the bytes are chosen.
 */
function padStream(id: number, entries: number, before: number, padTo: number): Buffer {
  const trailer = `trailer\n<< /Size ${entries} /Root 1 0 R >>\nstartxref\n`;
  const xrefFixed = `xref\n0 ${entries}\n`.length + entries * 20 + trailer.length + "\n%%EOF\n".length;
  const frameFixed = `${id} 0 obj\n<< /Length `.length + " >>\nstream\n".length + "\nendstream\nendobj\n".length;

  let startDigits = String(padTo).length;
  let xrefAt = padTo - xrefFixed - startDigits;
  for (let attempt = 0; attempt < 6 && String(xrefAt).length !== startDigits; attempt += 1) {
    startDigits = String(Math.abs(xrefAt)).length;
    xrefAt = padTo - xrefFixed - startDigits;
  }
  const withDigits = xrefAt - before - frameFixed;
  let padBytes = withDigits - String(Math.max(withDigits, 0)).length;
  for (let attempt = 0; attempt < 6 && padBytes + String(Math.max(padBytes, 0)).length !== withDigits; attempt += 1) {
    padBytes = withDigits - String(Math.max(padBytes, 0)).length;
  }
  if (String(xrefAt).length !== startDigits || padBytes < 1 || padBytes + String(padBytes).length !== withDigits) {
    throw new Error(`padTo ${padTo} is under the PDF's own size`);
  }

  return Buffer.concat([
    ascii(`${id} 0 obj\n<< /Length ${padBytes} >>\nstream\n`),
    randomBytes(padBytes),
    ascii("\nendstream\nendobj\n"),
  ]);
}

/** The cross-reference table. `entries` counts the free object too. */
function xref(start: number, offsets: number[], entries: number): Buffer {
  let out = `xref\n0 ${entries}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${entries} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return ascii(out);
}
