"""Find release drafts and record validation for immutable assets."""
import argparse
import json
import pathlib
import re
import subprocess
import tempfile
import urllib.parse

START = '<!-- mail-web-validation:start -->'
END = '<!-- mail-web-validation:end -->'
LABELS = {'success': '✅ passed', 'failure': '❌ failed', 'cancelled': '⚠️ cancelled', 'in_progress': '⏳ running', 'pending': '⏳ pending'}


def render(body, commit, phase, status, run_url, *, skip_full_validation=False):
    if not re.fullmatch(r'[0-9a-f]{40}', commit) or phase not in ('fast', 'full') or status not in LABELS:
        raise ValueError('Invalid validation metadata')
    url = urllib.parse.urlsplit(run_url)
    if any(char.isspace() for char in run_url) or url.scheme != 'https' or url.username or url.password or url.query or url.fragment or not re.fullmatch(r'/[^/]+/[^/]+/actions/runs/\d+', url.path):
        raise ValueError('Expected an HTTPS Actions run URL')
    if body.count(START) != body.count(END) or body.count(START) > 1:
        raise ValueError('Ambiguous validation notes')
    fast = '- Fast checks: ✅ passed'
    full = '- Full validation: ⏳ pending'
    if START in body:
        before, rest = body.split(START, 1)
        section, after = rest.split(END, 1)
        if f'- Source commit: `{commit}`' not in section:
            raise ValueError('Validation notes belong to another commit')
        fast = next((line for line in section.splitlines() if line.startswith('- Fast checks: ')), fast)
        full = next((line for line in section.splitlines() if line.startswith('- Full validation: ')), full)
    else:
        before, after = body.rstrip() + '\n\n', '\n'
    line = f'- {"Fast checks" if phase == "fast" else "Full validation"}: {LABELS[status]} ([Actions]({run_url}))'
    if phase == 'fast':
        fast = line
        if skip_full_validation:
            full = '- Full validation: skipped'
    else:
        full = line
    return before + START + '\n' + '\n'.join([f'- Source commit: `{commit}`', fast, full]) + '\n' + END + after


def gh_json(path, *flags):
    return json.loads(subprocess.check_output(['gh', 'api', *flags, path], text=True))


def find_release(repository, version):
    # The exact-tag endpoint can return 404 while the draft has no git tag.
    pages = gh_json(f'repos/{repository}/releases?per_page=100', '--paginate', '--slurp')
    matches = [release for page in pages for release in page if release['tag_name'] == version]
    if len(matches) > 1:
        raise ValueError('More than one release has the requested tag')
    return matches[0] if matches else None


def verify_owner(repository, version, commit, release):
    if release['draft']:
        if release['target_commitish'] == commit:
            return
        if re.fullmatch(r'[0-9a-fA-F]{40}', release['target_commitish']):
            raise ValueError('Draft belongs to another commit')
        # GitHub may ignore a symbolic target when a version tag already exists.
        # Resolve that immutable tag instead; never infer ownership from main.
    obj = gh_json(f'repos/{repository}/git/ref/tags/{version}')['object']
    for _ in range(5):
        if obj['type'] == 'commit':
            if obj['sha'] != commit:
                raise ValueError('Published tag belongs to another commit')
            return
        if obj['type'] != 'tag' or not re.fullmatch(r'[0-9a-f]{40}', obj['sha']):
            break
        obj = gh_json(f'repos/{repository}/git/tags/{obj["sha"]}')['object']
    raise ValueError('Cannot resolve the published tag')


def save_status(repository, version, commit, phase, status, run_url, publish=False, *, skip_full_validation=False):
    if publish:
        if phase != 'fast' or status != 'success':
            raise ValueError('Publishing requires successful fast checks')
        release = find_release(repository, version)
        if release is None or not release['draft']:
            raise ValueError('Publication requires an existing draft')
    else:
        release = gh_json(f'repos/{repository}/releases/tags/{version}')
        if release['draft']:
            raise ValueError('Validation status requires a published release')
    verify_owner(repository, version, commit, release)
    body = render(release.get('body') or '', commit, phase, status, run_url, skip_full_validation=skip_full_validation)
    update = {'body': body}
    if publish:
        update['draft'] = False
    with tempfile.TemporaryDirectory() as folder:
        payload = pathlib.Path(folder) / 'notes.json'
        payload.write_text(json.dumps(update), encoding='utf-8')
        result = gh_json(
            f'repos/{repository}/releases/{release["id"]}', '--method', 'PATCH', '--input', str(payload)
        )
    if publish and (result['draft'] or result['tag_name'] != version):
        raise ValueError('GitHub did not publish the requested draft')
    print(f'{version}: {phase} validation {status}; assets unchanged')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--version', required=True)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--lookup', action='store_true')
    actions.add_argument('--publish', action='store_true')
    parser.add_argument('--skip-full-validation', action='store_true')
    for name in ('commit', 'phase', 'status', 'run-url'):
        parser.add_argument('--' + name)
    args = parser.parse_args()
    if args.skip_full_validation and not args.publish:
        parser.error('--skip-full-validation requires --publish')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repository) or not re.fullmatch(r'v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', args.version):
        parser.error('Invalid repository or version')
    if args.lookup:
        print(json.dumps(find_release(args.repository, args.version)))
        return
    if not all((args.commit, args.phase, args.status, args.run_url)):
        parser.error('Status updates require --commit, --phase, --status and --run-url')
    save_status(args.repository, args.version, args.commit, args.phase, args.status, args.run_url,
                args.publish, skip_full_validation=args.skip_full_validation)


if __name__ == '__main__':
    main()
