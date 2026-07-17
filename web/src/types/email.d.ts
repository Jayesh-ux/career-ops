declare module "imap" {
  interface ImapConfig {
    user: string;
    password: string;
    host: string;
    port: number;
    tls: boolean;
    tlsOptions: { rejectUnauthorized: boolean };
  }

  class Imap {
    constructor(config: ImapConfig);
    once(event: string, callback: (...args: unknown[]) => void): void;
    connect(): void;
    openBox(
      boxName: string,
      readOnly: boolean,
      callback: (err: Error | null, box?: unknown) => void,
    ): void;
    search(
      criteria: unknown[],
      callback: (err: Error | null, results: number[]) => void,
    ): void;
    fetch(
      which: number[],
      options: { bodies: string },
    ): NodeJS.EventEmitter;
    end(): void;
  }

  export default Imap;
}

declare module "mailparser" {
  interface ParsedMail {
    from?: { text: string; value: Array<{ address: string }> };
    subject?: string;
    date?: Date;
    text?: string;
  }

  export function simpleParser(
    raw: string,
  ): Promise<ParsedMail>;
}

declare module "nodemailer" {
  interface TransportOptions {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  }

  interface MailOptions {
    from: string;
    to: string;
    subject: string;
    text: string;
    attachments?: Array<{ filename?: string; path: string }>;
  }

  interface SendMailResult {
    messageId: string;
  }

  interface Transport {
    sendMail(options: MailOptions): Promise<SendMailResult>;
  }

  export function createTransport(options: TransportOptions): Transport;
}
