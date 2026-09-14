"""Agent Center API. Local authenticated gateway, profiles, skills, and leased job inbox."""
import io
import json
import re
import secrets
import sys
import time
import zipfile
from typing import Literal
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
import agent_hub_store as store
from agent_hub_tools import DOCS, catalog, health, query

app=FastAPI(title='VRP Agent Center',version='1.0')
CLIENTS=('codex','claude','antigravity','generic')

@app.on_event('startup')
def initialize_local():store.token()

@app.middleware('http')
async def local_auth(request,call_next):
    if request.url.path not in ('/openapi.json','/docs','/docs/oauth2-redirect','/redoc'):
        key=request.headers.get('authorization','').removeprefix('Bearer ')
        if not key or not secrets.compare_digest(key,store.token()):return JSONResponse({'detail':'Agent Center authentication required'},status_code=401)
        client=request.headers.get('x-agent-client','dashboard');ident=request.headers.get('x-agent-session','')
        if client not in (*CLIENTS,'dashboard'):return JSONResponse({'detail':'Unknown client profile'},status_code=400)
        request.state.client=client
        if client!='dashboard' and re.fullmatch(r'[a-f0-9-]{36}',ident):
            with store.connection() as db:
                db.execute('INSERT OR REPLACE INTO clients VALUES(?,?,?)',(ident,client,time.time()))
                db.execute('DELETE FROM clients WHERE last_seen<?',(time.time()-30*86400,))
    return await call_next(request)

@app.exception_handler(ValueError)
async def invalid(_request,exc):return JSONResponse({'detail':str(exc)[:1000]},status_code=422)
@app.exception_handler(RuntimeError)
async def conflict(_request,exc):return JSONResponse({'detail':str(exc)},status_code=409)
@app.exception_handler(KeyError)
async def missing(_request,exc):return JSONResponse({'detail':str(exc)},status_code=404)

def profiles():
    executable=store.ROOT/'python/.venv'/('Scripts/python.exe' if sys.platform=='win32' else 'bin/python')
    script=store.ROOT/'python/dashboard_mcp.py';out=[]
    for client in CLIENTS:
        settings=dict(command=str(executable),args=[str(script)],env={'VRP_AGENT_CLIENT':client})
        if client=='codex':
            content=f'[mcp_servers.vrp-dashboard]\ncommand = {json.dumps(str(executable))}\nargs = [{json.dumps(str(script))}]\nstartup_timeout_sec = 20\ntool_timeout_sec = 90\n\n[mcp_servers.vrp-dashboard.env]\nVRP_AGENT_CLIENT = "codex"\n'
            filename='config.toml';location='.codex/config.toml (trusted project) or user config.toml'
        else:
            content=json.dumps({'mcpServers':{'vrp-dashboard':settings}},indent=2)
            filename='mcp_config.json' if client=='antigravity' else '.mcp.json' if client=='claude' else 'mcp.json'
            location='.agents/mcp_config.json / View raw config' if client=='antigravity' else '.mcp.json (Claude Code); merge entry into Claude Desktop config' if client=='claude' else 'Your client MCP stdio configuration'
        out.append(dict(id=client,content=content,filename=filename,location=location,transport='stdio',verified='Generated profile; client installation is manual'))
    return out

