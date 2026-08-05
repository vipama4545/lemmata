// Outbound mail, through Mailjet's Send API v3.1.
//
// Without credentials the transport prints the message instead of sending it. That is not a
// silent failure dressed up as success: `npm run dev` has to work before anyone has a
// Mailjet account, and a verification link printed to the terminal is a usable link. In
// production the absence of credentials is loud — see `assertConfigured` below, which the
// server calls at boot.

import Mailjet from 'node-mailjet';
import { env, isProduction } from '../env.ts';

const configured = Boolean(env.MAILJET_API_KEY && env.MAILJET_API_SECRET);

const client = configured
  ? new Mailjet({ apiKey: env.MAILJET_API_KEY, apiSecret: env.MAILJET_API_SECRET })
  : null;

export interface Mail {
  to: string;
  toName?: string;
  subject: string;
  /** The plain-text part. Required: a mail with no text part is a mail some clients bin. */
  text: string;
  html: string;
}

/**
 * Refuses to start a production server that cannot send mail. Called from the bootstrap
 * rather than from here, so that the seed and the migration scripts — which never send
 * anything — are not held to it.
 */
export function assertMailConfigured(): void {
  if (isProduction && !configured) {
    throw new Error(
      'MAILJET_API_KEY and MAILJET_API_SECRET are required in production. ' +
        'Without them the server cannot send verification mail.',
    );
  }
}

/** True when mail actually leaves the building. */
export const mailEnabled = configured;

/**
 * Sends one message. Throws when Mailjet rejects it, so a caller that is answering a user
 * action can report the failure rather than claim a mail was sent that never was.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!client) {
    console.info(
      [
        '',
        '─── mail (not sent: no Mailjet credentials) ───',
        `to:      ${mail.toName ? `${mail.toName} <${mail.to}>` : mail.to}`,
        `subject: ${mail.subject}`,
        '',
        mail.text,
        '───────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
    return;
  }

  const response = await client.post('send', { version: 'v3.1' }).request({
    Messages: [
      {
        From: { Email: env.MAIL_FROM_EMAIL, Name: env.MAIL_FROM_NAME },
        To: [{ Email: mail.to, Name: mail.toName ?? mail.to }],
        Subject: mail.subject,
        TextPart: mail.text,
        HTMLPart: mail.html,
      },
    ],
  });

  // Mailjet answers 200 with a per-message status, so a rejected recipient is not an HTTP
  // error. Anything but "success" for the one message we sent is a failure to report.
  const body = response.body as { Messages?: { Status?: string; Errors?: unknown[] }[] };
  const status = body.Messages?.[0]?.Status;
  if (status !== 'success') {
    throw new Error(`Mailjet did not accept the message: ${JSON.stringify(body.Messages?.[0])}`);
  }
}
