declare module "mailparser" {
  export type MailAddress = {
    name: string;
    address?: string;
  };

  export type AddressObject = {
    value: MailAddress[];
    text?: string;
    html?: string;
  };

  export type MailAttachment = {
    filename?: string;
    contentType: string;
    size: number;
    cid?: string;
  };

  export type ParsedMail = {
    from?: AddressObject;
    to?: AddressObject;
    cc?: AddressObject;
    bcc?: AddressObject;
    replyTo?: AddressObject;
    subject?: string;
    date?: Date;
    messageId?: string;
    headers: Map<string, unknown>;
    text?: string;
    html?: string | false;
    attachments: MailAttachment[];
  };

  export function simpleParser(source: string | Buffer): Promise<ParsedMail>;
}
