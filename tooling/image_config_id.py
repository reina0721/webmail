"""Canonical Docker config digest, independent of the daemon image store."""
import hashlib
import json
import sys
import tarfile


def config_id(path, image):
    with tarfile.open(path) as archive:
        manifests = [member for member in archive if member.name.removeprefix('./') == 'manifest.json']
        if len(manifests) != 1 or not manifests[0].isfile() or manifests[0].size > 1048576:
            raise ValueError('Invalid or ambiguous image manifest')
        entries = json.load(archive.extractfile(manifests[0]))
        entries = [entry for entry in entries if image in [tag.removeprefix('docker.io/library/') for tag in entry.get('RepoTags') or []]]
        if len(entries) != 1:
            raise ValueError('Expected one matching image')
        configs = [member for member in archive.getmembers() if member.name.removeprefix('./') == entries[0]['Config'].removeprefix('./')]
        if len(configs) != 1 or not configs[0].isfile() or configs[0].size > 1048576:
            raise ValueError('Invalid or ambiguous image config')
        return 'sha256:' + hashlib.file_digest(archive.extractfile(configs[0]), 'sha256').hexdigest()


if __name__ == '__main__':
    print(config_id(sys.argv[1], sys.argv[2]))
