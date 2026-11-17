"""Update only the validation section of an immutable release's notes."""
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


def render(body, commit, phase, status, run_url):
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
    else:
        full = line
    return before + START + '\n' + '\n'.join([f'- Source commit: `{commit}`', fast, full]) + '\n' + END + after


def gh_json(path):
    return json.loads(subprocess.check_output(['gh', 'api', path], text=True))


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('repository', 'version', 'commit', 'phase', 'status', 'run-url'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repository) or not re.fullmatch(r'v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', args.version):
        raise ValueError('Invalid repository or version')
    release = gh_json(f'repos/{args.repository}/releases/tags/{args.version}')
    verify_owner(args.repository, args.version, args.commit, release)
    body = render(release.get('body') or '', args.commit, args.phase, args.status, args.run_url)
    with tempfile.TemporaryDirectory() as folder:
        payload = pathlib.Path(folder) / 'notes.json'
        payload.write_text(json.dumps({'body': body}), encoding='utf-8')
        subprocess.run(['gh', 'api', '--method', 'PATCH', f'repos/{args.repository}/releases/{release["id"]}', '--input', str(payload)], check=True, stdout=subprocess.DEVNULL)
    print(f'{args.version}: {args.phase} validation {args.status}; assets unchanged')


if __name__ == '__main__':
    main()
