const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,f);
const {modelLabel,defaultUsdDirection}=require('../app/components/macro/modelSurprise.ts');
test('USD scenario handles labor inversion and shock thresholds',()=>{
 assert.equal(defaultUsdDirection('claims'),-1);assert.equal(defaultUsdDirection('unemployment'),-1);assert.equal(defaultUsdDirection('payrolls'),1);
 assert.equal(modelLabel(2,1,.5,2).label,'Bullish shock USD');assert.equal(modelLabel(2,-1,.5,2).label,'Bearish shock USD');
 assert.equal(modelLabel(-2,-1,.5,2).label,'Bullish shock USD');assert.equal(modelLabel(.8,1,.5,2).label,'Bullish USD');
 assert.equal(modelLabel(-.8,1,.5,2).label,'Bearish USD');
});
test('Neutral is inclusive and missing uncertainty remains unscored',()=>{
 for(const z of [0,.5,-.5])assert.equal(modelLabel(z,1,.5,2).label,'Netral');
 for(const z of [null,undefined,NaN,Infinity])assert.equal(modelLabel(z,1,.5,2).label,'Belum dinilai');
 assert.equal(modelLabel(1,-1,1,2).label,'Netral');
});
