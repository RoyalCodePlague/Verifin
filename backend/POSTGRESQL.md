# Local PostgreSQL database

Verifin uses PostgreSQL 18 on this workstation:

- Host: `127.0.0.1`
- Port: `1999` (the installer was configured with this port, not 5432)
- Database: `verifin`
- Application role: `verifin_app`

The application password is generated and stored in ignored `backend/.env`. The role owns the application database but cannot administer PostgreSQL, create roles, or create other databases. Keep real passwords and backups out of source control.

Django already supports PostgreSQL via `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, and `DB_PORT`. A configured `DATABASE_URL` takes priority; leave it empty for the local DB_* configuration. A connection failure will raise an error rather than fall back to SQLite.

Start the app normally from backend: `..\.venv\Scripts\python.exe manage.py runserver`. PostgreSQL runs as the Windows service `postgresql-x64-18`. Future schema changes use `python manage.py migrate`.

## Migration and recovery

The migration applied all Django migrations, restored all application records with their original IDs, and compared the records field by field. Django content types and permissions were regenerated and natural foreign keys resolved their references. Password hashes, login token records, subscription history and soft-deleted records were included. Uploaded files remain in their original media directory.

The original `backend/db.sqlite3` was left untouched. A consistent SQLite snapshot and migration fixture are in the ignored `backend/database-migration.local/` directory. It contains sensitive data and connection details; do not publish it. Keep these until the PostgreSQL migration has been accepted.

Rollback before any new PostgreSQL writes: stop the backend, clear DATABASE_URL and DB_* in backend/.env, then restart to use the original SQLite file. After new PostgreSQL writes, switching back would lose access to those new records; export/restore them first.

## Tests

A separate `test_verifin` database is owned by the application role. Use `python manage.py test accounts core billing inventory sales customers audits reports expenses notifications sync test_robustness --keepdb --noinput` to run the application tests without giving the application role database-creation privileges. Tests never use the main verifin database for their records.

For production, provision PostgreSQL on your hosting platform; the workstation's 127.0.0.1 address is local to this PC.
