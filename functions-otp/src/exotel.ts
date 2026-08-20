import FormData from 'form-data';
import axios from 'axios';
import { logger } from 'firebase-functions';

/**
 * Exotel SMS transport.
 *
 * Every value below is non-secret configuration from the Exotel OTP guide for
 * helix-staging-india. The two credentials are NOT here: they arrive as
 * arguments, read from Secret Manager inside the calling handler.
 */

/**
 * Account and DLT registration ids come from the environment, not this file.
 * They are not credentials, but they identify the organisation's telecom
 * account, so they are kept out of the repository. Set them in
 * functions-otp/.env (see .env.example); that file is deployed with the
 * function, the same way TEST_PHONES already is.
 */

/** Exotel account SID. Part of the send URL, not a credential. */
export const EXOTEL_ACCOUNT_SID = process.env.EXOTEL_ACCOUNT_SID ?? '';

/** DLT principal entity id. Fixed for this account. */
export const EXOTEL_ENTITY_ID = process.env.EXOTEL_ENTITY_ID ?? '';

/** DLT-registered sender header. A six-character id, not a phone number. */
export const EXOTEL_SENDER = process.env.EXOTEL_SENDER ?? '';

/** The login-OTP template. Must agree with the body built from OTP_SMS_TEMPLATE:
 *  sending this id with a different registered body is rejected even though both
 *  are individually valid. */
export const OTP_TEMPLATE_ID = process.env.OTP_TEMPLATE_ID ?? '';

/**
 * Sends one OTP SMS.
 *
 * MULTIPART, not JSON. Exotel's send endpoint takes multipart/form-data; posting
 * JSON is accepted-looking and silently wrong.
 *
 * THROWS on failure and does not translate the error. The caller owns what the
 * client is told, and a swallowed failure here would report a sent SMS that
 * never left.
 */
export async function sendOtpSms(
  toPhone: string,
  smsBody: string,
  authKey: string,
  authToken: string
): Promise<void> {
  // Empty credentials are the documented first failure on this platform: a
  // secret that is provisioned but not BOUND to the function reads as '', which
  // sends empty basic-auth and returns 401 with no OTP and no obvious cause.
  // Caught here so the log says which one rather than showing an Exotel 401.
  if (!authKey || !authToken) {
    throw new Error(
      'Exotel credentials are empty. The secrets are almost certainly not bound ' +
      'to this function: check `secrets: [...]` in the onCall options, and that ' +
      '.value() is read inside the handler rather than at module scope.'
    );
  }

  // Same class of failure as empty credentials: these arrive from .env, and a
  // missing one produces an Exotel rejection with no obvious cause. Named here
  // so the log says which is absent.
  const missing = Object.entries({
    EXOTEL_ACCOUNT_SID,
    EXOTEL_ENTITY_ID,
    EXOTEL_SENDER,
    OTP_TEMPLATE_ID
  }).filter(([, v]) => !v).map(([k]) => k);

  if (missing.length) {
    throw new Error(
      `Exotel configuration missing from the environment: ${missing.join(', ')}. ` +
      'Set these in functions-otp/.env (see .env.example) and redeploy.'
    );
  }

  const formData = new FormData();
  formData.append('From', EXOTEL_SENDER);
  formData.append('To', toPhone);
  formData.append('Body', smsBody);
  formData.append('DltEntityId', EXOTEL_ENTITY_ID);
  formData.append('DltTemplateId', OTP_TEMPLATE_ID);
  // transactional, never promotional: promotional traffic is filtered on DND
  // numbers and is the wrong class for a login code.
  formData.append('SmsType', 'transactional');

  const authString = Buffer.from(`${authKey}:${authToken}`).toString('base64');

  try {
    await axios({
      method: 'post',
      url: `https://api.exotel.com/v1/Accounts/${EXOTEL_ACCOUNT_SID}/Sms/send.json`,
      headers: { Authorization: `Basic ${authString}` },
      data: formData
    });
  } catch (error: unknown) {
    const response = (error as { response?: { status?: number; data?: unknown } }).response;

    // Exotel's own error body only. NEVER the credentials, the auth header or
    // the assembled Basic string: these are live production keys with no
    // rotation path, so anything logged is permanent.
    logger.error('Exotel SMS send failed', {
      status: response?.status,
      exotel: response?.data,
      to: toPhone
    });

    throw new Error(`Exotel send failed with status ${response?.status ?? 'unknown'}`);
  }
}
