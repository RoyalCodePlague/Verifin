# Launch promotion

New email registrations receive Business for exactly 30 days from account creation. At the cutoff, entitlement checks automatically change the account to active, free Starter, without a grace period or charge. Existing accounts are not enrolled automatically. Promotion timestamps survive downgrades so the offer cannot be restarted. Saved business records remain; Starter feature and creation limits apply.

Apply migrations before starting the updated backend: `python manage.py migrate`. Migration 0007 restores Starter limits previously disabled for testing.

`LAUNCH_PROMO_ENABLED=True` is the default. Set it to `False` to stop offers for future signups; already granted promotions keep their original expiry. Public signup/pricing copy reads this setting from the pricing API.

Keep `BILLING_TEST_MODE=False` (default). It additionally requires DEBUG to be enabled. Public payment checkout is deliberately blocked until verified payment handling is implemented. Configuring Pesepay credentials alone does not enable paid upgrades. No card is collected and no payment is automatically taken at expiry.

Optionally run `python manage.py expire_launch_promotions` hourly to persist expired plans for inactive accounts. Access checks enforce expiry without this job; connected frontend feature and billing views refresh every minute.

The existing referral reward remains separate. A redeemed reward replaces promotional access and follows its own expiry rules.
