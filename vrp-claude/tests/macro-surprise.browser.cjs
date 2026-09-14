const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 const base={date:'2025-01-01T13:30:00Z',source:'Test source',actual:'.4%',forecast:'.2%',surprise:.2,surprise_unit:'pp',history_n:24,history_mean:.01,history_sd:.1,provenance:'Test fixture only',captured_at:'2025-01-01T14:00:00Z',url:'https://example.com/release'};
 const rows=[{...base,id:'above',title:'Core CPI m/m',score:2,centered_z:1.9,classification:'Above expectations',magnitude:'Extreme',status:'Scored'},{...base,id:'neutral',title:'CPI m/m',actual:'.2%',score:0,centered_z:-.1,surprise:0,classification:'Neutral',magnitude:'Neutral',status:'Scored'},{...base,id:'below',title:'Nonfarm payrolls',actual:'150K',forecast:'300K',surprise:-150000,surprise_unit:'count',history_sd:100000,score:-1.5,centered_z:-1.6,classification:'Below expectations',magnitude:'Large',status:'Scored'},{...base,id:'missing',title:'Core PCE m/m',actual:null,surprise:null,score:null,centered_z:null,classification:'Unscored',magnitude:null,status:'Missing actual / consensus',history_n:0}];
 let fail=false,previewed=false,saved=false;
 await page.route('**/api/**',r=>r.fulfill({status:503,json:{detail:'Unrelated macro collection offline'}}));
 await page.route('**/api/macro/surprises**',r=>{
  if(r.request().method()==='POST'){const body=r.request().postDataJSON();assert.match(body.csv_text,/series,date,actual/);if(body.save){assert.ok(previewed);saved=true}else previewed=true;return r.fulfill({json:{count:13,saved:body.save,preview:[{title:'Core CPI m/m',date:base.date,actual:'.4',forecast:'.2',unit:'percent'}]}})}
  if(fail)return r.fulfill({status:502,json:{detail:'Score service fixture offline'}});
  return r.fulfill({json:{rows,paired:3,scored:3,min_history:12,vintage:'Fixture'}});
 });
 await page.goto('http://127.0.0.1:3000/?view=macro',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Surprise Monitor',exact:true}).click();await page.getByRole('heading',{name:'Surprise Monitor',exact:true}).waitFor();
 await page.getByRole('button',{name:'Core CPI m/m',exact:true}).click();await page.getByText('Bias-adjusted Z',{exact:true}).waitFor();assert.match(await page.locator('aside').last().innerText(),/1.90/);await page.getByRole('button',{name:'Close diagnostics'}).click();
 await page.getByLabel('Score filter').selectOption('Neutral');assert.equal(await page.locator('tbody tr').count(),1);assert.match(await page.locator('tbody').innerText(),/CPI m\/m/);
 await page.getByLabel('Score filter').selectOption('All');await page.getByLabel('Surprise lookback').selectOption('24');await page.getByLabel('Neutral band').selectOption('1');assert.ok(requests.some(u=>u.includes('window=24')));
 await page.getByLabel('Search surprise releases').fill('PCE');assert.match(await page.locator('tbody').innerText(),/Unscored/);assert.doesNotMatch(await page.locator('tbody').innerText(),/Neutral/);await page.getByLabel('Search surprise releases').fill('');
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Export scores'}).click();assert.equal((await dl).suggestedFilename(),'usd-surprise-scores.csv');
 fail=true;await page.getByRole('button',{name:'Refresh scores'}).click();await page.getByText('Score service fixture offline',{exact:false}).waitFor();fail=false;await page.getByRole('button',{name:'Retry scores'}).click();await page.getByRole('button',{name:'Core CPI m/m',exact:true}).waitFor();
 await page.getByText('Import actual / consensus history',{exact:true}).click();await page.getByLabel('History CSV file').setInputFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from('series,date,actual,forecast,unit,source_url\nCore CPI m/m,2025-01-01T13:30:00Z,.4,.2,percent,https://example.com\n')});
 assert.equal(await page.getByRole('button',{name:'Save imported releases'}).isDisabled(),true);await page.getByRole('button',{name:'Preview CSV'}).click();await page.getByRole('button',{name:'Save imported releases'}).click();await page.getByText(/13 released observations saved/).waitFor();assert.ok(saved);
 await page.getByText('Import actual / consensus history',{exact:true}).click();
 for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1050});await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width}`)}
 await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(200);
 await page.screenshot({path:path.join(__dirname,'../../.ua/macro/surprise-fixture.png'),fullPage:true});assert.deepEqual(errors,[]);console.log('PASS surprise labels, controls, missing data, diagnostics, CSV preview/save, errors and responsive layouts');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
