"""A completed soak cannot hide missing UI acceptance or a changed deployment."""
import copy,importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('gate',pathlib.Path(__file__).resolve().parents[1]/'tooling/check-release.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)

class ReleaseEvidence(unittest.TestCase):
 def setUp(self):
  self.matrix={'releaseReady':False,'items':[{'module':'邮件','status':'browser-verified'},{'module':'持续注册','status':'verified'},{'module':'发布','status':'pending'}]}
  self.proof={'passed':True,'elapsedSeconds':1802,'successfulRegistrations':4,'beforeBuild':{'buildId':'candidate'},'afterBuild':{'buildId':'candidate'}}
 def test_accepts_only_completed_build_and_preserves_pending_publication(self):
  result=gate.record_verified_soak(self.matrix,self.proof)
  self.assertTrue(result['releaseReady']);self.assertEqual(result['items'][-1]['status'],'pending')
 def test_refuses_incomplete_or_changed_build(self):
  for patch in [{'elapsedSeconds':1799},{'successfulRegistrations':3},{'passed':False},{'afterBuild':{'buildId':'different'}},{'beforeBuild':None}]:
   with self.subTest(patch=patch),self.assertRaises(ValueError):gate.record_verified_soak(copy.deepcopy(self.matrix),{**self.proof,**patch})
 def test_refuses_missing_product_acceptance(self):
  self.matrix['items'][0]['status']='browser-partial'
  with self.assertRaises(ValueError):gate.record_verified_soak(self.matrix,self.proof)
 def test_prepublish_and_published_have_distinct_requirements(self):
  self.assertEqual(gate.missing_acceptance(self.matrix,'prepublish'),[])
  self.assertEqual([r['module'] for r in gate.missing_acceptance(self.matrix,'published')],['发布'])

if __name__=='__main__':unittest.main()
