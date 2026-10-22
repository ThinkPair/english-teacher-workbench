import { useEffect, useRef, type ButtonHTMLAttributes, type MutableRefObject, type ReactNode } from 'react';
import { AlertCircle, FolderOpen, LoaderCircle, X } from 'lucide-react';
export { default as Dialog } from './ModalFrame';

export type ModuleGuardRef = MutableRefObject<(() => boolean) | null>;
export const messageOf=(error:unknown)=>error instanceof Error?error.message:'操作未完成，请重试';
export const displayDate=(value?:string|null)=>value?value.slice(0,10).replaceAll('-','.'): '—';
export function Action({children,icon,variant='',className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{icon?:ReactNode;variant?:string}){
 return <button type="button" className={`button ${variant} ${className}`} {...props}>{icon}{children}</button>;
}
export function InputField({label,hint,children,className=''}:{label:string;hint?:string;children:ReactNode;className?:string}){
 return <label className={`field ${className}`}><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;
}
export function Notice({message,onClose,tone='error'}:{message:string;onClose?:()=>void;tone?:string}){
 return message?<div className={`alert ${tone}`} role={tone==='error'?'alert':'status'}><AlertCircle size={18}/><span>{message}</span>{onClose&&<button className="icon-button" aria-label="关闭提示" onClick={onClose}><X size={17}/></button>}</div>:null;
}
export function Blank({title,text,children}:{title:string;text:string;children?:ReactNode}){
 return <div className="empty"><div className="empty-icon"><FolderOpen size={28}/></div><h3>{title}</h3><p>{text}</p>{children}</div>;
}
export function Loading({text='正在读取资料…'}:{text?:string}){return <div className="page-loading" role="status" aria-live="polite"><LoaderCircle size={26} className="spin" aria-hidden="true"/><p>{text}</p></div>}

export function useModuleSafety(guardRef:ModuleGuardRef,dirty:boolean,busy:boolean,notify:(message:string)=>void){
 const state=useRef({dirty,busy,notify});state.current={dirty,busy,notify};const alive=useRef(true);
 const allow=()=>{if(state.current.busy){state.current.notify('当前操作正在进行，请完成后再切换。');return false}return !state.current.dirty||window.confirm('当前内容还有未保存修改，确定离开吗？')};
 useEffect(()=>{alive.current=true;guardRef.current=allow;return()=>{alive.current=false;guardRef.current=null}},[guardRef]);
 useEffect(()=>{if(!dirty&&!busy)return;const beforeUnload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload)},[dirty,busy]);
 return {alive,allow};
}
