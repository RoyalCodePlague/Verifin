# Production runbook

## Render

- Set the backend health check path to `/health/`. It checks both the application and database connection.
- Run `python manage.py migrate --noinput` as a Render pre-deploy command.
- Enable PostgreSQL point-in-time recovery or scheduled backups in the Render database settings. Test a restore before relying on it.
- Add an external monitor to request `/health/` every five minutes and alert the owner when it returns a non-200 response.

## Support

Support requests open a pre-filled email to `robert.workszw@gmail.com`. Review this inbox daily and keep the Contact page response expectation current.

## Releases

GitHub Actions verifies TypeScript, frontend tests/build, Django checks, and migration consistency on pushes and pull requests. Do not deploy a failing commit.
