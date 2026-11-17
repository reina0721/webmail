// Native host serves locale-neutral, static routes; the catalog is chosen by IntlProvider.
import NextLink from 'next/link';
import {usePathname as pathname,useRouter as router,redirect as nextRedirect} from 'next/navigation';
export const Link=NextLink;
export const usePathname=pathname;
export const useRouter=router;
export const redirect=nextRedirect;
