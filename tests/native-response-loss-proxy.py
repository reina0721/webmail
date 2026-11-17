"""Disposable fault injector: forward to official Stalwart, lose one accepted response.

Never logs request headers or bodies. Only the designated creation ID is affected.
The upstream image, configuration and data remain unchanged.
"""
import http.client, http.server, json, pathlib, socket, sys, threading

target, marker = sys.argv[1], pathlib.Path(sys.argv[2])
lock = threading.Lock()

class Proxy(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_): pass
    def forward(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        upstream = http.client.HTTPConnection(target, 8080, timeout=60)
        try:
            upstream.request(self.command, self.path, body, {
                k:v for k,v in self.headers.items()
                if k.lower() not in ['connection', 'transfer-encoding']
            })
            response = upstream.getresponse()
            # Streaming subscriptions are irrelevant to the injected submission;
            # preserve them without buffering an infinite SSE response.
            if 'text/event-stream' in (response.getheader('Content-Type') or ''):
                self.send_response(response.status)
                self.send_header('Content-Type','text/event-stream')
                self.send_header('Connection','close'); self.end_headers()
                while chunk := response.read1(4096):
                    self.wfile.write(chunk); self.wfile.flush()
                return
            payload = response.read()
            drop = False
            if self.command == 'POST' and self.path.rstrip('/') == '/jmap':
                try:
                    result=json.loads(payload)
                    accepted=any(m[0]=='EmailSubmission/set' and m[1].get('created',{}).get('qa_response_loss')
                                 for m in result.get('methodResponses',[]))
                    with lock:
                        if accepted and not marker.exists():
                            marker.write_text(json.dumps({'officialUpstreamAccepted':True}))
                            drop=True
                except (ValueError,IndexError,TypeError): pass
            if drop:
                self.connection.shutdown(socket.SHUT_RDWR); self.connection.close()
                return
            self.send_response(response.status)
            for key,value in response.getheaders():
                if key.lower() not in ['content-length','connection','transfer-encoding']:
                    self.send_header(key,value)
            self.send_header('Content-Length',str(len(payload))); self.end_headers()
            self.wfile.write(payload)
        except (BrokenPipeError,ConnectionResetError): pass
        finally: upstream.close()
    do_GET=forward
    do_POST=forward
    do_PUT=forward
    do_DELETE=forward

http.server.ThreadingHTTPServer(('0.0.0.0',8080),Proxy).serve_forever()
