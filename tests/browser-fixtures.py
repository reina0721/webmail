"""Resumable real-server data for CUA visual and interaction acceptance.

This seeds the isolated test stack through its public APIs. It is not itself
browser acceptance and never changes the existing user's mailbox or quota.
"""
from environment_client import *
state_path=ROOT/'browser-fixtures.json'
if state_path.exists():
 fixture=json.loads(state_path.read_text())
else:
 fixture={'name':'browser'+secrets.token_hex(5),'version':1}
 state_path.write_text(json.dumps(fixture));state_path.chmod(0o600)
email=fixture['name']+'@example.com'
try:owner=login(email,D['userPassword'])
except AssertionError:owner,email=signup(fixture['name'])
fixture.update(email=email,password=D['userPassword'])
session=req('/jmap/session',c=owner);account=session['platformAccountId']
boxes=jmap(owner,'Mailbox/get')['list'];inbox=next(b['id'] for b in boxes if b.get('role')=='inbox')
def folder(name,parent=None):
 found=next((b['id'] for b in boxes if b['name']==name and b.get('parentId')==parent),None)
 if found:return found
 id=create(owner,'Mailbox',{'name':name,'parentId':parent});boxes.append({'id':id,'name':name,'parentId':parent});return id
projects=folder('验收项目');archive=folder('2026',projects);notes=folder('待整理')
prefix='持续加载验收 '
ids=jmap(owner,'Email/query',{'filter':{'subject':prefix},'limit':500})['ids']
existing={e['subject'] for e in jmap(owner,'Email/get',{'ids':ids,'properties':['subject']})['list']} if ids else set()
now=datetime.datetime.now(datetime.timezone.utc)
pending={}
for index in range(240):
 subject=prefix+str(index+1).zfill(3)+' · 午后邮局'
 if subject in existing:continue
 pending['m'+str(index)]={'mailboxIds':{inbox:True},'keywords':{'$seen':True} if index%2==0 else {'$flagged':True} if index%5==0 else {},'from':[{'name':'Sakura','email':D['user']}],'to':[{'email':email}],'subject':subject,'receivedAt':(now-datetime.timedelta(minutes=index)).isoformat().replace('+00:00','Z'),'textBody':[{'partId':'t','type':'text/plain'}],'bodyValues':{'t':{'value':'真实 Stalwart 中保存的验收邮件。用于检查虚拟列表、持续加载、排序、筛选、标签和批量操作。\n第 '+str(index+1)+' 封。'}}}
for start in range(0,len(pending),80):
 batch=dict(list(pending.items())[start:start+80]);jmap(owner,'Email/set',{'create':batch})
thread_subject='浏览器验收 · 项目讨论'
if not jmap(owner,'Email/query',{'filter':{'subject':thread_subject},'limit':1})['ids']:
 messages={}
 for index in range(3):
  mid='browser-thread-'+fixture['name']+'-'+str(index)+'@example.com'
  message={'mailboxIds':{inbox:True},'keywords':{},'messageId':[mid],'from':[{'name':'Sakura','email':D['user']}],'to':[{'email':email}],'subject':thread_subject if index==0 else 'Re: '+thread_subject,'textBody':[{'partId':'t','type':'text/plain'}],'bodyValues':{'t':{'value':['我们开始讨论新的工作区。','回复中应保留会话关系。','第三封邮件用于验证会话展开。'][index]}}}
  if index:message.update(inReplyTo=['browser-thread-'+fixture['name']+'-0@example.com'],references=['browser-thread-'+fixture['name']+'-0@example.com'])
  messages['thread'+str(index)]=message
 jmap(owner,'Email/set',{'create':messages})
fixture.update(accountId=account,inboxId=inbox,projectFolderId=projects,archiveFolderId=archive,notesFolderId=notes)
state_path.write_text(json.dumps(fixture,ensure_ascii=False,indent=2));state_path.chmod(0o600)
print('Isolated browser fixtures are ready: 240 stored messages, a three-message thread and nested folders. Private login: '+str(state_path),flush=True)
