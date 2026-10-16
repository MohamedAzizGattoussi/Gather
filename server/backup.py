import os
import sqlite3
import sys
import tempfile
import zipfile
from contextlib import closing

root, output = sys.argv[1:3]
with tempfile.TemporaryDirectory() as temp:
    snapshot = os.path.join(temp, "gather.sqlite")
    with closing(sqlite3.connect(os.path.join(root, "gather.sqlite"))) as source:
        with closing(sqlite3.connect(snapshot)) as destination:
            source.backup(destination)
    with closing(sqlite3.connect(snapshot)) as connection:
        filenames = [row[0] for row in connection.execute("SELECT filename FROM assets")]
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(snapshot, "gather.sqlite")
        for filename in filenames:
            archive.write(os.path.join(root, "media", filename), "media/" + filename)
        archive.writestr("RESTORE.txt", "Stop Gather. Back up your existing data folder. Replace gather.sqlite and media/ in the Gather data folder with this archive's contents. Remove stale gather.sqlite-wal and gather.sqlite-shm files only while Gather is stopped. Start Gather. The backup includes your password hash; use the password you had when it was created.\n")
