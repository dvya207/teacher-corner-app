import { createTransport } from 'nodemailer';

import { CODE_TTL_MS } from './codes';

/**
 * Sending the login code.
 *
 * SMTP rather than one provider's SDK, because SMTP is the one interface every
 * provider offers: SendGrid, Mailgun, Postmark, Amazon SES and a plain Gmail
 * account all speak it. Swapping provider is then a change of configuration
 * rather than a change of code.
 *
 * Configured entirely from the environment, so no address, host or credential is
 * hardcoded:
 *
 *   SMTP_HOST      smtp.sendgrid.net, smtp.gmail.com, …
 *   SMTP_PORT      587 for STARTTLS, 465 for TLS
 *   SMTP_USER      provider's username ("apikey" for SendGrid)
 *   SMTP_PASSWORD  the secret — set with `firebase functions:secrets:set`
 *   MAIL_FROM      the From header, e.g. Teacher Corner <no-reply@example.com>
 */

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    // Thrown at send time rather than at module load, so a missing value fails
    // that one request with a clear reason instead of breaking every function in
    // the deployment on cold start.
    throw new Error(`${name} is not configured. See functions/README.md.`);
  }

  return value;
}

const MINUTES = Math.round(CODE_TTL_MS / 60000);

/**
 * The code email.
 *
 * Plain text alongside the HTML, because a code is exactly the kind of message a
 * client may render as text only, and a code nobody can read is a locked door.
 */
function body(code: string): { text: string; html: string } {
  const text = [
    'Your Teacher Corner sign-in code is:',
    '',
    `    ${code}`,
    '',
    `It expires in ${MINUTES} minutes and can be used once.`,
    '',
    'If you did not try to sign in, you can ignore this email — someone entering',
    'your password cannot get in without this code.'
  ].join('\n');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#0f172a">
      <p>Your Teacher Corner sign-in code is:</p>
      <p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:24px 0">${code}</p>
      <p>It expires in ${MINUTES} minutes and can be used once.</p>
      <p style="color:#64748b;font-size:13px">
        If you did not try to sign in, you can ignore this email — someone entering
        your password cannot get in without this code.
      </p>
    </div>
  `;

  return { text, html };
}

export async function sendLoginCode(to: string, code: string): Promise<void> {
  const port = Number(process.env['SMTP_PORT'] ?? 587);

  const transport = createTransport({
    host: required('SMTP_HOST'),
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: port === 465,
    auth: { user: required('SMTP_USER'), pass: required('SMTP_PASSWORD') }
  });

  const { text, html } = body(code);

  await transport.sendMail({
    from: required('MAIL_FROM'),
    to,
    subject: 'Your Teacher Corner sign-in code',
    text,
    html
  });
}
