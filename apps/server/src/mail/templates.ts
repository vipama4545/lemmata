// The messages this app sends, and the one layout they share.
//
// Written as inline-styled tables rather than a stylesheet because that is what mail
// clients render: Gmail strips <style> in some contexts and Outlook's engine is Word's.
// Every message has a text part that says the same thing, and the link is spelled out in
// it — a button whose text is "click here" is useless in a client that shows no HTML.

import { env } from '../env.ts';

const BRAND = '#4a2f6f';
const INK = '#1c1917';
const MUTED = '#57534e';

function layout(heading: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#faf9f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;">
            <tr>
              <td style="padding:28px 32px 8px;font-family:Georgia,'Times New Roman',serif;font-size:20px;color:${BRAND};">
                ${env.MAIL_FROM_NAME}
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:${INK};">
                <h1 style="margin:12px 0 16px;font-size:20px;font-weight:600;color:${INK};">${heading}</h1>
                ${body}
              </td>
            </tr>
          </table>
          <div style="max-width:520px;margin:16px auto 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${MUTED};">
            Sent by ${env.MAIL_FROM_NAME}. If you were not expecting this, you can ignore it.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr><td style="background:${BRAND};border-radius:8px;">
      <a href="${href}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${label}</a>
    </td></tr>
  </table>
  <p style="margin:0;font-size:13px;color:${MUTED};word-break:break-all;">
    Or paste this into your browser:<br /><a href="${href}" style="color:${BRAND};">${href}</a>
  </p>`;
}

export interface Message {
  subject: string;
  text: string;
  html: string;
}

/**
 * Sent once, the first time an account is created. Says where the progress that was already
 * in the browser went, because that is the one surprising thing about signing in here:
 * words marked known before there was an account are not lost, they are merged.
 */
export function welcome(name: string): Message {
  // The whole username, as it was given. Not split on a space to guess at a first name:
  // that guess is wrong for most of the world and reads as prying even when it is right.
  const who = name.trim() || 'there';
  return {
    subject: `Welcome to ${env.MAIL_FROM_NAME}`,
    text: [
      `Hello ${who},`,
      '',
      'Your account is ready. Anything you had already marked as known in this browser has',
      'been merged into it, and from now on your progress follows you to any device you sign',
      'in from.',
      '',
      `Open the app: ${env.WEB_ORIGIN}`,
    ].join('\n'),
    html: layout(
      `Hello ${who}`,
      `<p style="margin:0 0 12px;">Your account is ready.</p>
       <p style="margin:0 0 12px;">Anything you had already marked as known in this browser has been merged into it, and from now on your progress follows you to any device you sign in from.</p>
       ${button(env.WEB_ORIGIN, 'Open the app')}`,
    ),
  };
}

/**
 * The sign-in link itself — the one message here that is not a notification about something
 * that already happened, but the mechanism.
 *
 * It says what to do about a message nobody asked for, and says it as "ignore this" rather
 * than "secure your account": there is no password to change and no session to revoke, and
 * an unclicked link expires on its own. Someone typing your address into the form is the
 * whole of what this can be abused for.
 */
export function signInLink(url: string): Message {
  return {
    subject: `Your sign-in link for ${env.MAIL_FROM_NAME}`,
    text: [
      'Here is your link. Open it and you are signed in — there is no password to enter.',
      '',
      url,
      '',
      'It works once and expires in fifteen minutes.',
      '',
      'If you did not ask to sign in, nothing has happened and nothing will: ignore this and',
      'the link expires unused.',
    ].join('\n'),
    html: layout(
      'Your sign-in link',
      `<p style="margin:0 0 12px;">Open the link and you are signed in. There is no password to enter.</p>
       ${button(url, 'Sign in')}
       <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">It works once and expires in fifteen minutes. If you did not ask to sign in, ignore this — the link expires unused.</p>`,
    ),
  };
}

/** Better Auth's email-verification link. */
export function verifyEmail(url: string): Message {
  return {
    subject: 'Confirm your email address',
    text: [
      'Confirm your email address to finish setting up your account.',
      '',
      url,
      '',
      'The link is good for one hour.',
    ].join('\n'),
    html: layout(
      'Confirm your email address',
      `<p style="margin:0 0 12px;">Confirm your email address to finish setting up your account. The link is good for one hour.</p>
       ${button(url, 'Confirm email address')}`,
    ),
  };
}

/** Sent to the *current* address when someone asks to move the account to a new one. */
export function changeEmail(url: string, newEmail: string): Message {
  return {
    subject: 'Approve your new email address',
    text: [
      `Someone asked to change this account's email address to ${newEmail}.`,
      '',
      'If that was you, approve it here:',
      url,
      '',
      'If it was not, do nothing. The address will not change without this link being used.',
    ].join('\n'),
    html: layout(
      'Approve your new email address',
      `<p style="margin:0 0 12px;">Someone asked to change this account's email address to <strong>${newEmail}</strong>.</p>
       ${button(url, 'Approve the change')}
       <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">If it was not you, do nothing. The address will not change unless this link is used.</p>`,
    ),
  };
}

/** The confirmation step on account deletion. Deliberately blunt about what is lost. */
export function deleteAccount(url: string): Message {
  return {
    subject: 'Confirm deleting your account',
    text: [
      'You asked to delete your account.',
      '',
      'This removes every review record on it — what you know, and when each word is next',
      'due. It cannot be undone.',
      '',
      'Confirm here:',
      url,
      '',
      'If you did not ask for this, do nothing.',
    ].join('\n'),
    html: layout(
      'Confirm deleting your account',
      `<p style="margin:0 0 12px;">You asked to delete your account.</p>
       <p style="margin:0 0 12px;">This removes every review record on it — what you know, and when each word is next due. It cannot be undone.</p>
       ${button(url, 'Delete my account')}
       <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">If you did not ask for this, do nothing.</p>`,
    ),
  };
}
