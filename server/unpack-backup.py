"""Unpack only Gather's known backup entries; never trust ZIP paths."""
import json
import pathlib
import re
import sys
import zipfile

source, destination = sys.argv[1:3]
root = pathlib.Path(destination)
with zipfile.ZipFile(source) as archive:
    info = archive.getinfo("gather.json")
    if info.file_size > 20 * 1024 * 1024:
        raise ValueError("Backup record file is too large")
    snapshot = json.loads(archive.read(info))
    if snapshot.get("version") != 1:
        raise ValueError("Unsupported Gather backup version")
    root.joinpath("gather.json").write_text(json.dumps(snapshot), encoding="utf-8")
    for asset in snapshot["assets"]:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", asset["id"]):
            raise ValueError("Invalid media identifier")
        entry = archive.getinfo("media/" + asset["id"])
        if entry.file_size > 150 * 1024 * 1024:
            raise ValueError("Media exceeds the supported restore size")
        root.joinpath(asset["id"]).write_bytes(archive.read(entry))
