import {NativeWindowRoute} from '@/native/workspace';
export function generateStaticParams(){return [{segments:['_']}];}
export default function Page(){return <NativeWindowRoute/>;}
