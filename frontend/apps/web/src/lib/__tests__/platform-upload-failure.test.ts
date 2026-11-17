import {afterEach,expect,it,vi} from 'vitest';
import {nativeFetch} from '@/lib/platform-transport';
import {UploadXHR,uploadClient} from './helpers/upload-xhr';

afterEach(()=>{vi.unstubAllGlobals();UploadXHR.instances=[];});
it('explains an official temporary upload quota response without losing the transfer error',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({code:'upload_quota_exceeded'},{status:429})));
 await expect(nativeFetch('/api/v1/jmap/upload/own',{method:'POST',body:new Blob(['kept'])})).rejects.toThrow('临时上传空间已满');
});
it('uses the same recoverable explanation for XHR uploads with progress',async()=>{
 vi.stubGlobal('XMLHttpRequest',UploadXHR);UploadXHR.instances=[];
 const client=uploadClient();Object.assign(client,{serverUrl:location.origin+'/api/v1/native'});
 const file=new File(['kept'],'kept.txt',{type:'text/plain'});
 const pending=client.uploadBlob(file,{onProgress:vi.fn()});
 const failure=expect(pending).rejects.toThrow('附件与编辑内容已保留');
 await vi.waitFor(()=>expect(UploadXHR.instances).toHaveLength(1));
 UploadXHR.instances[0].load(429,JSON.stringify({code:'upload_quota_exceeded'}));
 await failure;expect(UploadXHR.instances[0].body).toBe(file);
});
