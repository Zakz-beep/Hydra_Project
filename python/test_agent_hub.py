import asyncio
import io
import tempfile
import time
import tomllib
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
import agent_hub_store as store
import agent_hub_tools as tools
from agent_hub_api import app,profiles

class HubTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        for key,name in [('DB','hub.db'),('TOKEN','hub.key')]:
            p=patch.object(store,key,Path(self.tmp.name)/name);p.start();self.addCleanup(p.stop)
        self.headers={'Authorization':'Bearer '+store.token()}
        self.client=TestClient(app)

    def test_auth_and_profiles_have_no_credential(self):
        self.assertEqual(self.client.get('/api/agent-center/jobs').status_code,401)
        self.assertEqual(self.client.get('/api/agent-center/jobs',headers=self.headers).status_code,200)
        for p in profiles():
            self.assertNotIn(store.token(),p['content'])
            if p['id']=='codex':self.assertIn('vrp-dashboard',tomllib.loads(p['content'])['mcp_servers'])

    def test_schema_blocks_arbitrary_hosts_and_unknown_arguments(self):
        with self.assertRaises(ValueError):asyncio.run(tools.query('shell',{}))
        with self.assertRaises(ValueError):asyncio.run(tools.query('macro_calendar',{'url':'https://example.com'}))
        with self.assertRaises(ValueError):asyncio.run(tools.query('greeks_summary',{'ticker':'../secrets'}))
        with self.assertRaises(ValueError):asyncio.run(tools.query('market_bars',{'provider':'other'}))

    def test_skill_edit_revision_and_job_snapshot(self):
        skill=store.skills()[0];job=store.create_job('Research example','Use source evidence in this research','any',skill['id'])
        changed=skill['content']+'\nAdditional instruction.\n'
        store.save_skill(skill['id'],changed,0)
        self.assertEqual(store.get_job(job['id'])['skill_content'],skill['content'])
        with self.assertRaises(RuntimeError):store.save_skill(skill['id'],changed,0)
        with self.assertRaises(ValueError):store.validate_skill('wrong',changed)
        with self.assertRaises(ValueError):store.validate_skill('bad','---\n!!python/object/apply:os.system [whoami]\n---')

    def test_claim_conflicts_targets_and_private_lease(self):
        job=store.create_job('Research example','Research this macro event','codex','')
        with self.assertRaises(RuntimeError):store.claim_job(job['id'],'claude')
        claim=store.claim_job(job['id'],'codex')
        with self.assertRaises(RuntimeError):store.claim_job(job['id'],'codex')
        self.assertNotIn('lease',store.get_job(job['id']))
        self.assertNotIn(claim['lease_token'],str(store.list_jobs()))
        with self.assertRaises(RuntimeError):store.update_job(job['id'],'wrong','codex','completed','result')
        result=store.update_job(job['id'],claim['lease_token'],'codex','completed','Evidence-backed result')
        self.assertEqual(result['status'],'completed');self.assertEqual(result['result'],'Evidence-backed result')

    def test_expiry_reclaim_and_cancel(self):
        job=store.create_job('Research example','Research this macro event','any','');claim=store.claim_job(job['id'],'generic')
        with store.connection() as db:db.execute('UPDATE jobs SET lease_until=? WHERE id=?',(time.time()-1,job['id']))
        self.assertTrue(store.get_job(job['id'])['lease_expired'])
        newer=store.claim_job(job['id'],'codex')
        with self.assertRaises(RuntimeError):store.update_job(job['id'],claim['lease_token'],'generic','running','Old update')
        store.cancel_job(job['id'])
        with self.assertRaises(RuntimeError):store.update_job(job['id'],newer['lease_token'],'codex','completed','Late result')

    def test_bundle_is_portable_and_bounded(self):
        response=self.client.get('/api/agent-center/bundle/claude',headers=self.headers)
        self.assertEqual(response.status_code,200)
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            self.assertIn('.claude/skills/vrp-job-worker/SKILL.md',z.namelist())
            self.assertIn('references/integration.md',z.namelist())
            for name in z.namelist():self.assertNotIn(store.token().encode(),z.read(name))
        response=self.client.post('/api/agent-center/skills/bad.name',headers=self.headers,json={'content':'x'*40,'revision':0})
        self.assertEqual(response.status_code,422)

    def test_http_job_roundtrip(self):
        job=self.client.post('/api/agent-center/jobs',headers=self.headers,json=dict(title='Research task',prompt='Analyze sourced evidence',target='any',skill='')).json()
        agent={**self.headers,'X-Agent-Client':'codex'}
        claim=self.client.post(f'/api/agent-center/jobs/{job["id"]}/claim',headers=agent,json={}).json()
        result=self.client.post(f'/api/agent-center/jobs/{job["id"]}/update',headers=agent,json=dict(lease_token=claim['lease_token'],status='running',message='Read sources'))
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json()['events'][0]['message'],'Read sources')
        self.assertEqual(self.client.post('/api/agent-center/jobs',headers=agent,json=dict(title='Research task',prompt='Analyze sourced evidence')).status_code,403)

if __name__=='__main__':unittest.main()
