import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
export const dynamic='force-dynamic';
export const runtime='nodejs';
async function proxy(req:NextRequest) {
  if(req.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({detail:'Cross-site requests rejected'},{status:403});
  const origin=req.headers.get('origin');
  if(origin&&origin!==req.nextUrl.origin&&origin!==`${req.nextUrl.protocol}//${req.headers.get('host')}`)return NextResponse.json({detail:'Origin mismatch'},{status:403});
  try {
    const body=req.method==='POST'?await req.text():undefined;
    if(body&&Buffer.byteLength(body)>80_000)return NextResponse.json({detail:'Request exceeds 80 KB'},{status:413});
    const key=(await readFile(path.resolve(process.cwd(),'../python/data/agent_hub.key'),'utf8')).trim();
    const response=await fetch(`http://127.0.0.1:8016${req.nextUrl.pathname}`,{method:req.method,body,headers:{Authorization:`Bearer ${key}`,'X-Agent-Client':'dashboard',...(body?{'Content-Type':'application/json'}:{})},cache:'no-store',signal:AbortSignal.timeout(85_000)});
    const headers:Record<string,string>={'Content-Type':response.headers.get('content-type')||'application/json','Cache-Control':'no-store'};
    const attachment=response.headers.get('content-disposition');if(attachment)headers['Content-Disposition']=attachment;
    return new NextResponse(response.body,{status:response.status,headers});
  }catch{return NextResponse.json({detail:'Agent Center unavailable. Start start_dashboard.cmd with agenthub (8016).'},{status:503});}
}
export const GET=proxy;
export const POST=proxy;
