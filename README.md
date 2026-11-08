# Verifin — Smart Inventory & Admin for African SMEs

Automate your admin, control your stock, and stop losing money. The all-in-one business OS for African SMEs.

## Scheduled audits

The audit scheduler creates an in-progress audit when an account's daily or weekly schedule becomes due. Run this command from the backend at least hourly using the deployment platform's cron facility:

```sh
python manage.py run_scheduled_audits
```

Each run is idempotent for a schedule interval. Scheduled audits require the Business plan; a due schedule is advanced without creating an audit if its account no longer has access.

## Webhook delivery

Webhook deliveries are queued when subscribed events occur. Run this command from the backend using the deployment platform's cron facility, preferably hourly:

```sh
python manage.py deliver_webhooks
```

Webhook destinations must be public HTTPS endpoints on port 443. Requests include an HMAC-SHA256 signature; see the API documentation for the signing headers and retry behavior.

## Opt-in analytics retention

Activation events are collected only after an account opts in under **Settings → Privacy & Product Analytics**. Events use a random pseudonymous account reference, contain no business records, and are deleted when consent is withdrawn or the account is removed. Run this command daily using the deployment platform's cron facility to enforce the 12-month retention limit:

```sh
python manage.py purge_product_events
```

## Email notifications

Opted-in daily business summaries and automation alerts are sent only to the business account's email address. In **Settings**, enable email delivery consent, then select Email for automation alerts and/or enable the daily summary. Configure `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION`, and `DEFAULT_FROM_EMAIL` before running this command daily:

```sh
python manage.py send_daily_emails
```

## Paynow subscriptions

Paynow hosted and mobile checkout are available when the merchant account is approved and these backend environment variables are configured:

- `PAYNOW_ENABLED=true`
- `PAYNOW_ENV=production`
- `PAYNOW_INTEGRATION_ID`
- `PAYNOW_INTEGRATION_KEY`
- `FRONTEND_URL`

Keep merchant credentials in the deployment secret manager. `PAYNOW_API_BASE` defaults to the staging endpoint outside production and the production endpoint when `PAYNOW_ENV=production`. Sandbox/mobile tests also require `PAYNOW_TEST_EMAIL`. The current checkout supports paid plans priced in USD (including Zimbabwe pricing); other regional currencies are not accepted by Paynow.
