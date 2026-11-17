"use client";
import {useEffect,useId,type ReactNode,type RefObject,type FormEvent} from 'react';
import {NativeDialog} from '@mail-web/ui/native-controls';
import {useTranslations} from 'next-intl';
import {InDialogContext} from './dialog-surface';
export type DialogSize = "sm" | "md" | "lg" | "full-on-phone";

export interface DialogProps {
  isOpen: boolean;
  /** Called by Escape, the close X and an outside click. Ask about unsaved input here (R5). */
  onClose: () => void;
  title: ReactNode;
  /** One line under the title; becomes the dialog's description. */
  description?: ReactNode;
  /** The body, under the title and description. */
  children?: ReactNode;
  /** The buttons: Cancel (outline) first, then the primary. Laid out at the end. */
  footer?: ReactNode;
  /** `alertdialog` for confirmations. */
  role?: "dialog" | "alertdialog";
  /** sm 384px, md 448px (default), lg 672px; full-on-phone fills a phone screen and is lg above. */
  size?: DialogSize;
  /** Drawn before the title, e.g. the warning icon of a destructive confirm. */
  icon?: ReactNode;
  /** The close X at the top end. Default true. */
  showClose?: boolean;
  /** Ignore clicks outside, e.g. while the dialog holds unsaved input. */
  preventOutsideClose?: boolean;
  /** Same as preventOutsideClose: the dialog holds unsaved input. */
  dirty?: boolean;
  /** Where the focus goes on open. Default: the first field, else the first control. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Wraps body and footer in a form, so Enter in a field submits. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  /** Extra classes for the panel. */
  className?: string;
  /** Extra classes for the body. */
  bodyClassName?: string;
  /** Test hook on the panel. */
  testId?: string;
  /**
   * Stay over the page in the desktop app instead of opening a window of its own. For
   * what can't work in another window; say why where it's set.
   */
  inPage?: boolean;
}

export function Dialog(props:DialogProps){
 const t=useTranslations('common');const id=useId();const testId=props.testId??id;
 useEffect(()=>{
  if(!props.isOpen)return;
  const escape=(event:KeyboardEvent)=>{
   const modals=document.querySelectorAll<HTMLElement>('[aria-modal="true"]');const panel=modals[modals.length-1];
   if(event.key==='Escape'&&!event.defaultPrevented&&panel?.dataset.testid===testId&&!panel.contains(event.target as Node)){event.preventDefault();props.onClose();}
  };
  document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);
 },[props.isOpen,props.onClose,testId]);
 return <InDialogContext.Provider value={true}><NativeDialog {...props} testId={testId} closeLabel={t('close')}/></InDialogContext.Provider>;
}
