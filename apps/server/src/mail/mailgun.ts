// Outbound mail, through Mailgun's messages API.
//
// Without credentials the transport prints the message instead of sending it. That is not a
// silent failure dressed up as success: `npm run dev` has to work before anyone has a
// Mailgun account, and a sign-in link printed to the terminal is a usable link. In
// production the absence of credentials is loud — see `assertMailConfigured` below, which
// the server calls at boot.
//
// This talks to the HTTP API directly rather than through `mailgun.js`. One POST with basic
// auth and five form fields is the whole of what this app sends: no attachments, no
// templates, no scheduling, no mailing lists. The SDK wraps that in a dependency with its
// own `form-data` peer and its own opinions about errors, in exchange for nothing we use.

import { env, isProduction } from '../env.ts';

const configured = Boolean(env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN);

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
      'MAILGUN_API_KEY and MAILGUN_DOMAIN are required in production. ' +
        'Without them the server cannot send sign-in links.',
    );
  }
}

/** True when mail actually leaves the building. */
export const mailEnabled = configured;

/** `"Name" <address>`, or the bare address. Quoted, because a name may contain a comma. */
function addressed(email: string, name?: string): string {
  return name && name !== email ? `"${name.replace(/"/g, '')}" <${email}>` : email;
}

/**
 * Sends one message. Throws when Mailgun rejects it, so a caller that is answering a user
 * action can report the failure rather than claim a mail was sent that never was.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!configured) {
    console.info(
      [
        '',
        '─── mail (not sent: no Mailgun credentials) ───',
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

  const body = new URLSearchParams({
    from: addressed(env.MAIL_FROM_EMAIL, env.MAIL_FROM_NAME),
    to: addressed(mail.to, mail.toName),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });

  const response = await fetch(`${env.MAILGUN_API_BASE}/v3/${env.MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: {
      // Mailgun's own scheme: the literal user "api", the key as the password.
      Authorization: `Basic ${Buffer.from(`api:${env.MAILGUN_API_KEY}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    // A hung connection to Mailgun must not hold a sign-in request open until the browser
    // gives up on it. Ten seconds, then this throws and the panel says so.
    signal: AbortSignal.timeout(10_000),
  });

  // The status line says a message was rejected; only the body says why, and a 404 whose
  // text reads "Domain not found" is worth a great deal more than "404" on its own — that
  // one means MAILGUN_DOMAIN is wrong, or the domain is in the region MAILGUN_API_BASE is
  // not pointed at.
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Mailgun did not accept the message (${response.status} ${response.statusText})` +
        (detail ? `: ${detail.slice(0, 300)}` : ''),
    );
  }
}
