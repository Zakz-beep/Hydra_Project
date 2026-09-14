const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 const stamp='2026-09-11T08:00:00Z',release='2026-08-10T12:30:00Z';
 const ret=(v)=>({value:v,reason:v==null?'Harga horizon tidak tersedia / pasar tutup':null,sampled_at:'2026-08-10T13:30:00Z',lag_seconds:0});
 const row={id:'one',title:'Core CPI fixture',date:release,precision:'time',source:'Provider',url:'https://example.com/release',actual:'0.3%',forecast:'0.2%',series_key:'Provider|Core CPI fixture|percent',score:1.2,surprise:.1,classification:'Above expectations',status:'Scored',label:'Reversal turun',baseline:{price:100,sampled_at:release,lag_seconds:0},reaction_status:'Actual tersedia di sumber',returns:{5:ret(.3),30:ret(-.1),60:ret(-.4),1440:ret(null)},overlaps:[{id:'other',title:'Headline CPI fixture',date:release,source:'Provider'}]};
 const row2={...row,id:'two',title:'Old date-only release',date:'2020-01-01',precision:'date',score:null,baseline:null,classification:'Unscored',status:'Release time unknown',label:'Belum dinilai',returns:{5:ret(null),30:ret(null),60:ret(null),1440:ret(null)},overlaps:[]};
 let fail=false,stale=false;
 await page.route('**/api/**',r=>r.fulfill({status:503,json:{detail:'Unrelated service unavailable'}}));
 await page.route('**/api/macro/**',r=>{const u=new URL(r.request().url());requests.push(u);
  if(u.pathname.endsWith('/dashboard'))return r.fulfill({json:{events:[],news:[],sources:[],generated_at:stamp}});
  if(fail)return r.fulfill({status:502,json:{detail:'Reaction fixture offline'}});
  const selected=u.searchParams.get('event_id')==='two'?row2:row;
  return r.fulfill({json:{symbol:u.searchParams.get('symbol'),series:[row.series_key],rows:u.searchParams.get('surprise')==='below'?[]:[row,row2],selected_id:selected.id,horizon:Number(u.searchParams.get('horizon')),band:Number(u.searchParams.get('band')),generated_at:stamp,
   summary:{n:5,median:.2,small:1,posterior:{mean:4/7,lower:.3,upper:.8,positive:3}},
   path:selected.id==='two'?[]:[{minute:-5,time:release,value:-.1,price:99.9},{minute:0,time:release,value:0,price:100},{minute:5,time:release,value:.3,price:100.3},{minute:60,time:release,value:-.4,price:99.6}],
   price_source:{provider:'Yahoo Finance / yfinance',interval:'5m',fetched_at:stamp,first_bar:release,last_bar:stamp,stale,error:stale?'Source fixture offline':null}}});
 });
 await page.goto('http://127.0.0.1:3000/?view=macro',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Event Reaction',exact:true}).click();
 const panel=page.getByRole('region',{name:'Macro Event Reaction'});
 await panel.getByRole('heading',{name:'Event replay · SPY'}).waitFor();
 assert.equal(await panel.locator('tbody tr').count(),2);
 await panel.getByRole('button',{name:'Old date-only release',exact:true}).click();
 await panel.getByText(/Replay belum tersedia/).waitFor();
 await panel.getByRole('button',{name:'Core CPI fixture',exact:true}).click();
 await panel.getByRole('heading',{name:'Core CPI fixture',exact:true}).waitFor();
 await panel.locator('summary').filter({hasText:'source records lain'}).click();await panel.getByText(/Headline CPI fixture/).waitFor();
 await page.getByLabel('Aset reaksi').selectOption('BTC-USD');await panel.getByRole('heading',{name:'Event replay · BTC-USD'}).waitFor();
 await page.getByLabel('Horizon reaksi').selectOption('1440');
 await page.getByLabel('Batas reaksi kecil').selectOption('0.25');
 await page.getByLabel('Seri dan sumber rilis').selectOption(row.series_key);
 await page.getByLabel('Surprise konsensus').selectOption('below');await panel.getByText(/Belum ada rilis yang cocok/).waitFor();
 await page.getByLabel('Surprise konsensus').selectOption('all');await panel.locator('tbody tr').first().waitFor();
 await page.getByLabel('Cari histori reaksi').fill('no-match');await panel.getByText('Tidak ada histori yang cocok dengan pencarian.').waitFor();await page.getByLabel('Cari histori reaksi').fill('');
 const download=page.waitForEvent('download');await panel.getByRole('button',{name:'Export reaksi CSV'}).click();const file=await download;
 assert.match(fs.readFileSync(await file.path(),'utf8'),/return_1440m_pct/);
 stale=true;await panel.getByRole('button',{name:'Refresh harga',exact:true}).click();await panel.getByText('Source fixture offline').waitFor();
 stale=false;fail=true;await page.getByLabel('Aset reaksi').selectOption('QQQ');await panel.getByText('Reaction fixture offline').waitFor();fail=false;await panel.getByRole('button',{name:'Coba reaksi lagi'}).click();await panel.getByRole('heading',{name:'Event replay · QQQ'}).waitFor();
 assert.ok(requests.some(u=>u.searchParams.get('horizon')==='1440'&&u.searchParams.get('band')==='0.25'));
 assert.ok(requests.some(u=>u.searchParams.get('series_filter')===row.series_key));assert.ok(requests.some(u=>u.searchParams.get('refresh')==='true'));
 const out=path.join(__dirname,'../../.ua/macro');fs.mkdirSync(out,{recursive:true});
 for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow at ${width}`);await page.screenshot({path:path.join(out,`reaction-${width}.png`),fullPage:true});}
 assert.deepEqual(errors,[]);console.log('PASS event reaction replay, assets, filters, missing data, source errors, CSV and responsive layouts');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
