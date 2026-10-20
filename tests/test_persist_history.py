import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.persist_history import persist, git
from scripts.update_data import build_snapshot
from test_update_data import fixture


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / 'remote.git'
        self.work = self.root / 'work'
        git('init', '--bare', str(self.remote))
        git('init', str(self.work))
        git('config', 'user.name', 'History test', cwd=self.work)
        git('config', 'user.email', 'test@example.invalid', cwd=self.work)
        git('remote', 'add', 'origin', str(self.remote), cwd=self.work)
        (self.work / 'README').write_text('fixture')
        git('add', 'README', cwd=self.work)
        git('commit', '-m', 'Initial', cwd=self.work)
        self.snapshot = self.root / 'snapshot.json'
        self.snapshot.write_text(json.dumps(build_snapshot(*fixture())))
        before = Path.cwd()
        os.chdir(self.work)
        self.addCleanup(os.chdir, before)

    def test_initial_branch_and_duplicate_rerun_are_persistent(self):
        persist(self.snapshot, 'revision', 'America/Los_Angeles')
        first = git('ls-remote', 'origin', 'refs/heads/history').stdout
        persist(self.snapshot, 'new-code', 'America/Los_Angeles')
        self.assertEqual(first, git('ls-remote', 'origin', 'refs/heads/history').stdout)
        git('fetch', 'origin', 'history')
        index = json.loads(git('show', 'FETCH_HEAD:history/index.json').stdout)
        self.assertEqual(len(index['snapshots']), 1)
        self.assertEqual(git('status', '--porcelain').stdout, '')

    def test_push_retry_and_exhaustion_do_not_force_push_or_pollute_source(self):
        real_git = git
        pushes = []

        def flaky(*args, **kwargs):
            if args[0] == 'push':
                pushes.append(args)
                if len(pushes) == 1:
                    return subprocess.CompletedProcess(args, 1, '', 'simulated conflict')
            return real_git(*args, **kwargs)
        with patch('scripts.persist_history.git', side_effect=flaky):
            persist(self.snapshot, 'revision', 'America/Los_Angeles')
        self.assertEqual(len(pushes), 2)
        self.assertTrue(all('--force' not in args for args in pushes))
        self.assertEqual(git('status', '--porcelain').stdout, '')
        self.assertEqual(len(git('worktree', 'list', '--porcelain').stdout.split('worktree ')), 2)

    def test_stale_snapshot_never_creates_remote_archive(self):
        data = json.loads(self.snapshot.read_text())
        data['fetchedAt'] = '2020-01-01T00:00:00Z'
        self.snapshot.write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            persist(self.snapshot, 'revision', 'America/Los_Angeles')
        self.assertEqual(git('ls-remote', 'origin', 'refs/heads/history').stdout, '')
