export class ReadrunError extends Error {
  readonly code: string;
  readonly filename: string;
  readonly line: number;

  constructor(code: string, message: string, filename: string, line = 1, cause?: unknown) {
    super(`${filename}:${line}: ${message}`, cause === undefined ? undefined : { cause });
    this.name = "ReadrunError";
    this.code = code;
    this.filename = filename;
    this.line = line;
  }
}
