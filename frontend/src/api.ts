import type { Workspace } from './types';
export async function request<T>(workspace:Workspace,path:string,options:RequestInit={}):Promise<T>{
 const headers=new Headers(options.headers);headers.set('X-Workspace',workspace);
 if(options.body && !(options.body instanceof FormData)) headers.set('Content-Type','application/json');
 let response:Response;
 try{response=await fetch(`/api${path}`,{...options,headers})}
 catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw error;throw new Error('暂时无法连接本机服务。请重新打开英语班主任，再点击重试。')}
 if(!response.ok){let message=`请求未完成（${response.status}）`;try{const body=await response.json();message=typeof body.detail==='string'?body.detail:JSON.stringify(body.detail||body)}catch{}throw new Error(message)}
 return response.json() as Promise<T>;
}
export const json=(method:string,body:unknown):RequestInit=>({method,body:JSON.stringify(body)});
