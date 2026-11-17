import hashlib
import importlib.util
import io
import json
import pathlib
import tarfile
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('image_config',pathlib.Path(__file__).resolve().parents[1]/'tooling/image_config_id.py')
image=importlib.util.module_from_spec(spec);spec.loader.exec_module(image)

class ImageIdentity(unittest.TestCase):
    def archive(self,root,config,duplicate=False,tag='mail-web:1'):
        path=pathlib.Path(root)/'image.tar'
        with tarfile.open(path,'w') as archive:
            manifest=json.dumps([{'Config':'config.json','RepoTags':[tag],'Layers':[]}]).encode()
            for name,data in [('manifest.json',manifest),('config.json',config)]+([('config.json',config)] if duplicate else []):
                info=tarfile.TarInfo(name);info.size=len(data);archive.addfile(info,io.BytesIO(data))
        return path
    def test_config_identity_is_independent_of_tag_normalization(self):
        with tempfile.TemporaryDirectory() as root:
            config=b'{"rootfs":{"diff_ids":["sha256:payload"]}}'
            path=self.archive(root,config,tag='docker.io/library/mail-web:1')
            self.assertEqual(image.config_id(path,'mail-web:1'),'sha256:'+hashlib.sha256(config).hexdigest())
            with self.assertRaises(ValueError):image.config_id(path,'mail-web:other')
    def test_changed_rootfs_and_ambiguous_configs_are_not_accepted(self):
        with tempfile.TemporaryDirectory() as root:
            first=image.config_id(self.archive(root,b'{"rootfs":{"diff_ids":["one"]}}'),'mail-web:1')
            second=image.config_id(self.archive(root,b'{"rootfs":{"diff_ids":["two"]}}'),'mail-web:1')
            self.assertNotEqual(first,second)
            with self.assertRaises(ValueError):image.config_id(self.archive(root,b'{}',duplicate=True),'mail-web:1')

if __name__=='__main__':unittest.main()
