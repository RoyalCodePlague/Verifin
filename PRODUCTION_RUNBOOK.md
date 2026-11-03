# Production runbook

## Render

- Set the backend health check path to `/health/`. It checks both the application and database connection.
- Run `python manage.py migrate --noinput` as a Render pre-deploy command.
- Enable PostgreSQL point-in-time recovery or scheduled backups in the Render database settings. Verify the configured backup frequency, retention window, and recovery point objective against the business's data-loss tolerance; do not assume platform defaults are sufficient.
- At least quarterly, restore a recent backup into an isolated recovery database. Verify migrations, account access, product/stock totals, recent sales and expenses, and receipt history before documenting the restore duration and result. Never test restoration by overwriting the production database.
- Restrict backup and recovery access to named operators, protect exported backup files with encryption and access controls, and record who performed each restore drill.
- Add an external monitor to request `/health/` every five minutes and alert the owner when it returns a non-200 response.

## Support

Support requests open a pre-filled email to `robert.workszw@gmail.com`. Review this inbox daily and keep the Contact page response expectation current.

## Releases

GitHub Actions verifies TypeScript, frontend tests/build, Django checks, focused Django regression tests, and migration consistency on pushes and pull requests. Do not deploy a failing commit.
