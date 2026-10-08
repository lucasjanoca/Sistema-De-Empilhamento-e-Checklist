import json

import pytest

from app.maintenance import replicate_immutable


def test_external_backup_copy_is_verified_and_never_overwritten(tmp_path):
    local = tmp_path / "local"
    external = tmp_path / "external"
    local.mkdir()
    external.mkdir()
    backup = local / "selene-test.selene"
    backup.write_bytes(b"encrypted-backup")
    backup.with_suffix(".selene.json").write_text(json.dumps({"sha256": "evidence"}), encoding="utf-8")

    copied = replicate_immutable(backup, external)

    assert (external / "selene-test.selene").read_bytes() == b"encrypted-backup"
    assert copied == str(external / "selene-test.selene")
    with pytest.raises(FileExistsError):
        replicate_immutable(backup, external)
