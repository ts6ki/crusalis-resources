"""Write history on its own branch; bounded optimistic retries, never force-push."""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path

try:
    from .archive_history import archive, timestamp, require
except ImportError:
    from archive_history import archive, timestamp, require
from datetime import datetime, timezone


def git(*args, cwd=None, input=None, check=True):
    return subprocess.run(['git', *args], cwd=cwd, input=input, text=True,
                          capture_output=True, check=check)


def persist(snapshot, revision, zone):
    data = json.loads(Path(snapshot).read_text(encoding='utf-8'))
    age = (datetime.now(timezone.utc) - timestamp(data.get('fetchedAt'))).total_seconds()
    require(-60 <= age <= 3600, 'Refusing to archive stale or future data')
    repo = git('rev-parse', '--show-toplevel').stdout.strip()
    for attempt in range(3):
        remote = git('ls-remote', '--exit-code', '--heads', 'origin', 'history', check=False)
        if remote.returncode == 0:
            git('fetch', '--no-tags', 'origin', 'refs/heads/history')
            base = git('rev-parse', 'FETCH_HEAD').stdout.strip()
        elif remote.returncode == 2:
            tree = git('mktree', input='').stdout.strip()
            base = git('commit-tree', tree, input='Initialize daily history\n').stdout.strip()
        else:
            raise RuntimeError('Could not read archive branch: ' + remote.stderr)
        with tempfile.TemporaryDirectory(prefix='crusalis-history-') as directory:
            worktree = Path(directory) / 'archive'
            git('worktree', 'add', '--detach', str(worktree), base)
            try:
                date = archive(data, worktree / 'history', zone, revision)
                git('add', '--', 'history', cwd=worktree)
                difference = git('diff', '--cached', '--quiet', cwd=worktree, check=False)
                if difference.returncode == 0:
                    print('Already archived ' + date)
                    return
                require(difference.returncode == 1, 'Cannot inspect archive changes')
                git('commit', '-m', 'Archive Crusalis observation ' + date, cwd=worktree)
                pushed = git('push', 'origin', 'HEAD:refs/heads/history', cwd=worktree, check=False)
                if pushed.returncode == 0:
                    print('Persisted daily archive ' + date)
                    return
                if attempt == 2:
                    raise RuntimeError('Archive push failed: ' + pushed.stderr)
            finally:
                # The only removable target is the worktree created inside this temp directory.
                require(worktree.resolve().parent == Path(directory).resolve(), 'Unsafe worktree path')
                git('worktree', 'remove', '--force', str(worktree), cwd=repo)
    raise RuntimeError('Archive retries exhausted')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', default='site/data/resources.json')
    parser.add_argument('--revision', required=True)
    parser.add_argument('--timezone', default='America/Los_Angeles')
    args = parser.parse_args()
    persist(args.snapshot, args.revision, args.timezone)
