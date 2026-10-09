import Html from '@kitajs/html';
import { Layout } from '../components/Layout.js';

export interface DeviceSuccessProps {
  message?: string;
}

export function DeviceSuccess({ message = 'Device verified successfully!' }: DeviceSuccessProps): string {
  return Layout({
    title: 'Verification Successful',
    children: (
      <>
        <h1>Success!</h1>
        <p>{message}</p>
        <p>You may now close this window and return to your device.</p>
      </>
    ),
  });
}
