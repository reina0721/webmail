"""Never promote a ported module or an HTTP-only check to complete delivery."""
import argparse,json,pathlib,sys
root=pathlib.Path(__file__).resolve().parents[1]

def missing_acceptance(matrix,phase):
 # The publication evidence is produced only AFTER the authorized commit,
 # push and versioned deployment. It cannot be a prerequisite of that commit.
 return [row for row in matrix['items'] if row['status'] not in ['verified','browser-verified']
         and not (phase=='prepublish' and row['module']=='发布')]

def record_verified_soak(matrix,proof):
 # Only record completed evidence. This never promotes a missing browser or
 # product row, and never marks publication complete before the actual push.
 before=proof.get('beforeBuild');after=proof.get('afterBuild')
 if (proof.get('passed') is not True or proof.get('elapsedSeconds',0)<1800
     or not isinstance(before,dict) or not before.get('buildId') or before!=after
     or proof.get('successfulRegistrations')!=4 or missing_acceptance(matrix,'prepublish')):
  raise ValueError('Incomplete, changed-build or premature acceptance evidence')
 row=next(r for r in matrix['items'] if r['module']=='持续注册')
 row['evidence']=f"最终生产 Docker 构建 {before['buildId']} 连续 {proof['elapsedSeconds']:.1f} 秒，四次真实 SMTP 验证码收信、注册与登录通过；前后 build.json 完全一致。健康过期及依赖故障恢复通过 Rust 和真实服务回归。证据 docs/acceptance/soak-build-report.json 与 soak-report.json；仅本机隔离环境。"
 matrix['releaseReady']=True
 return matrix

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--phase',choices=['prepublish','published'],default='prepublish');parser.add_argument('--record-verified-soak',type=pathlib.Path);args=parser.parse_args()
 matrix_path=root/'docs/feature-parity.json';matrix=json.loads(matrix_path.read_text())
 if args.record_verified_soak:
  try:record_verified_soak(matrix,json.loads(args.record_verified_soak.read_text()))
  except ValueError as error:print(str(error),file=sys.stderr);return 1
  matrix_path.write_text(json.dumps(matrix,ensure_ascii=False,indent=2)+'\n')
 missing=missing_acceptance(matrix,args.phase)
 if not matrix.get('releaseReady') or missing:
  print('Release gate is NOT satisfied. Local regression success is not complete feature acceptance.',file=sys.stderr)
  for row in missing:print('- '+row['module']+': '+row['feature']+' ['+row['status']+']',file=sys.stderr)
  return 1
 print('Release feature matrix passed ('+args.phase+').');return 0

if __name__=='__main__':raise SystemExit(main())
