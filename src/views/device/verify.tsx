import Html from '@kitajs/html';
import { Layout } from '../components/Layout.js';

/**
 * OAuth2 Device Authorization Flow - RFC 8628
 *
 * This template renders the device code verification page for the OAuth2
 * Device Authorization Grant flow. Used for devices with limited input
 * capabilities (smart TVs, IoT devices, CLI tools).
 *
 * Flow Context:
 * 1. Device obtains device_code and user_code from Hydra
 * 2. Device displays user_code and verification URL to user
 * 3. User navigates to this page on a separate device (phone/computer)
 * 4. User enters user_code to authorize the device
 * 5. Device polls Hydra for access token
 *
 * Bridge Architecture:
 * - Hydra provides OAuth2 server with device flow support
 * - This page verifies user_code and initiates Google OAuth authentication
 * - Upon success, Hydra issues tokens to the original device
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8628
 * @see src/routes/device.ts - Device flow handlers
 */
export interface DeviceVerifyProps {
  /** POST endpoint for verification form submission */
  action: string;
  /** XSRF token header name for CSRF protection */
  envXsrfToken: string;
  /** CSRF token value */
  csrfToken: string;
  /** Hydra's device challenge identifying this flow */
  challenge: string;
  /** Error message if verification failed */
  error?: string;
  /** Pre-filled user code from URL (e.g., from QR code scan) */
  userCode?: string;
}

export function DeviceVerify({ action, envXsrfToken, csrfToken, error, userCode = '' }: DeviceVerifyProps): string {
  return Layout({
    title: 'Device Verification',
    children: (
      <>
        <h1>Device Verification</h1>
        {error && (
          <p style="color: red;">
            <strong>Error:</strong> {error}
          </p>
        )}
        <p>Please enter the code shown on your device:</p>

        <form action={action} method="POST">
          <input type="hidden" name={envXsrfToken} value={csrfToken} />
          <input type="text" id="user_code" name="user_code" value={userCode} placeholder="XXXX-XXXX" required />
          <br />
          <input type="submit" value="Verify" />
        </form>
      </>
    ),
  });
}
