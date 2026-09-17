import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";

export type ParsedEmailAddress = {
  name: string;
  address: string;
};

export type ParsedEmailAttachment = {
  filename: string | null;
  contentType: string;
  size: number;
  contentId: string | null;
};

export type ParsedEmail = {
  from: ParsedEmailAddress[];
  to: ParsedEmailAddress[];
  cc: ParsedEmailAddress[];
  bcc: ParsedEmailAddress[];
  replyTo: ParsedEmailAddress[];
  returnPath: string | null;
  subject: string;
  date: string | null;
  messageId: string | null;
  headers: Record<string, string | string[]>;
  received: string[];
  dkimSignature: string | null;
  authenticationResults: string | null;
  text: string;
  html: string | null;
  links: string[];
  attachments: ParsedEmailAttachment[];
};

function normalizeAddresses(value: AddressObject | undefined): ParsedEmailAddress[] {
  return (
    value?.value.map(({ name, address }) => ({
      name: name.trim(),
      address: address?.trim().toLowerCase() ?? "",
    })) ?? []
  );
}

function normalizeHeaderValue(value: unknown): string | string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === "object" && "text" in value) {
    return String(value.text);
  }
  return String(value ?? "");
}

function getHeaderValue(parsed: ParsedMail, name: string): string | null {
  const value = parsed.headers.get(name.toLowerCase());
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function getHeaderValues(parsed: ParsedMail, name: string): string[] {
  const value = parsed.headers.get(name.toLowerCase());
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null) return [];
  return [String(value)];
}

function extractLinks(text: string, html: string | null): string[] {
  const matches = `${text}\n${html ?? ""}`.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  return [...new Set(matches.map((link) => link.replace(/[),.;!?]+$/, "")))];
}

export async function parseEmailSource(source: string | Buffer): Promise<ParsedEmail> {
  if (!source || (typeof source === "string" && source.trim().length === 0)) {
    throw new Error("Email source cannot be empty.");
  }

  const parsed = await simpleParser(source);
  const text = parsed.text?.trim() ?? "";
  const html = typeof parsed.html === "string" ? parsed.html : null;

  return {
    from: normalizeAddresses(parsed.from),
    to: normalizeAddresses(parsed.to),
    cc: normalizeAddresses(parsed.cc),
    bcc: normalizeAddresses(parsed.bcc),
    replyTo: normalizeAddresses(parsed.replyTo),
    returnPath: parsed.headers.get("return-path")?.toString().trim().toLowerCase() ?? null,
    subject: parsed.subject?.trim() ?? "",
    date: parsed.date?.toISOString() ?? null,
    messageId: parsed.messageId?.trim() ?? null,
    headers: Object.fromEntries(
      [...parsed.headers.entries()].map(([name, value]) => [name, normalizeHeaderValue(value)]),
    ),
    received: getHeaderValues(parsed, "received")
      .flatMap((value) => value.split(/\r?\n(?=\s*by\s)/i))
      .map((value) => value.trim())
      .filter(Boolean),
    dkimSignature: getHeaderValue(parsed, "dkim-signature"),
    authenticationResults: getHeaderValue(parsed, "authentication-results"),
    text,
    html,
    links: extractLinks(text, html),
    attachments: parsed.attachments.map((attachment) => ({
      filename: attachment.filename ?? null,
      contentType: attachment.contentType,
      size: attachment.size,
      contentId: attachment.cid ?? null,
    })),
  };
}
