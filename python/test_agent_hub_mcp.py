"""Real stdio MCP protocol and HTTP job roundtrip against an isolated temporary API."""
import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def check(port,folder):
    token=(folder/'hub.key').read_text();headers={'Authorization':'Bearer '+token}
    async with httpx.AsyncClient(trust_env=False) as http:
        response=await http.post(f'http://127.0.0.1:{port}/api/agent-center/jobs',headers=headers,json=dict(title='Protocol test task',prompt='Read integration docs and report test evidence',target='generic',skill='vrp-job-worker'))
        response.raise_for_status();job=response.json()
    code=f'import dashboard_mcp as m;from pathlib import Path;m.HUB_PORT={port};m.TOKEN=Path({str(folder/"hub.key")!r});m.mcp.run(transport="stdio")'
    params=StdioServerParameters(command=sys.executable,args=['-c',code],cwd=str(Path(__file__).parent),env={**os.environ,'VRP_AGENT_CLIENT':'generic'})
    async with stdio_client(params) as (read,write):
        async with ClientSession(read,write) as session:
            await session.initialize()
            listing=await session.list_tools();assert len(listing.tools)==9
            resource=await session.read_resource('vrp://guide');assert 'Agent Center' in resource.contents[0].text
            def payload(r):
                assert not r.isError,r
                return json.loads(next(c.text for c in r.content if c.type=='text'))
            claim=payload(await session.call_tool('dashboard_claim',{'job_id':job['id']}))
            lease=claim['lease_token']
            progress=payload(await session.call_tool('dashboard_progress',dict(job_id=job['id'],lease_token=lease,message='Verified MCP resource read')))
            assert progress['status']=='running'
            done=payload(await session.call_tool('dashboard_finish',dict(job_id=job['id'],lease_token=lease,result='Protocol roundtrip verified',success=True)))
            assert done['status']=='completed'
            rejected=await session.call_tool('dashboard_claim',{'job_id':job['id']});assert rejected.isError
            invalid=await session.call_tool('dashboard_query',{'tool':'not_allowed','arguments':{}});assert invalid.isError
    print('PASS real MCP initialize, tool discovery, resource read, task claim/progress/result and invalid-call errors')

if __name__=='__main__':
    with tempfile.TemporaryDirectory() as tmp:
        folder=Path(tmp)
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        code=f'import agent_hub_store as s;from pathlib import Path;s.DB=Path({str(folder/"hub.db")!r});s.TOKEN=Path({str(folder/"hub.key")!r});import uvicorn;uvicorn.run("agent_hub_api:app",host="127.0.0.1",port={port},log_level="error")'
        proc=subprocess.Popen([sys.executable,'-c',code],cwd=Path(__file__).parent,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:
                    if httpx.get(f'http://127.0.0.1:{port}/openapi.json',timeout=.2,trust_env=False).status_code==200:break
                except httpx.HTTPError:time.sleep(.1)
            else:raise RuntimeError('Isolated test API did not start')
            asyncio.run(check(port,folder))
        finally:proc.terminate();proc.wait(timeout=10)
