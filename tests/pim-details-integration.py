"""Additional real-server checks for imported data, copies and sharing."""
import pathlib,sys,uuid,json,time
from environment_client import *
project=pathlib.Path(__file__).resolve().parents[1]
d=D;operator=login(d['operator'],d['operatorPassword']);alice,actor_email=signup('pim'+str(int(time.time())));d={**D,'user':actor_email}
other=next(u for u in req('/admin/users',c=operator)['items'] if u['email'].startswith('haru'))
bob=login(other['email'],d['userPassword']);a=req('/jmap/session',c=alice)['platformAccountId'];b=req('/jmap/session',c=bob)['platformAccountId']
books=jmap(alice,'AddressBook/get')['list'];book=books[0]['id'];stamp=uuid.uuid4().hex[:8]
blob=upload(alice,'import.vcf',('BEGIN:VCARD\r\nVERSION:4.0\r\nUID:urn:uuid:'+str(uuid.uuid4())+'\r\nFN:Imported Sakura\r\nEMAIL:sakura@example.com\r\nEND:VCARD\r\n').encode(),'text/vcard')
parsed=jmap(alice,'ContactCard/parse',{'blobIds':[blob['blobId']]});assert parsed.get('parsed'),parsed
cards=[]
for value in parsed['parsed'].values():cards.extend(value if isinstance(value,list) else [value])
for card in cards:
 card.pop('id',None);card['addressBookIds']={book:True};create(alice,'ContactCard',card)
passed('A real uploaded vCard parses and imports into the selected address book')
ics=('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Mail Web Test//EN\r\nBEGIN:VEVENT\r\nUID:'+str(uuid.uuid4())+'\r\nDTSTAMP:20261116T170000Z\r\nDTSTART:20261120T150000Z\r\nDURATION:PT1H\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:Imported recurring meeting\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n').encode()
blob=upload(alice,'meeting.ics',ics,'text/calendar');parsed=jmap(alice,'CalendarEvent/parse',{'blobIds':[blob['blobId']]});assert parsed.get('parsed'),parsed
cal=jmap(alice,'Calendar/get')['list'][0]['id']
for value in parsed['parsed'].values():
 for event in value if isinstance(value,list) else [value]:
  event.pop('id',None);event.pop('method',None);event['calendarIds']={cal:True};create(alice,'CalendarEvent',event)
passed('A real ICS attachment parses and imports a recurring event')
# The same collection-sharing UI serves mail folders, calendars and books.
# Exercise actual official-server reads, denied writes, and revocation for
# each kind, rather than accepting a successful shareWith update alone.
def collection_call(c,kind,action,args,account):
 cap='mail' if kind in ['Mailbox','Email'] else 'calendars' if kind.startswith('Calendar') else 'contacts'
 using=['urn:ietf:params:jmap:core','urn:ietf:params:jmap:'+cap]
 if kind=='Mailbox':using.append('urn:ietf:params:jmap:mail:share')
 response=req('/jmap',{'using':using,'methodCalls':[[kind+'/'+action,{'accountId':account,**args},'shared']]},'POST',c)['methodResponses'][0]
 assert response[0]==kind+'/'+action,response
 return response[1]
shared_box=create(alice,'Mailbox',{'name':'Shared browser mail '+stamp})
shared_message=create(alice,'Email',{'mailboxIds':{shared_box:True},'from':[{'email':actor_email}],'to':[{'email':other['email']}],'subject':'Shared mailbox content '+stamp,'textBody':[{'partId':'t','type':'text/plain'}],'bodyValues':{'t':{'value':'Only this shared mail folder may be read.'}}})
readonly_mail={'mayReadItems':True,'mayAddItems':False,'mayRemoveItems':False,'maySetSeen':True,'maySetKeywords':False,'mayCreateChild':False,'mayRename':False,'mayDelete':False,'maySubmit':False,'mayShare':False}
readonly_calendar={'mayReadFreeBusy':True,'mayReadItems':True,'mayWriteAll':False,'mayWriteOwn':False,'mayUpdatePrivate':False,'mayRSVP':False,'mayShare':False,'mayDelete':False}
readonly_book={'mayRead':True,'mayWrite':False,'mayShare':False,'mayDelete':False}
for kind,col,rights,item_kind,item_id in [('Mailbox',shared_box,readonly_mail,'Email',shared_message),('Calendar',cal,readonly_calendar,'CalendarEvent',jmap(alice,'CalendarEvent/get')['list'][0]['id']),('AddressBook',book,readonly_book,'ContactCard',jmap(alice,'ContactCard/get')['list'][0]['id'])]:
 collection_call(alice,kind,'set',{'update':{col:{'shareWith':{b:rights}}}},a)
 assert a in req('/jmap/session',c=bob)['accounts']
 found=collection_call(bob,kind,'get',{'ids':[col]},a)['list'];assert len(found)==1,found
 assert len(jmap(bob,item_kind+'/get',{'accountId':a,'ids':[item_id]})['list'])==1
 # Calendar/book display names are per-user properties on official Stalwart;
 # changing those is permitted even with read-only contents. Test the actual
 # protected content, rather than treating personal presentation as a write.
 write_kind,write_id,patch=(kind,col,{'name':'must-not-rename'}) if kind=='Mailbox' else (item_kind,item_id,{'title':'must-not-write'} if kind=='Calendar' else {'name/full':'must-not-write'})
 rejected=collection_call(bob,write_kind,'set',{'update':{write_id:patch}},a)
 assert rejected['notUpdated'][write_id]['type']=='forbidden',rejected
 collection_call(alice,kind,'set',{'update':{col:{'shareWith':None}}},a)
 assert a not in req('/jmap/session',c=bob)['accounts']
 req('/jmap',{'using':['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail'],'methodCalls':[['Email/get',{'accountId':a,'ids':[]},'revoked']]},'POST',bob,403)
 passed('Real '+kind+' sharing exposes only the selected collection, rejects protected writes and revokes subsequent account access')
