export interface TenantLintViolation {
  file: string;
  line: number;
  severity: string;
  kind: string;
  message: string;
}

export function scanSource(
  source: string,
  filePath: string,
): TenantLintViolation[];
export function scanProject(dirs: string[]): TenantLintViolation[];
