import type { NextConfig } from "next";
import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const version=readFileSync(new URL('../../../release-version.txt',import.meta.url),'utf8').trim().replace(/^v/,'');
let revision=process.env.MAIL_WEB_REVISION || 'development';
if(!process.env.MAIL_WEB_REVISION)try{revision=execSync('git rev-parse HEAD',{stdio:['ignore','pipe','ignore']}).toString().trim();}catch{}
const devUpstream = process.env.MAIL_WEB_DEV_UPSTREAM;
const devBodyBytes=Number(process.env.MAIL_WEB_DEV_MAX_BODY_BYTES ?? 128*1024*1024);
if(devUpstream && (!Number.isSafeInteger(devBodyBytes)||devBodyBytes<=0))throw new Error('MAIL_WEB_DEV_MAX_BODY_BYTES must be a positive byte count');
const config: NextConfig = {
  devIndicators:false,
  generateBuildId:async()=>revision,
  env:{NEXT_PUBLIC_BUILD_ID:revision,NEXT_PUBLIC_GIT_COMMIT:revision,NEXT_PUBLIC_APP_VERSION:version},
  output: devUpstream ? undefined : "export",
  trailingSlash: true,
  skipTrailingSlashRedirect: !!devUpstream,
  transpilePackages: [
    "@mail-web/ui",
    "@community-go/state-foundation",
    "@community-go/i18n",
    "@community-go/form-foundation",
  ],
  ...(devUpstream
    ? {
        // Next otherwise truncates proxied uploads at 10MB. The independent
        // Stalwart stack advertises a larger ceiling and Rust enforces it.
        experimental:{proxyClientMaxBodySize:devBodyBytes},
        rewrites: async () => [
          { source: "/api/:path*", destination: devUpstream + "/api/:path*" },
          {
            source: "/internal/:path*",
            destination: devUpstream + "/internal/:path*",
          },
        ],
      }
    : {}),
};
export default config;
