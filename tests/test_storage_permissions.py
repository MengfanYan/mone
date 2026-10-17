import os
import stat
import tempfile
import unittest
from pathlib import Path

from services.api.store import Store


class StoragePermissionsTests(unittest.TestCase):
    def test_new_database_and_directory_are_private(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "private" / "wallet.sqlite3"
            Store(path)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)

    def test_existing_database_permissions_are_tightened(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "wallet.sqlite3"
            Store(path)
            os.chmod(path, 0o644)
            Store(path)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    @unittest.skipUnless(hasattr(os, "O_NOFOLLOW"), "requires no-follow support")
    def test_symlink_database_does_not_modify_its_target(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "unrelated.txt"
            target.write_text("must stay unchanged")
            os.chmod(target, 0o644)
            link = Path(folder) / "wallet.sqlite3"
            link.symlink_to(target)
            with self.assertRaises(OSError):
                Store(link)
            self.assertEqual(target.read_text(), "must stay unchanged")
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o644)
