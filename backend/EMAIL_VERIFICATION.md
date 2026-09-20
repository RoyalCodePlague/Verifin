# Email signup and Mailgun delivery

New email/password accounts are inactive and pending. Signup never returns access or refresh tokens. Clicking the email link opens a confirmation page; clicking Verify my email & sign in consumes the token once, activates the account, and qualifies any eligible referral. The verification response returns access/refresh tokens and the verified user, signing that browser in automatically. New users continue to onboarding; users with completed onboarding go to the dashboard. GET requests never consume verification links, so email link scanners cannot activate an account. Expired/used links do not issue login tokens. Subsequent sign-ins use the existing email/password login. Existing verified accounts remain active. Google-verified sign-in still works; if Google proves ownership of a pending account, its unverified password is removed before activation.

Links expire after EMAIL_VERIFICATION_TOKEN_TTL_HOURS (default 24) and only a SHA-256 hash is stored. Resending replaces the old link only after the provider accepts delivery. The resend cooldown is 60 seconds. Failed delivery leaves an account pending, with an honest message and a resend option. Existing links remain valid if a resend fails. Verification does not restart the 30-day promotion: it still begins at signup.

## Connect Mailgun with a domain sending API key

The Mailgun API backend accepts a domain sending key, without an SMTP password:

```dotenv
EMAIL_BACKEND=accounts.mailgun_backend.EmailBackend
MAILGUN_API_KEY=your-domain-sending-key
MAILGUN_DOMAIN=mg.verifin.co.zw
MAILGUN_REGION=eu
DEFAULT_FROM_EMAIL=Verifin <no-reply@mg.verifin.co.zw>
EMAIL_TIMEOUT=20
```

Save the key only in ignored `backend/.env` locally and in backend deployment environment variables. Restart the backend after changes. An API key defaults to the API backend when EMAIL_BACKEND is not explicitly set; an explicit backend always wins. The backend uses the existing requests dependency and Django-generated MIME, preserves attachments and recipient headers, and disables link/open tracking so verification links remain direct. Failures do not expose API response bodies or credentials.

Run `python manage.py check_email_delivery` to check configuration locally. This does not authenticate with Mailgun or verify DNS. Once a recipient is provided, run `python manage.py check_email_delivery --to your-address@example.com` to send a real test. Confirm inbox arrival separately.

### DNS for mg.verifin.co.zw

Public DNS checked on 2026-09-20:

| Record | Name | Published value |
| --- | --- | --- |
| NS | verifin.co.zw | olivia.ns.cloudflare.com, venkat.ns.cloudflare.com |
| TXT | mg.verifin.co.zw | v=spf1 include:mailgun.org ~all |
| TXT (DKIM) | email._domainkey.mg.verifin.co.zw | RSA public key published; Mailgun screenshot shows Active |
| MX | mg.verifin.co.zw | mxa.eu.mailgun.org, priority 10 |
| MX | mg.verifin.co.zw | mxb.eu.mailgun.org, priority 10 |
| CNAME | email.mg.verifin.co.zw | eu.mailgun.org |

A DMARC TXT record with policy `p=none` is also published at `_dmarc.mg.verifin.co.zw`. The supplied Mailgun screenshot confirms the EU region, active DKIM, and verified SPF, MX and tracking records. Its DMARC status still reads Unconfigured despite the public TXT record being present; recheck verification in Mailgun before changing DNS. Runtime is the registrar, while the nameservers indicate Cloudflare hosts the active DNS zone.

No additional DKIM record is needed based on the screenshot and public DNS check. For future DNS changes, use the active Cloudflare zone and the exact values from Mailgun. Do not create duplicate SPF/DMARC records or replace existing website/root-domain mail records. A sending API key can send mail but cannot read/manage domain DNS configuration.

The main domain did not return a website A record during this check. Keep FRONTEND_URL pointing to the working app deployment until the custom website domain is connected; using an unresolved URL would break verification links.

References: [sending key permissions](https://documentation.mailgun.com/docs/mailgun/user-manual/api-key-mgmt/rbac-mgmt), [domain verification](https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-verify).

## Optional: connect Mailgun SMTP

Add a sending domain in Mailgun and publish the DNS records shown in its dashboard. Under Sending > Domain settings > SMTP credentials, obtain the domain's SMTP username and password. These are separate from the Mailgun API key and website password. Sandbox domains require authorized test recipients.

Set these in ignored backend/.env locally and the backend host's environment in production:

```
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
MAILGUN_SMTP_HOST=smtp.mailgun.org
MAILGUN_SMTP_PORT=587
MAILGUN_SMTP_USERNAME=postmaster@mg.your-domain.com
MAILGUN_SMTP_PASSWORD=your-domain-smtp-password
EMAIL_USE_TLS=True
EMAIL_USE_SSL=False
DEFAULT_FROM_EMAIL=Verifin <accounts@your-verified-domain>
EMAIL_TIMEOUT=20
FRONTEND_URL=http://localhost:4489
```

For an EU-region Mailgun domain, use `smtp.eu.mailgun.org`. Port 587 uses STARTTLS with the settings above. For SSL on port 465, set EMAIL_USE_SSL=True and EMAIL_USE_TLS=False. Restart the backend after changing environment variables.

Use the actual HTTPS frontend URL for production links. This app uses `FRONTEND_URL`, not the sample guide's `SITE_URL`: its React confirmation page calls the existing verification API. The existing hashed, single-use tokens, account activation and resend flow are preserved.

When any Mailgun host/username/password is supplied, Mailgun settings take precedence over generic EMAIL_HOST/EMAIL_PORT/EMAIL_HOST_USER/EMAIL_HOST_PASSWORD as a group. Incomplete Mailgun credentials do not fall back to another provider. Explicit EMAIL_BACKEND still takes precedence, so replace any existing console backend with the SMTP backend above. No additional Python dependency or Mailgun SDK is needed.

Run `python manage.py check_email_delivery` to validate settings without sending. Once configured, explicitly test with `python manage.py check_email_delivery --to your-own-address@example.com`, then confirm inbox delivery and a full signup/verify/sign-in flow. Provider acceptance is not proof of inbox arrival.

Mailgun support is ready, but real delivery requires your domain credentials. Without credentials, signup stays pending and the UI reports that delivery is unavailable; it never pretends a message was sent.

References: [Mailgun SMTP](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-smtp) and [regional endpoints](https://documentation.mailgun.com/docs/mailgun/api-reference/api-overview).

For local development only, DEBUG=True plus EMAIL_ALLOW_LOCAL_VERIFICATION=True permits the console or file mail backend. These previews do not send email. Production must use the Mailgun API or SMTP backend.

## Rate limits

PostgreSQL stores hashed, expiring rate-limit buckets and increments them under a row lock. Defaults: signup 5/hour/IP and 3/hour/email; login 30/5 minutes/IP and 10/15 minutes/email; resend 10/hour/IP and 3/hour/email; verification 30/15 minutes/IP. Rejected requests return 429 and Retry-After. Expired buckets are cleaned during subsequent auth requests.

AUTH_TRUSTED_PROXY_COUNT defaults to 0, ignoring forwarded IP headers. Configure it only to match a known, trusted reverse-proxy chain; the public proxy must sanitize forwarded headers. Add host-level rate limits as well when deploying.

Existing database accounts are not retroactively verified by this change. Records that were already marked verified by the old signup flow keep that status; an owner-managed re-verification campaign would be a separate migration.
