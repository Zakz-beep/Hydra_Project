"""Local integration state, bounded skills and atomic leased research jobs."""
import json
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / 'python/data/agent_hub.db'
TOKEN = ROOT / 'python/data/agent_hub.key'
SKILLS = ROOT / 'integrations/skills'

def token():
    TOKEN.parent.mkdir(parents=True,exist_ok=True)
    try:
        with TOKEN.open('x',encoding='utf-8') as out: out.write(secrets.token_urlsafe(40))
    except FileExistsError: pass
    return TOKEN.read_text(encoding='utf-8').strip()

@contextmanager
def connection():
    DB.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(DB,timeout=15); db.row_factory=sqlite3.Row
    db.executescript('''
    CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY, content TEXT, revision INTEGER, updated REAL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, title TEXT, prompt TEXT, target TEXT, skill TEXT, skill_content TEXT,
      status TEXT, owner TEXT, lease TEXT, lease_until REAL, created REAL, updated REAL, result TEXT);
    CREATE TABLE IF NOT EXISTS job_events(id INTEGER PRIMARY KEY, job_id TEXT, at REAL, status TEXT, message TEXT);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at REAL, client TEXT, tool TEXT, ok INTEGER, duration REAL);
    CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY, name TEXT, last_seen REAL);
    ''')
    try:
        with db: yield db
    finally: db.close()

def validate_skill(ident, content):
    if not content.startswith('---\n'): raise ValueError('SKILL.md must begin with YAML frontmatter')
    parts=content.split('---',2)
    try: meta=yaml.safe_load(parts[1])
    except yaml.YAMLError as exc: raise ValueError('Invalid skill frontmatter') from exc
    if len(parts)!=3 or not isinstance(meta,dict) or meta.get('name')!=ident or not isinstance(meta.get('description'),str) or not meta['description'].strip():
        raise ValueError('Frontmatter requires matching name and a description')
    return meta

def skills():
    base={p.parent.name:dict(id=p.parent.name,content=p.read_text(encoding='utf-8'),revision=0,updated=None) for p in SKILLS.glob('*/SKILL.md')}
    with connection() as db:
        for row in db.execute('SELECT * FROM skills'): base[row['id']]=dict(row)
    return [{**r,'description':validate_skill(r['id'],r['content'])['description']} for r in sorted(base.values(),key=lambda r:r['id'])]

def save_skill(ident,content,revision):
    validate_skill(ident,content)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute('SELECT revision FROM skills WHERE id=?',(ident,)).fetchone()
        current=row[0] if row else 0
        if revision!=current: raise RuntimeError('Skill changed in another session; reload before saving')
        db.execute('INSERT OR REPLACE INTO skills VALUES(?,?,?,?)',(ident,content,current+1,time.time()))
    return dict(id=ident,revision=current+1)

def public_job(row):
    if not row: raise KeyError('Job not found')
    r=dict(row);r.pop('lease',None)
    r['lease_expired']=r['status']=='running' and r['lease_until']<time.time()
    return r

def list_jobs():
    with connection() as db:return [public_job(r) for r in db.execute('SELECT * FROM jobs ORDER BY created DESC LIMIT 100')]

def get_job(ident):
    with connection() as db:
        r=public_job(db.execute('SELECT * FROM jobs WHERE id=?',(ident,)).fetchone())
        r['events']=[dict(e) for e in db.execute('SELECT at,status,message FROM job_events WHERE job_id=? ORDER BY id DESC LIMIT 100',(ident,))]
        return r

def create_job(title,prompt,target,skill):
    content=''
    if skill:
        chosen=next((s for s in skills() if s['id']==skill),None)
        if not chosen: raise ValueError('Unknown skill')
        content=chosen['content']
    ident=str(uuid.uuid4());stamp=time.time()
    with connection() as db:
        db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(ident,title,prompt,target,skill,content,'queued',None,None,0,stamp,stamp,''))
        db.execute('INSERT INTO job_events(job_id,at,status,message) VALUES(?,?,?,?)',(ident,stamp,'queued','Created in dashboard'))
    return get_job(ident)

def claim_job(ident,client):
    stamp=time.time();lease=secrets.token_urlsafe(32)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        r=db.execute('SELECT * FROM jobs WHERE id=?',(ident,)).fetchone()
        if not r: raise KeyError('Job not found')
        if r['target'] not in ('any',client): raise RuntimeError('Job targets a different client profile')
        if r['status']!='queued' and not (r['status']=='running' and r['lease_until']<stamp): raise RuntimeError('Job is already owned or closed')
        db.execute("UPDATE jobs SET status='running',owner=?,lease=?,lease_until=?,updated=? WHERE id=?",(client,lease,stamp+1800,stamp,ident))
        db.execute('INSERT INTO job_events(job_id,at,status,message) VALUES(?,?,?,?)',(ident,stamp,'running',f'Claimed by {client}'))
    return {**get_job(ident),'lease_token':lease}

def update_job(ident,lease,client,status,message):
    stamp=time.time()
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        r=db.execute('SELECT * FROM jobs WHERE id=?',(ident,)).fetchone()
        if not r: raise KeyError('Job not found')
        if r['status']!='running' or r['owner']!=client or r['lease_until']<stamp or not secrets.compare_digest(r['lease'] or '',lease):
            raise RuntimeError('Valid active job lease required; re-claim expired jobs')
        db.execute('UPDATE jobs SET status=?,result=?,lease_until=?,updated=? WHERE id=?',(status,message if status!='running' else r['result'],stamp+1800,stamp,ident))
        db.execute('INSERT INTO job_events(job_id,at,status,message) VALUES(?,?,?,?)',(ident,stamp,status,message))
    return get_job(ident)

def cancel_job(ident):
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        r=db.execute('SELECT status FROM jobs WHERE id=?',(ident,)).fetchone()
        if not r:raise KeyError('Job not found')
        if r['status'] not in ('queued','running'): raise RuntimeError('Job is already closed')
        stamp=time.time();db.execute("UPDATE jobs SET status='cancelled',lease=NULL,updated=? WHERE id=?",(stamp,ident))
        db.execute('INSERT INTO job_events(job_id,at,status,message) VALUES(?,?,?,?)',(ident,stamp,'cancelled','Cancelled from dashboard; external agent should stop on its next check'))
    return get_job(ident)
