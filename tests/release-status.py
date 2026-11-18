import importlib.util
import pathlib
import json
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('release_status',pathlib.Path(__file__).resolve().parents[1]/'tooling/release_status.py')
status=importlib.util.module_from_spec(spec);spec.loader.exec_module(status)
SHA='a'*40
URL='https://github.com/reina0721/webmail/actions/runs/1234'

class ReleaseStatus(unittest.TestCase):
    def test_full_results_preserve_notes_and_fast_check_link(self):
        body=status.render('Human release notes.\n',SHA,'fast','success',URL)
        completed=status.render(body,SHA,'full','failure',URL+'5')
        self.assertIn('Human release notes.',completed)
        self.assertIn('- Fast checks: ✅ passed ([Actions]('+URL+'))',completed)
        self.assertIn('- Full validation: ❌ failed',completed)
        self.assertEqual(completed.count(status.START),1)
        self.assertNotIn('⏳ pending',completed)
    def test_progress_and_retry_do_not_claim_full_success(self):
        body=status.render('Notes',SHA,'fast','success',URL)
        self.assertIn('Full validation: ⏳ pending',body)
        for result in ['in_progress','failure','cancelled','success']:
            body=status.render(body,SHA,'full',result,URL)
            self.assertIn('Full validation: '+status.LABELS[result],body)
    def test_wrong_commit_and_ambiguous_markers_are_rejected(self):
        body=status.render('Notes',SHA,'fast','success',URL)
        with self.assertRaises(ValueError):status.render(body,'b'*40,'full','success',URL)
        with self.assertRaises(ValueError):status.render(body+status.START,SHA,'full','success',URL)
    def test_invalid_run_urls_are_rejected(self):
        for value in ['http://example.com','https://u:p@github.com/a/b/actions/runs/1','https://github.com/a/b/actions/runs/1#inject','https://github.com/a/b/actions/runs/1\ntext','https://github.com/a/b/actions/runs/1\n']:
            with self.subTest(value=value),self.assertRaises(ValueError):status.render('',SHA,'full','success',value)
    def test_draft_and_annotated_tag_must_belong_to_the_source(self):
        with self.assertRaises(ValueError):status.verify_owner('owner/repo','v1.0.0',SHA,{'draft':True,'target_commitish':'b'*40})
        with patch.object(status,'gh_json',side_effect=[{'object':{'type':'tag','sha':'c'*40}},{'object':{'type':'commit','sha':SHA}}]):
            status.verify_owner('owner/repo','v1.0.0',SHA,{'draft':False})
        with patch.object(status,'gh_json',return_value={'object':{'type':'commit','sha':SHA}}):
            status.verify_owner('owner/repo','v1.0.0',SHA,{'draft':True,'target_commitish':'main'})
        with patch.object(status,'gh_json',return_value={'object':{'type':'commit','sha':'b'*40}}),self.assertRaises(ValueError):
            status.verify_owner('owner/repo','v1.0.0',SHA,{'draft':False})

    def test_untagged_draft_is_published_by_its_verified_release_id(self):
        draft={'id':42,'tag_name':'v1.0.0','draft':True,'target_commitish':SHA,'body':'Notes'}
        calls=[]
        def api(path,*flags):
            calls.append(path)
            if path.endswith('?per_page=100'):
                self.assertEqual(flags,('--paginate','--slurp'))
                return [[{'tag_name':'v0.9.0'}],[draft]]
            self.assertEqual(path,'repos/owner/repo/releases/42')
            self.assertEqual(flags[:3],('--method','PATCH','--input'))
            update=json.loads(pathlib.Path(flags[3]).read_text())
            self.assertFalse(update['draft'])
            self.assertIn('Fast checks: ✅ passed',update['body'])
            return {**draft,'draft':False}
        with patch.object(status,'gh_json',side_effect=api):
            status.save_status('owner/repo','v1.0.0',SHA,'fast','success',URL,publish=True)
        self.assertEqual(len(calls),2)
    def test_lookup_never_selects_an_ambiguous_tag(self):
        draft={'tag_name':'v1.0.0','draft':True}
        with patch.object(status,'gh_json',return_value=[[draft],[draft]]),self.assertRaises(ValueError):
            status.find_release('owner/repo','v1.0.0')
    def test_published_release_is_never_published_again(self):
        with patch.object(status,'find_release',return_value={'draft':False}),self.assertRaises(ValueError):
            status.save_status('owner/repo','v1.0.0',SHA,'fast','success',URL,publish=True)

if __name__=='__main__':unittest.main()
