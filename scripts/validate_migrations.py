import pathlib
import sqlite3

root = pathlib.Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")

migrations = sorted((root / "migrations").glob("*.sql"))
assert migrations, "no migrations found"
for migration in migrations:
    db.executescript(migration.read_text(encoding="utf-8"))

tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
expected = {
    "owner_identity", "owner_roles", "memory_records", "memory_versions",
    "memory_evidence", "memory_evaluations", "project_records", "operational_tasks",
    "operational_runs", "operational_gates", "approval_requests", "approval_events",
    "external_probes", "backup_manifests", "system_events", "quota_observations"
}
assert expected <= tables, f"missing tables: {expected - tables}"

db.execute("INSERT INTO memory_records(id,memory_key,created_at) VALUES('m1','k1','2026-11-19T00:00:00Z')")
db.execute("""INSERT INTO memory_versions
(id,memory_id,version,content,content_sha256,status,supersedes_version,provenance_json,created_at)
VALUES('v1','m1',1,'alpha','hash1','verified',NULL,'{}','2026-11-19T00:00:01Z')""")
assert db.execute("SELECT current_version FROM memory_records WHERE id='m1'").fetchone()[0] == 1
db.execute("""INSERT INTO memory_versions
(id,memory_id,version,content,content_sha256,status,supersedes_version,provenance_json,created_at)
VALUES('v2','m1',2,'beta','hash2','proposed',1,'{}','2026-11-19T00:00:02Z')""")
assert db.execute("SELECT current_version FROM memory_records WHERE id='m1'").fetchone()[0] == 2

for statement in [
    "UPDATE memory_versions SET content='tampered' WHERE id='v1'",
    "DELETE FROM memory_versions WHERE id='v1'",
    "INSERT INTO memory_versions(id,memory_id,version,content,content_sha256,status,supersedes_version,provenance_json,created_at) VALUES('v4','m1',4,'bad','h','proposed',2,'{}','2026-11-19T00:00:03Z')"
]:
    try:
        db.execute(statement)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError(f"guard failed to reject: {statement}")

print(f"PASS: {len(expected)} required tables; {len(migrations)} migrations; append-only, sequential version and supersession guards")