@app.get('/api/agent-center/overview')
async def overview():
    with store.connection() as db:
        clients=[dict(r) for r in db.execute('SELECT * FROM clients ORDER BY last_seen DESC LIMIT 50')]
        audit=[dict(r) for r in db.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 50')]
    return dict(tools=catalog(),skills=store.skills(),profiles=profiles(),services=await health(),clients=clients,audit=audit,jobs=store.list_jobs(),documents=list(DOCS))

class Body(BaseModel):model_config=ConfigDict(extra='forbid')
class ToolCall(Body):
    name:str=Field(max_length=60)
    arguments:dict=Field(default_factory=dict)
@app.post('/api/agent-center/tools/call')
async def tool_call(body:ToolCall,request:Request):
    try:return await query(body.name,body.arguments,request.state.client)
    except (ValueError,RuntimeError):raise
    except Exception as exc:raise HTTPException(502,f'Data service unavailable ({type(exc).__name__}); check service health') from exc

@app.get('/api/agent-center/docs/{ident}')
def docs(ident:str):
    if ident not in DOCS:raise KeyError('Unknown document')
    return dict(id=ident,content=(store.ROOT/DOCS[ident]).read_text(encoding='utf-8'))

@app.get('/api/agent-center/skills')
def list_skills():return store.skills()
class Skill(Body):
    content:str=Field(min_length=20,max_length=30_000)
    revision:int=Field(ge=0)
@app.post('/api/agent-center/skills/{ident}')
def save_skill(ident:str,body:Skill,request:Request):
    if request.state.client!='dashboard':raise HTTPException(403,'Skill editing belongs to the dashboard')
    if not re.fullmatch(r'[a-z][a-z0-9-]{2,59}',ident):raise ValueError('Use a lowercase skill name with hyphens (3–60 characters)')
    return store.save_skill(ident,body.content,body.revision)

@app.get('/api/agent-center/bundle/{client}')
def bundle(client:str):
    profile=next((p for p in profiles() if p['id']==client),None)
    if not profile:raise KeyError('Unknown client')
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('config-examples/'+profile['filename'],profile['content'])
        prefix='.claude/skills' if client=='claude' else '.agents/skills'
        for skill in store.skills():archive.writestr(f'{prefix}/{skill["id"]}/SKILL.md',skill['content'])
        for ident,path in DOCS.items():archive.writestr(f'references/{ident}.md',(store.ROOT/path).read_text(encoding='utf-8'))
        archive.writestr('README.md',f'# VRP Agent Center / {client}\n\nStart start_dashboard.cmd. Merge config-examples/{profile["filename"]} into {profile["location"]}. Preserve existing entries. Paths point to this machine; update command/args if moving the project. Copy {prefix} into the workspace where your client runs. Reload MCP in the client, then ask it to call dashboard_overview. Skills can also be read directly through MCP. This bundle contains no credentials and does not install or start an AI model.\n\nFor jobs, ask your agent: list the VRP jobs, claim my chosen job, read its prompt and skill snapshot, publish progress, and finish with evidence.\n')
    return Response(buf.getvalue(),media_type='application/zip',headers={'Content-Disposition':f'attachment; filename="vrp-{client}-integration.zip"'})

@app.get('/api/agent-center/jobs')
def jobs():return store.list_jobs()
@app.get('/api/agent-center/jobs/{ident}')
def job(ident:str):return store.get_job(ident)
class NewJob(Body):
    title:str=Field(min_length=3,max_length=120)
    prompt:str=Field(min_length=10,max_length=16_000)
    target:Literal['any','codex','claude','antigravity','generic']='any'
    skill:str=Field(default='',max_length=60)
@app.post('/api/agent-center/jobs')
def new_job(body:NewJob,request:Request):
    if request.state.client!='dashboard':raise HTTPException(403,'Create jobs from the dashboard')
    return store.create_job(**body.model_dump())
@app.post('/api/agent-center/jobs/{ident}/claim')
def claim(ident:str,request:Request):
    if request.state.client=='dashboard':raise HTTPException(403,'An external agent claims the task through MCP')
    return store.claim_job(ident,request.state.client)
class UpdateJob(Body):
    lease_token:str=Field(min_length=20,max_length=100)
    status:Literal['running','completed','failed']
    message:str=Field(min_length=1,max_length=30_000)
@app.post('/api/agent-center/jobs/{ident}/update')
def update(ident:str,body:UpdateJob,request:Request):return store.update_job(ident,body.lease_token,request.state.client,body.status,body.message)
@app.post('/api/agent-center/jobs/{ident}/cancel')
def cancel(ident:str,request:Request):
    if request.state.client!='dashboard':raise HTTPException(403,'Cancel from the dashboard')
    return store.cancel_job(ident)
