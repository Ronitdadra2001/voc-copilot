import ExcelJS from "exceljs";

function rowToLine(values: unknown[]): string {
  return values
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map((v) => String(v).trim())
    .filter(Boolean)
    .join(" — ");
}

export async function parseCsv(buffer: Buffer): Promise<string> {
  const text = buffer.toString("utf-8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export async function parseXlsx(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const lines: string[] = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const line = rowToLine(values);
      if (line) lines.push(line);
    });
  });

  return lines.join("\n");
}

export async function parsePdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  return result.text.replace(/\n*--\s*\d+\s*of\s*\d+\s*--\n*/g, "\n").trim();
}

function parsePlainText(buffer: Buffer): string {
  return buffer
    .toString("utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Best-effort parser for "any format" file uploads: known spreadsheet/PDF
 * formats get a real parser, everything else is decoded as UTF-8 text
 * (works for .txt/.md/.json/.log and most other text-based exports).
 */
export async function parseSpreadsheet(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "csv") return parseCsv(buffer);
  if (ext === "xlsx" || ext === "xls") return parseXlsx(buffer);
  if (ext === "pdf") return parsePdf(buffer);
  return parsePlainText(buffer);
}
