export interface Skill {id:string;content:string;revision:number;description:string}
export interface Job {id:string;title:string;prompt:string;target:string;skill:string;skill_content:string;status:string;owner:string|null;lease_expired:boolean;updated:number;created:number;result:string;events?:{at:number;status:string;message:string}[]}
export interface Overview {
 tools:{name:string;description:string;inputSchema:object;example:Record<string,unknown>;access:string;service_port:number}[];
 skills:Skill[];jobs:Job[];profiles:{id:string;content:string;filename:string;location:string;transport:string}[];
 services:{name:string;port:number;ready:boolean}[];clients:{id:string;name:string;last_seen:number}[];
 audit:{id:number;at:number;client:string;tool:string;ok:number;duration:number}[];
}
export async function request<T>(path:string,body?:unknown):Promise<T>{
 const r=await fetch(`/api/agent-center/${path}`,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const d=await r.json();if(!r.ok)throw Error(typeof d.detail==='string'?d.detail:'Request rejected; check input fields');return d;
}
export function download(name:string,text:string,type='text/plain'){
 const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export const when=(stamp:number)=>new Date(stamp*1000).toLocaleString();