blob=upload(alice,'shared.txt',b'File copy and sharing verification');file=create(alice,'FileNode',{'@type':'File','name':'shared-'+stamp+'.txt','parentId':None,'blobId':blob['blobId'],'mediaType':'text/plain'})
folder=create(alice,'FileNode',{'@type':'Directory','name':'Copies-'+stamp,'parentId':None})
copy=create(alice,'FileNode',{'@type':'File','name':'copy-'+stamp+'.txt','parentId':folder,'blobId':blob['blobId'],'mediaType':'text/plain'});assert jmap(alice,'FileNode/get',{'ids':[copy]})['list'][0]['parentId']==folder
passed('File copy creates a separate durable node in the destination folder')
jmap(alice,'FileNode/set',{'update':{file:{'parentId':folder}}})
rights={'mayRead':True,'mayAddChildren':False,'mayRename':False,'mayDelete':False,'mayModifyContent':False,'mayShare':False};jmap(alice,'FileNode/set',{'update':{folder:{'shareWith':{b:rights}}}})
session=req('/jmap/session',c=bob);assert a in session['accounts'],session['accounts'];shared=jmap(bob,'FileNode/get',{'accountId':a,'ids':[file]})['list'][0];assert shared['name']=='shared-'+stamp+'.txt'
try:jmap(bob,'FileNode/set',{'accountId':a,'update':{file:{'name':'must-not-change'}}})
except AssertionError:pass
else:raise AssertionError('Read-only recipient renamed a shared file')
jmap(alice,'FileNode/set',{'update':{folder:{'shareWith':None}}});
try:jmap(bob,'FileNode/get',{'accountId':a,'ids':[file]})
except AssertionError:pass
else:raise AssertionError('Revoked recipient still reads a shared file')
passed('Directory sharing grants inherited read-only file access and revocation removes it')
# Real scheduling: internal attendees receive the event, external attendees receive iMIP through the same MTA policy.
external='invite-'+stamp+'@recovery.example.net';uid=str(uuid.uuid4());owner='owner';attendee='guest';title='Calendar invite '+stamp
payload={'@type':'Event','uid':uid,'calendarIds':{cal:True},'title':title,'start':(datetime.datetime.now()+datetime.timedelta(days=1)).replace(hour=10,minute=0,second=0,microsecond=0).isoformat(),'duration':'PT1H','timeZone':'America/New_York','participants':{owner:{'@type':'Participant','calendarAddress':'mailto:'+d['user'],'email':d['user'],'roles':{'owner':True},'participationStatus':'accepted','scheduleAgent':'server'},attendee:{'@type':'Participant','calendarAddress':'mailto:'+external,'email':external,'roles':{'attendee':True},'expectReply':True,'participationStatus':'needs-action','scheduleAgent':'server'}}}
usage=req('/account/usage',c=alice)
event=jmap(alice,'CalendarEvent/set',{'sendSchedulingMessages':True,'create':{'invite':payload}})['created']['invite']['id']
def scheduled_messages(count):
 for _ in range(120):
  found=json.load(PUBLIC.open(MAIL+'/api/v1/search?query='+urllib.parse.quote('to:'+external),timeout=10)).get('messages',[])
  if len(found)>=count:return found
  time.sleep(.25)
 raise AssertionError('Calendar scheduling notification did not arrive at the real SMTP receiver')
scheduled_messages(1)
jmap(alice,'CalendarEvent/set',{'sendSchedulingMessages':True,'update':{event:{'title':title+' updated'}}});scheduled_messages(2)
jmap(alice,'CalendarEvent/set',{'sendSchedulingMessages':True,'destroy':[event]});scheduled_messages(3)
assert req('/account/usage',c=alice)['dailyRecipientsUsed']-usage['dailyRecipientsUsed']==3
passed('Calendar invitation, update and cancellation reach the real SMTP receiver and share the external-recipient counter')
# Same-server invitations arrive in the recipient calendar rather than as duplicate email.
internal={**payload,'uid':str(uuid.uuid4()),'title':'Internal RSVP '+stamp,'participants':{owner:payload['participants'][owner],attendee:{**payload['participants'][attendee],'calendarAddress':'mailto:'+d['operator'],'email':d['operator']}}}
event=jmap(alice,'CalendarEvent/set',{'sendSchedulingMessages':True,'create':{'invite':internal}})['created']['invite']['id']
for _ in range(80):
 invites=jmap(operator,'CalendarEvent/get')['list'];invite=next((e for e in invites if e.get('uid')==internal['uid']),None)
 if invite:break
 time.sleep(.25)
else:raise AssertionError('Internal calendar invitation did not reach the recipient calendar')
jmap(operator,'CalendarEvent/set',{'sendSchedulingMessages':True,'update':{invite['id']:{'participants/'+attendee+'/participationStatus':'accepted'}}})
for _ in range(80):
 updated=jmap(alice,'CalendarEvent/get',{'ids':[event]})['list'][0]
 if updated['participants'][attendee]['participationStatus']=='accepted':break
 time.sleep(.25)
else:raise AssertionError('The organizer did not receive the attendee RSVP')
passed('Same-server calendar invitation persists for the attendee and RSVP updates the organizer event')
(project/'tests/runtime/rebuild/pim-details-report.json').write_text(json.dumps(EVIDENCE,indent=2))
