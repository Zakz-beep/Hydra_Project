const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
 const stamp=Date.now()/1000,skill={id:'vrp-job-worker',content:'---\nname: vrp-job-worker\ndescription: Test worker workflow.\n---\nRead source evidence.',revision:0,description:'Test worker workflow.'};
 const data={tools:[{name:'macro_calendar',description:'Read macro data',example:{},inputSchema:{type:'object'},access:'read',service_port:8015}],skills:[skill],jobs:[],clients:[],audit:[],services:[{name:'agenthub',port:8016,ready:true},{name:'macro',port:8015,ready:false}],profiles:['codex','claude','antigravity','generic'].map(id=>({id,content:`fixture config for ${id}`,location:'Client project configuration',filename:`${id}.json`,transport:'stdio'}))};
 let offline=false;
 await page.route('**/api/**',r=>r.fulfill({status:503,json:{detail:'Unrelated service unavailable'}}));
 await page.route('**/api/agent-center/**',r=>{const u=new URL(r.request().url()),body=r.request().postDataJSON();calls.push({path:u.pathname,body});
  if(u.pathname.endsWith('/overview'))return r.fulfill({status:offline?503:200,json:offline?{detail:'Agent Center fixture offline'}:data});
  if(u.pathname.includes('/bundle/'))return r.fulfill({body:'fixture bundle download',headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="vrp-test.zip"'}});
  if(u.pathname.endsWith('/tools/call'))return r.fulfill({json:{tool:body.name,data:{source:'fixture',actual:null}}});
  if(u.pathname.includes('/skills/')){skill.content=body.content;skill.revision++;return r.fulfill({json:{id:skill.id,revision:skill.revision}});}
  if(u.pathname.endsWith('/jobs')&&body){const j={id:'test-job',...body,status:'queued',owner:null,lease_expired:false,created:stamp,updated:stamp,skill_content:skill.content,result:'',events:[]};data.jobs=[j];return r.fulfill({json:j});}
  if(u.pathname.endsWith('/cancel')){data.jobs[0].status='cancelled';data.jobs[0].updated++;return r.fulfill({json:data.jobs[0]});}
  if(u.pathname.includes('/jobs/'))return r.fulfill({json:data.jobs[0]});
  return r.fulfill({json:{}});
 });
 await page.goto('http://127.0.0.1:3000/?view=agent-center',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Konfigurasi yang siap dipakai'}).waitFor();
 assert.equal(await page.getByRole('combobox',{name:'Terminal command'}).inputValue(),'AGT');
 await page.getByRole('button',{name:'antigravity',exact:true}).click();assert.match(await page.getByLabel('Konfigurasi MCP').inputValue(),/antigravity/);
 let download=page.waitForEvent('download');await page.getByRole('button',{name:'Download config',exact:true}).click();assert.equal((await download).suggestedFilename(),'antigravity.json');
 download=page.waitForEvent('download');await page.getByRole('link',{name:'Download bundle ZIP'}).click();assert.match((await download).suggestedFilename(),/^vrp-.*\.zip$/);
 await page.getByRole('button',{name:'Tool explorer',exact:true}).click();await page.getByLabel('Arguments JSON').fill('{');await page.getByRole('button',{name:'Jalankan query'}).click();await page.getByRole('status').filter({hasText:'SyntaxError'}).waitFor();
 await page.getByLabel('Arguments JSON').fill('{}');await page.getByRole('button',{name:'Jalankan query'}).click();await page.getByRole('status').filter({hasText:'"actual": null'}).waitFor();
 await page.getByRole('button',{name:'Skills',exact:true}).click();await page.getByLabel('Instruksi SKILL.md').fill(skill.content+'\nNew research step.');await page.getByRole('button',{name:'Simpan skill'}).click();await page.getByText(/Skill tersimpan/).waitFor();assert.equal(skill.revision,1);
 await page.getByRole('button',{name:'Tasks & results',exact:true}).click();await page.getByLabel('Judul tugas').fill('Research demo');await page.getByLabel('Instruksi tugas').fill('Analyze source evidence and report limitations.');await page.getByLabel('Target agent').selectOption('codex');await page.getByRole('button',{name:'Buat tugas',exact:true}).click();await page.getByRole('heading',{name:'Research demo',exact:true}).waitFor();
 assert.equal(data.jobs[0].target,'codex');assert.match(data.jobs[0].skill_content,/New research step/);
 data.jobs[0].status='completed';data.jobs[0].owner='codex';data.jobs[0].result='Verified result from external agent';data.jobs[0].updated++;
 await page.getByRole('button',{name:'Refresh Agent Center'}).click();await page.getByText('Verified result from external agent',{exact:true}).waitFor();
 download=page.waitForEvent('download');await page.getByRole('button',{name:'Download hasil'}).click();assert.equal((await download).suggestedFilename(),'test-job.md');
 await page.getByRole('button',{name:'Activity',exact:true}).click();await page.getByText(/Belum ada permintaan dari client MCP/).waitFor();
 offline=true;await page.getByRole('button',{name:'Refresh Agent Center'}).click();await page.getByRole('alert').filter({hasText:'Agent Center fixture offline'}).waitFor();offline=false;await page.getByRole('button',{name:'Coba koneksi lagi'}).click();await page.waitForFunction(()=>!document.body.innerText.includes('Agent Center fixture offline'));
 await page.getByRole('button',{name:'Connections',exact:true}).click();
 const out=path.join(__dirname,'../../.ua/agent-center');fs.mkdirSync(out,{recursive:true});
 for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow at ${width}`);await page.screenshot({path:path.join(out,`connections-${width}.png`),fullPage:true});}
 assert.deepEqual(errors,[]);assert.ok(calls.some(c=>c.path.endsWith('/tools/call')));console.log('PASS Agent Center profiles, downloads, query validation, skills, task/result workflow, errors and responsive layouts');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
