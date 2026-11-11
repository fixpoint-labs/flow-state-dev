/**
 * Real PDFs for the attachment tests, built by hand so no fixture file or
 * second library is needed: one page per entry, each holding its text in a
 * text layer, or nothing at all (`null`, a page as a scan leaves it).
 */

/** A PDF with one page per entry of `pages`, each `\n` a new line. Text is ASCII with no parentheses or backslashes. */
export function makePdf(pages: ReadonlyArray<string | null>): Uint8Array<ArrayBuffer> {
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
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
