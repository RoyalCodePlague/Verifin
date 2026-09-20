# Google sign-in setup

The app uses the official Google Identity Services button and verifies the Google ID token on Django before issuing its normal access/refresh tokens. The backend checks signature, audience, issuer, expiry, verified email, a signed ten-minute nonce, and an exact trusted request Origin. Form submissions are rejected. Google's stable subject ID identifies returning users.

## Google Cloud

1. Create/select a project at https://console.cloud.google.com/auth/overview .
2. Configure Google Auth Platform branding: Verifin, support email, homepage, privacy policy and terms URLs. For public users choose an External audience. While testing, add your test users; publish the app when ready and complete any verification Google requests.
3. Under Clients, create an OAuth client of type **Web application**.
4. Add **Authorized JavaScript origins**: your actual HTTPS frontend origin, `http://localhost`, and `http://localhost:4489` for this project's local Vite server. Add other exact origins only if used. Origins have no path or trailing slash.
5. This implementation uses a JavaScript popup callback, so it does not need an authorized redirect URI or client secret. Basic sign-in uses email/profile/openid; no Gmail or Drive permissions are needed.

## Backend configuration

Set `GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com` in backend/.env locally and in your backend host's environment variables for production. Set `FRONTEND_URL` to the exact production frontend origin; it is automatically included in the backend's allowed origins. Restart/redeploy the backend. The frontend reads the public client ID from the backend; no VITE_GOOGLE_CLIENT_ID is needed.

Install requirements and run `python manage.py migrate`. Deploy the frontend too: its CSP and popup headers now allow Google's script, styles, and frame.

## Check the completed setup

Open /login, choose Continue with Google, select a test Google account, and confirm the dashboard opens. New users receive the same 30-day Business launch promotion as email registrations. Existing accounts retain their subscription; returning Google logins do not restart promotions. Google-created accounts have no password until a separate password setup mechanism is provided.

Existing Gmail or Google Workspace accounts can link by verified email. Existing third-party email accounts cannot be linked automatically because Google is not authoritative for those email addresses; use existing email/password login. Deactivated/deleted accounts remain blocked. Staff continue using their staff credentials.

Automated tests mock Google's verification boundary; a real Google popup sign-in still requires your configured client and consent-screen setup.

Official setup: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
Verification: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
