const REDACTED = "[REDACTED]";

const SENSITIVE_HEADER = /^(x-ig-api-key|cst|x-security-token|authorization)$/i;
const SENSITIVE_FIELD = /^(password|identifier|apiKey|api_key|cst|xSecurityToken|x-security-token|access_token|refresh_token|encryptedPassword)$/i;

export class Redactor {
  private secrets = new Set<string>();

  constructor(initial: string[] = []) {
    initial.forEach((s) => this.add(s));
  }

  add(secret: string | undefined | null): void {
    if (secret && secret.length >= 3) this.secrets.add(secret);
  }

  text(input: string): string {
    let out = input;
    // Longest first so overlapping secrets are fully masked.
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) {
      out = out.split(secret).join(REDACTED);
    }
    return out;
  }

  value<T>(input: T): T {
    return redactDeep(input, this) as T;
  }
}

function redactDeep(input: unknown, r: Redactor): unknown {
  if (typeof input === "string") return r.text(input);
  if (Array.isArray(input)) return input.map((v) => redactDeep(v, r));
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = SENSITIVE_FIELD.test(k) || SENSITIVE_HEADER.test(k) ? REDACTED : redactDeep(v, r);
    }
    return out;
  }
  return input;
}
