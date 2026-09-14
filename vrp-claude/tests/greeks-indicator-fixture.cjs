module.exports = function fixture() {
  const now = Math.floor(Date.now() / 3600000) * 3600;
  const bars = Array.from({ length: 60 }, (_, i) => ({ time: now - (59-i)*3600, open: 100, high: 103, low: 97, close: 100+Math.sin(i), volume: 1000 }));
  const snapshot = { ticker:'SPY',timestamp:new Date().toISOString(),spot:100,data_source:'live',total_net_gex:2,total_gross_gex:10,total_net_vanna:10,total_net_charm:-2,total_net_dai:12,total_net_vex:15,gex_regime:'positive',gamma_flip:99,signals:{},by_expiry:{} };
  const chain = [2,10].flatMap(dte=>[95,100,105].flatMap(strike=>['call','put'].map(option_type=>({expiry:new Date(Date.now()+dte*86400000).toISOString().slice(0,10),dte,strike,option_type,oi:option_type==='call'?100:120,volume:300,mid_price:2,iv:.3,delta:option_type==='call'?.5:-.5,gamma:.02,theta:-.1,vega:.2,rho:.01,vanna:.01,charm:-.02,gex_spotgamma:option_type==='call'?(strike===105?4:1):(strike===95?-4:-1),gex_raw:1,vanna_exp:10,charm_exp:-2,delta_exp:1,vega_exp:2,bucket:String(dte)}))));
  const history = bars.slice(0,-1).map((b,i)=>({...snapshot,timestamp:new Date((b.time+10)*1000).toISOString(),time:b.time+10,total_net_gex:(i-20)/100,total_net_dai:i*i,total_net_vex:i*3,total_net_vanna:i+1,total_net_charm:2-i}));
  return { bars, data:{snapshot,chain,history,oi_changes:[],meta:{ticker:'SPY',source:'live',observed_at:Date.now()/1000,snapshot_time:Date.now()/1000,contract_size:100,replay:false,cutoff:Date.now()/1000}} };
};
