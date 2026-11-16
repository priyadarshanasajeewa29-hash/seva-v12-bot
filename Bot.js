// Seva V12 - HTML Brain එකම - Node.js Version
// EMA + Sweep + FVG + POC + ATR SL + Funding Filter

const COINS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','LINKUSDT','AVAXUSDT'];
const TF = '1h';
const MIN_SCORE = 72;

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

async function fetchKlines(sym, intv, limit=250){
  let qs = `symbol=${sym}&interval=${intv}&limit=${limit}`;
  let r = await fetch(`https://fapi.binance.com/fapi/v1/klines?${qs}`);
  if(r.ok) return await r.json();
  let r2 = await fetch(`https://api.binance.com/api/v3/klines?${qs}`);
  return await r2.json();
}
async function fetchFunding(sym){
  try{
    let r = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`);
    let j = await r.json();
    return parseFloat(j.lastFundingRate || 0);
  }catch(e){ return 0; }
}
function calcEMA(arr, period){
  if(!arr.length) return 0;
  if(arr.length < period) return arr.reduce((a,b)=>a+b,0)/arr.length;
  let k = 2/(period+1);
  let ema = arr.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=period;i<arr.length;i++) ema = arr[i]*k + ema*(1-k);
  return ema;
}
function calcRSI(closes, period=14){
  if(closes.length <= period) return 50;
  let g=0,l=0;
  for(let i=1;i<=period;i++){ let d=closes[i]-closes[i-1]; if(d>0) g+=d; else l+=-d; }
  g/=period; l/=period;
  for(let i=period+1;i<closes.length;i++){ let d=closes[i]-closes[i-1]; g=(g*(period-1)+(d>0?d:0))/period; l=(l*(period-1)+(d<0?-d:0))/period; }
  if(l===0) return 100;
  return 100-(100/(1+g/l));
}
function calcATR(highs,lows,closes,period=14){
  let trs=[];
  for(let i=1;i<closes.length;i++) trs.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
  let atr = trs.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=period;i<trs.length;i++) atr=(atr*(period-1)+trs[i])/period;
  return atr;
}
function calcPOC(highs,lows,closes,vols,bins=12){
  let hi=Math.max(...highs), lo=Math.min(...lows);
  let step=(hi-lo)/bins; if(step<=0) return closes[closes.length-1];
  let buckets=new Array(bins).fill(0);
  for(let i=0;i<closes.length;i++){ let mid=(highs[i]+lows[i]+closes[i])/3; let idx=Math.min(bins-1,Math.max(0,Math.floor((mid-lo)/step))); buckets[idx]+=vols[i]; }
  let maxIdx=0; for(let b=1;b<bins;b++) if(buckets[b]>buckets[maxIdx]) maxIdx=b;
  return lo+(maxIdx+0.5)*step;
}

async function sendTelegram(msg){
  if(!TOKEN || !CHAT_ID){ console.log("No Telegram Config"); return; }
  let url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode:'HTML' }) });
}

// Seva V12 Brain - HTML එකේ institutionalBrain() එකම
async function brain(coin, btcTrend, btcShock){
  let [kMain, k4h, k15m, kDaily, funding] = await Promise.all([
    fetchKlines(coin, TF, 250),
    fetchKlines(coin, '4h', 100),
    fetchKlines(coin, '15m', 100),
    fetchKlines(coin, '1d', 60),
    fetchFunding(coin)
  ]);
  let livePrice = parseFloat(kMain[kMain.length-1][4]);
  let closed = kMain.slice(0,-1);
  let opens = closed.map(k=>parseFloat(k[1]));
  let highs = closed.map(k=>parseFloat(k[2]));
  let lows = closed.map(k=>parseFloat(k[3]));
  let closes = closed.map(k=>parseFloat(k[4]));
  let vols = closed.map(k=>parseFloat(k[5]));
  let n = closes.length;
  let cLast=closes[n-1], oLast=opens[n-1], hLast=highs[n-1], lLast=lows[n-1];

  let ema20=calcEMA(closes,20), ema50=calcEMA(closes,50), ema200=calcEMA(closes,200);
  let emaLong=(ema20>ema50?10:0)+(ema50>ema200?10:0);
  let emaShort=(ema20<ema50?10:0)+(ema50<ema200?10:0);
  let rsi=calcRSI(closes,14);
  let atr=calcATR(highs,lows,closes,14) || livePrice*0.005;

  let swingLow20=Math.min(...lows.slice(-22,-2));
  let swingHigh20=Math.max(...highs.slice(-22,-2));
  let sweepLong=(lLast<swingLow20 && cLast>swingLow20 && cLast>oLast);
  let sweepShort=(hLast>swingHigh20 && cLast<swingHigh20 && cLast<oLast);

  let fvgLong=false, fvgShort=false;
  for(let i=n-15;i<n-2;i++){
    if(lows[i+1]>highs[i-1]){ let gb=highs[i-1], gt=lows[i+1]; if(!closes.slice(i+2).some(c=>c<gb) && livePrice>=gb*0.995 && livePrice<=gt*1.015) fvgLong=true; }
    if(highs[i+1]<lows[i-1]){ let gt=lows[i-1], gb=highs[i+1]; if(!closes.slice(i+2).some(c=>c>gt) && livePrice<=gt*1.005 && livePrice>=gb*0.985) fvgShort=true; }
  }

  let avgBody=closes.slice(-20).reduce((a,c,idx)=>a+Math.abs(c-opens[n-20+idx]),0)/20;
  let obLong=false, obShort=false;
  for(let i=n-15;i<n-3;i++){
    let bodyNext=Math.abs(closes[i+1]-opens[i+1]);
    if(closes[i]<opens[i] && closes[i+1]>opens[i+1] && bodyNext>avgBody*1.3){ if(livePrice>=lows[i]*0.996 && livePrice<=highs[i]*1.006) obLong=true; }
    if(closes[i]>opens[i] && closes[i+1]<opens[i+1] && bodyNext>avgBody*1.3){ if(livePrice>=lows[i]*0.994 && livePrice<=highs[i]*1.004) obShort=true; }
  }

  let prevSwHigh=Math.max(...highs.slice(-20,-5)), prevSwLow=Math.min(...lows.slice(-20,-5));
  let bosLong=cLast>Math.max(...highs.slice(-11,-1));
  let bosShort=cLast<Math.min(...lows.slice(-11,-1));

  let poc=calcPOC(highs.slice(-30),lows.slice(-30),closes.slice(-30),vols.slice(-30),12);
  let avgVol=vols.slice(-20).reduce((a,b)=>a+b,0)/20;
  let volSpike=vols[n-1]>avgVol*1.15;
  let pocLong=(cLast>=poc && Math.abs(cLast-poc)/cLast<0.02) && (volSpike || cLast>oLast);
  let pocShort=(cLast<=poc && Math.abs(cLast-poc)/cLast<0.02) && (volSpike || cLast<oLast);

  let c4=k4h.slice(0,-1).map(k=>parseFloat(k[4]));
  let c15=k15m.slice(0,-1).map(k=>parseFloat(k[4]));
  let c1d=kDaily.slice(0,-1).map(k=>parseFloat(k[4]));
  let t4=calcEMA(c4,20)>calcEMA(c4,50)?'UP':'DOWN';
  let t15=calcEMA(c15,20)>calcEMA(c15,50)?'UP':'DOWN';
  let t1d=c1d[c1d.length-1]>calcEMA(c1d,20)?'UP':'DOWN';
  let mtfLong=(t4==='UP'?6:0)+(t15==='UP'?4:0)+(t1d==='UP'?5:0);
  let mtfShort=(t4==='DOWN'?6:0)+(t15==='DOWN'?4:0)+(t1d==='DOWN'?5:0);

  let hourUTC=new Date().getUTCHours();
  let killzone=(hourUTC>=7 && hourUTC<=10)||(hourUTC>=12 && hourUTC<=15);
  let rsiSweet=(rsi>=35 && rsi<=65);

  let longScore=emaLong+(sweepLong?15:0)+(fvgLong?10:0)+(obLong?10:0)+(bosLong?15:0)+(pocLong?15:0)+mtfLong+(killzone?5:0)+(rsiSweet?5:0);
  let shortScore=emaShort+(sweepShort?15:0)+(fvgShort?10:0)+(obShort?10:0)+(bosShort?15:0)+(pocShort?15:0)+mtfShort+(killzone?5:0)+(rsiSweet?5:0);

  let dir=null, score=0;
  if(longScore>=shortScore && longScore>=MIN_SCORE && ema20>=ema50*0.998){ dir='LONG'; score=longScore; }
  else if(shortScore>longScore && shortScore>=MIN_SCORE && ema20<=ema50*1.002){ dir='SHORT'; score=shortScore; }

  let rejects=[];
  let range20=(Math.max(...highs.slice(-20))-Math.min(...lows.slice(-20)))/Math.min(...lows.slice(-20));
  if(range20<0.008) rejects.push('Sideways');
  if((hLast-lLast)>atr*2.8) rejects.push('News Spike');
  if(dir==='LONG' && ((livePrice-ema20)>atr*2.5 || rsi>70)) rejects.push('Chase');
  if(dir==='SHORT' && ((ema20-livePrice)>atr*2.5 || rsi<30)) rejects.push('Chase');
  if(dir==='LONG' && funding>0.0004) rejects.push('Funding Crowded');
  if(dir==='SHORT' && funding<-0.0004) rejects.push('Funding Crowded');
  if(coin!=='BTCUSDT'){
    if(dir==='LONG' && (btcTrend==='DOWN' || btcShock==='DUMP')) rejects.push('BTC Against');
    if(dir==='SHORT' && (btcTrend==='UP' || btcShock==='PUMP')) rejects.push('BTC Against');
  }
  if(!dir) rejects.push(`Score Low L:${longScore} S:${shortScore}`);

  let slDist=Math.max(livePrice*0.005, Math.min(livePrice*0.022, atr*1.5));
  let calcDir=dir || (longScore>=shortScore?'LONG':'SHORT');
  let sl=calcDir==='LONG'?livePrice-slDist:livePrice+slDist;
  let tp1=calcDir==='LONG'?livePrice+slDist*1.3:livePrice-slDist*1.3;
  let tp2=calcDir==='LONG'?livePrice+slDist*2.5:livePrice-slDist*2.5;

  return { coin, pass: dir!==null && rejects.length===0, dir, score, longScore, shortScore, price:livePrice, sl, tp1, tp2, rejects, rsi, funding };
}

async function main(){
  // BTC Trend
  let k1h=await fetchKlines('BTCUSDT','1h',60);
  let c1=Array.isArray(k1h)?k1h.slice(0,-1).map(x=>parseFloat(x[4])):[];
  let btcTrend=calcEMA(c1,20)>calcEMA(c1,50)?'UP':'DOWN';
  let k15=await fetchKlines('BTCUSDT','15m',10);
  let c15=Array.isArray(k15)?k15.map(x=>parseFloat(x[4])):[];
  let move=(c15[c15.length-1]-c15[c15.length-5])/c15[c15.length-5];
  let btcShock=move<-0.015?'DUMP':move>0.015?'PUMP':false;

  for(let coin of COINS){
    try{
      let res=await brain(coin, btcTrend, btcShock);
      console.log(coin, `L:${res.longScore} S:${res.shortScore}`, res.pass?`✅ ${res.dir}`:res.rejects.join(','));
      if(res.pass){
        let pair=coin.replace('USDT','/USDT');
        let fmt=(p)=> p>=1000?p.toFixed(2):p>=1?p.toFixed(4):p.toFixed(5);
        let msg=`🎯 <b>Seva V12 SIGNAL</b>\n\n🪙 <b>${pair} ${res.dir}</b> (1h)\n💰 Entry: <b>$${fmt(res.price)}</b>\n🛑 SL: <b>$${fmt(res.sl)}</b>\n🎯 TP1 (BE): <b>$${fmt(res.tp1)}</b>\n🚀 TP2: <b>$${fmt(res.tp2)}</b>\n📊 Score: <b>${res.score}/100</b> | RSI: ${res.rsi.toFixed(1)}\n🏦 Mode: INSTITUTIONAL • ATR SL`;
        await sendTelegram(msg);
      }
    }catch(e){ console.log(coin, "Error", e.message); }
  }
  console.log("Scan Done");
}
main();
