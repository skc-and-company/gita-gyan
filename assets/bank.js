/* SKC Bank Statement Analyzer — inside Gita Gyan (route #/bank). Statements are read in the browser only:
 * PDF text via PDF.js, Excel / CSV via SheetJS (both in vendor/, loaded when first needed). */
/* Core of SKC & CO.'s Bank Statement Analyzer (runs fully in the browser). Bank layouts call
   SKCBank.register({id,name,priority,detect(text),columns}); add a bank with one more register() call below. */
(function(G){
'use strict';
var MON={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
function pad(n){return(n<10?'0':'')+n}
function parseDate(s){
  if(s==null)return null;if(s instanceof Date&&!isNaN(s))return s.getFullYear()+'-'+pad(s.getMonth()+1)+'-'+pad(s.getDate());
  if(typeof s==='number'&&s>20000&&s<80000){var d=new Date(Math.round((s-25569)*864e5));return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate())}
  s=String(s).trim();var m=s.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2,4})\b/);
  if(m){var y=+m[3];if(y<100)y+=2000;var mo=+m[2],dd=+m[1];if(mo>12||dd>31||mo<1)return null;return y+'-'+pad(mo)+'-'+pad(dd)}
  m=s.match(/^(\d{1,2})[\-\/ ]?([A-Za-z]{3})[A-Za-z]*[\-\/ ,]*(\d{2,4})\b/);
  if(m&&MON[m[2].toLowerCase()]){y=+m[3];if(y<100)y+=2000;return y+'-'+pad(MON[m[2].toLowerCase()])+'-'+pad(+m[1])}
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return m[1]+'-'+m[2]+'-'+m[3];
  return null}
function parseAmt(v){
  if(v==null||v==='')return 0;if(typeof v==='number')return Math.round(v*100)/100;
  var s=String(v).replace(/[₹,\s]|INR|Rs\.?/gi,'');var neg=/^\(.*\)$/.test(s)||/^-/.test(s);var cr=/cr$/i.test(s),dr=/dr$/i.test(s);
  s=s.replace(/[()\-]|cr$|dr$/gi,'');if(!/^\d*\.?\d+$/.test(s))return NaN;var n=Math.round(parseFloat(s)*100)/100;return (neg||dr)?-n:n}
function isAmt(s){s=String(s==null?'':s).trim();if(/^\d{7,}$/.test(s))return false;return s!==''&&/^[(\-]?[₹]?\s*[\d,]+(\.\d{1,2})?\)?\s*(Cr|Dr)?$/i.test(s)}

/* ---------- categorisation ---------- */
var CATS=['Salary','Payroll','Dividend','Interest','Refund','GST','Income tax / TDS','EMI/Loan','Insurance','Investments','Credit card','Utilities','Rent','ATM Cash','Cash deposit','Cheque','UPI','NEFT/RTGS/IMPS','Charges/Fees','Other'];
// [category, pattern, applies to: 'cr' credits only, 'dr' debits only, '' both]. Purpose comes before channel,
// so "UPI/AIRTEL…" is Utilities, not UPI.
var RULES=[
 ['Refund',/\b(REFUND|REVERSAL|REV|RETURN(ED)?|CASHBACK|CHARGEBACK)\b/,'cr'],
 ['GST',/\b(CPIN|CBIC|GSTN|GST ?(PMT|PAYMENT|CHALLAN|DEPOSIT|TAX ?PAYMENT))\b/,'dr'],
 ['Income tax / TDS',/\b(OLTAS|TIN ?NSDL|ITD|INCOME ?TAX|ADVANCE ?TAX|SELF ?ASSESSMENT|TDS ?(PMT|PAYMENT)|CBDT|ITNS ?28[0-1]|CHALLAN ?28[0-1])\b/,'dr'],
 ['Charges/Fees',/\b(CHGS?|CHARGES?|FEE|FEES|GST|SMS ?ALERT|AMC|DEBIT CARD ANNUAL|MIN(IMUM)? ?BAL|PENALTY|CONSOLIDATED CHARGES)\b/,''],
 ['Interest',/\b(INT\.?\s?PD|INT\.?\s?CR|INTEREST|INT PAID|SB INT|CREDIT INTEREST|INT\.COLL)\b/,''],
 ['Dividend',/\b(DIV|DIVIDEND|INT DIV|FINAL DIV|INTERIM DIV)\b|\b(ACH|NACH)\b.*\b(LTD|LIMITED|DIV)\b/,'cr'],
 ['Salary',/\b(SALARY|SAL|PAYROLL|WAGES)\b/,'cr'],
 ['Payroll',/\b(SALARY|SAL|PAYROLL|WAGES|STAFF ?PAY)\b/,'dr'],
 ['EMI/Loan',/\b(EMI|LOAN|LN ?REPAY|HOME ?LOAN|ECS)\b|NACH.*(FINANCE|FIN|BAJAJ|CAPITAL)/,''],
 ['Insurance',/\b(LIC|LICI|INSURANCE|PREMIUM|HDFC ?LIFE|ICICI ?PRU(DENTIAL)?|SBI ?LIFE|STAR ?HEALTH|BAJAJ ?ALLIANZ|NIVA ?BUPA|CARE ?HEALTH)\b/,'dr'],
 ['Investments',/\b(MUTUAL ?FUNDS?|MF|SIP|ZERODHA|GROWW|UPSTOX|ANGEL ?ONE|ICCL|NSCCL|INDIAN ?CLEARING|NSE ?CLEARING|BSE ?LTD|CDSL|PPF|SUKANYA|NPS ?TRUST|RD ?INST(ALMENT)?|FD ?BOOK(ING)?|TERM ?DEPOSIT)\b/,''],
 ['Credit card',/\b(CREDIT ?CARD|CC ?PAYMENT|CC ?BILL|CARD ?BILL|CRED)\b/,'dr'],
 ['Utilities',/\b(ELECTRICITY|NBPDCL|SBPDCL|BSES|TATA ?POWER|ADANI ?ELEC(TRICITY)?|MSEDCL|BESCOM|WATER ?(BILL|TAX)|BROADBAND|AIRTEL|JIO|VODAFONE|BSNL|DTH|TATA ?PLAY|IGL|MGL|INDANE|HP ?GAS|BHARAT ?GAS|FASTAG)\b/,'dr'],
 ['Rent',/\b(RENT|RENTAL|LEASE ?RENT)\b/,'dr'],
 ['ATM Cash',/\b(ATM|ATW|NWD|CASH ?WDL|CASH WITHDRAWAL|ATM WDL|CSH)\b/,'dr'],
 ['Cash deposit',/\b(CASH ?DEP(OSIT)?|CSH ?DEP|BY ?CASH|CDM|CASH ?CR)\b/,'cr'],
 ['Cheque',/\b(CHQ|CHEQUE|CLG|CLEARING|CTS|INWARD CLG)\b/,''],
 ['UPI',/\bUPI\b/,''],
 ['NEFT/RTGS/IMPS',/\b(NEFT|RTGS|IMPS|MMT|FT ?-|FUND TRANSFER|TRANSFER TO|TRANSFER FROM|BY TRANSFER|TO TRANSFER)\b/,'']];
function categorize(narr,isCredit){
  var s=' '+String(narr||'').toUpperCase().replace(/[\/_\-]/g,' ')+' ';
  for(var i=0;i<RULES.length;i++){var c=RULES[i][0],side=RULES[i][2];if(!RULES[i][1].test(s))continue;
    if(side==='cr'&&!isCredit)continue;if(side==='dr'&&isCredit)continue;
    if(c==='Interest'&&!isCredit&&!/INT\.?COLL|INTEREST/.test(s))continue;
    return c}
  return 'Other'}

/* counterparty name from a narration (approximate): the first word group that isn't a channel code,
   reference number, UPI handle or IFSC */
var CHANNEL=/\b(UPI|NEFT|IMPS|RTGS|MMT|ACH|NACH|ECS|TRANSFER|TRF|FT|INFT|CMS|CHQ|CLG)\b/;
var SKIP=/^(EMI|INV|INVOICE|BILL|SALARY|RENT|CHQ|CLG|RETURN|RETURNED|INSUFFICIENT|INSUFF|FUNDS|CHARGES|CHGS|UPI|DR|CR|NEFT|IMPS|RTGS|MMT|P2A|P2M|IFT|INB|MB|NET|IB|BIL|BILLPAY|ONL|POS|ECS|ACH|NACH|TRANSFER|TRF|TO|FROM|BY|FT|INF|CMS|PAYMENT|PAY|SENT|RECEIVED|REF|NO|PVT|LTD|BANK|THE|SBI|HDFC|ICICI|AXIS|YESB|KKBK|PUNB|BARB|UBIN|CNRB|IDIB|UTIB|IOBA|MAHB|CBIN|INDB|FDRL)$/;
function party(narr){
  if(!CHANNEL.test(String(narr||'').toUpperCase().replace(/[\/_\-]/g,' ')))return '';
  var parts=String(narr||'').toUpperCase().split(/[\/\-|:*]+|\s{2,}/);
  for(var i=0;i<parts.length;i++){var p=parts[i].replace(/\s+/g,' ').trim();
    if(!p||p.indexOf('@')>=0||/\d{4,}/.test(p)||/^[A-Z]{4}0[A-Z0-9]{6}$/.test(p))continue;
    var words=p.split(' ').filter(function(w){return w&&!SKIP.test(w)&&/[A-Z]{2,}/.test(w)&&!/\d/.test(w)});
    if(!words.length)continue;var name=words.slice(0,4).join(' ');if(name.replace(/[^A-Z]/g,'').length<3)continue;
    return name.toLowerCase().replace(/\b[a-z]/g,function(c){return c.toUpperCase()})}
  return ''}

/* ---------- registry ---------- */
var BANKS=[];
function register(b){BANKS=BANKS.filter(function(x){return x.id!==b.id});BANKS.push(b);BANKS.sort(function(a,b){return(a.priority||99)-(b.priority||99)})}
var GENERIC={id:'generic',name:'Unknown bank (generic parser)',columns:{
  date:['txn date','transaction date','tran date','date','posting date','value date'],
  narr:['narration','description','particulars','remarks','transaction remarks','details'],
  ref:['chq','cheque','ref'],valueDate:['value dt','value date'],
  debit:['withdrawal','debit','dr amount','dr'],credit:['deposit','credit','cr amount','cr'],
  amount:['amount'],drcr:['dr/cr','cr/dr','type'],balance:['balance','closing balance']}};

/* map header cells to fields using a column spec */
function mapHeader(cells,spec){
  var low=cells.map(function(c){return String(c==null?'':c).toLowerCase().replace(/\s+/g,' ').trim()}),map={},used={};
  var order=['valueDate','balance','debit','credit','date','narr','ref','drcr','amount'];
  order.forEach(function(f){var keys=spec[f];if(!keys)return;
    for(var k=0;k<keys.length&&map[f]==null;k++)for(var i=0;i<low.length;i++){if(used[i]||!low[i])continue;
      var key=keys[k];if(key.length<=3?(' '+low[i].replace(/[^a-z ]/g,' ')+' ').indexOf(' '+key+' ')>=0:low[i].indexOf(key)>=0){map[f]=i;used[i]=1;break}}});
  return map}
function findHeader(grid,spec){
  for(var r=0;r<Math.min(grid.length,400);r++){var m=mapHeader(grid[r],spec);
    if(m.date!=null&&m.balance!=null&&(m.debit!=null||m.credit!=null||m.amount!=null))return{row:r,map:m}}
  return null}

/* parse a grid (rows of cells) with a column spec; multi-line narrations appended to previous txn */
function parseGrid(grid,spec){
  var h=findHeader(grid,spec);if(!h)return null;var M=h.map,tx=[],cur=null;
  function cell(row,f){return M[f]==null?'':row[M[f]]}
  for(var r=h.row+1;r<grid.length;r++){var row=grid[r]||[];if(!row.some(function(c){return String(c==null?'':c).trim()}))continue;
    var again=mapHeader(row,spec);if(again.date!=null&&again.balance!=null)continue; // repeated header on next page
    var d=parseDate(cell(row,'date'));var bal=parseAmt(cell(row,'balance'));
    if(d&&!isNaN(bal)&&String(cell(row,'balance')).trim()!==''){
      var dr=parseAmt(cell(row,'debit')),cr=parseAmt(cell(row,'credit'));
      if(M.amount!=null){var a=parseAmt(cell(row,'amount')),t=String(cell(row,'drcr')).toUpperCase();
        if(/DR|D\b|DEBIT/.test(t)||a<0){dr=Math.abs(a);cr=0}else{cr=Math.abs(a);dr=0}}
      if(isNaN(dr))dr=0;if(isNaN(cr))cr=0;dr=Math.abs(dr);cr=Math.abs(cr);
      cur={date:d,valueDate:parseDate(cell(row,'valueDate'))||'',narration:String(cell(row,'narr')||'').trim(),ref:String(cell(row,'ref')||'').trim(),debit:dr,credit:cr,balance:bal};
      tx.push(cur)}
    else if(cur&&String(cell(row,'narr')).trim()&&!d){
      var low=row.join(' ').toLowerCase();if(/opening balance|closing balance|statement summary|page \d|generated|\*\*|end of statement/.test(low)){cur=null;continue}
      cur.narration+=' '+String(cell(row,'narr')).trim();var rf=String(cell(row,'ref')||'').trim();if(rf)cur.ref+=rf}
    else if(cur&&d===null&&/total|summary|closing/i.test(row.join(' ')))cur=null}
  return tx.length?{tx:tx,header:h}:null}

/* ---------- PDF text items -> grid aligned to header columns ---------- */
function linesFromItems(items){ // items:{str,x,y,w,page}
  var pages={};items.forEach(function(it){if(!String(it.str).trim())return;(pages[it.page]=pages[it.page]||[]).push(it)});
  var lines=[];Object.keys(pages).sort(function(a,b){return a-b}).forEach(function(p){
    var arr=pages[p].sort(function(a,b){return b.y-a.y||a.x-b.x}),L=[];
    arr.forEach(function(it){var l=L.length&&Math.abs(L[L.length-1].y-it.y)<3?L[L.length-1]:null;if(!l){l={y:it.y,page:+p,items:[]};L.push(l)}l.items.push(it)});
    L.forEach(function(l){l.items.sort(function(a,b){return a.x-b.x});var cells=[];
      l.items.forEach(function(it){var c=cells[cells.length-1];if(c&&it.x-(c.x+c.w)<3.5){c.str+=(it.x-(c.x+c.w)>1?' ':'')+it.str;c.w=it.x+it.w-c.x}else cells.push({str:it.str,x:it.x,w:it.w})});
      l.cells=cells;lines.push(l)})});
  return lines}
function gridFromLines(lines,spec){
  var hdr=null,hm=null;
  for(var i=0;i<lines.length;i++){var m=mapHeader(lines[i].cells.map(function(c){return c.str}),spec);if(m.date!=null&&m.balance!=null&&(m.debit!=null||m.credit!=null||m.amount!=null)){hdr=lines[i];hm=m;break}}
  if(!hdr)return lines.map(function(l){return l.cells.map(function(c){return c.str})});
  var cols=hdr.cells.map(function(c){return{l:c.x,r:c.x+c.w}}),n=cols.length;
  function colOf(c){var num=isAmt(c.str),best=0,bd=1e9;
    for(var k=0;k<n;k++){var lo=k?(cols[k-1].r+cols[k].l)/2:-1e9,hi=k<n-1?(cols[k].r+cols[k+1].l)/2:1e9;
      var px=num?c.x+c.w-0.5:c.x+0.5;if(px>=lo&&px<hi)return k;var dd=Math.min(Math.abs(px-lo),Math.abs(px-hi));if(dd<bd){bd=dd;best=k}}return best}
  var grid=[];lines.forEach(function(l){if(l===hdr){grid.push(hdr.cells.map(function(c){return c.str}));return}
    var row=new Array(n).fill('');l.cells.forEach(function(c){var k=colOf(c);row[k]=row[k]?row[k]+' '+c.str:c.str});grid.push(row)});
  return grid}

function detectBank(text){for(var i=0;i<BANKS.length;i++)if(BANKS[i].detect(text))return BANKS[i];return null}
function meta(text){var m={},t=text.replace(/\s+/g,' ');
  var a=t.match(/(?:A\/?C|Account)\s*(?:No\.?|Number)\s*[:\-]?\s*([X\d*]{6,20})/i);if(a)m.account=a[1].replace(/^(.*)(.{4})$/,function(_,p,q){return p.replace(/\d/g,'X')+q});
  var n=t.match(/(?:Account Name|A\/C Name|Customer Name|Name)\s*[:\-]\s*([A-Za-z .&]{3,40}?)(?=\s{1}(?:Address|Account No|A\/C No|Cust(?:omer)? ?ID|Branch|IFSC|Statement|$))/i);if(n)m.holder=n[1].trim();
  var p=t.match(/(?:From|Period|for the period)\s*:?\s*(\d{1,2}[\/\-][\w]{2,3}[\/\-]\d{2,4})\s*(?:To|-|to)\s*:?\s*(\d{1,2}[\/\-][\w]{2,3}[\/\-]\d{2,4})/i);if(p){m.from=parseDate(p[1]);m.to=parseDate(p[2])}
  var f=t.match(/IFSC(?: Code)?\s*:?\s*([A-Z]{4}0[A-Z0-9]{6})/i);if(f)m.ifsc=f[1].toUpperCase();
  return m}

/* main entry. input: {grid} (xls/csv) or {lines} (pdf) plus text */
function analyze(input){
  var text=input.text||'';var bank=detectBank(text);var tries=bank?[bank,GENERIC]:[GENERIC];var res=null,used=null;
  for(var i=0;i<tries.length&&!res;i++){var g=input.grid||gridFromLines(input.lines,tries[i].columns);res=parseGrid(g,tries[i].columns);used=tries[i]}
  if(!res)return{error:'Could not find a transaction table (looked for Date / Narration / Debit / Credit / Balance columns).',bank:bank};
  var tx=res.tx;tx.forEach(function(t,i){t.id=i+1;t.category=categorize(t.narration+' '+t.ref,t.credit>0&&!t.debit)});
  var m=meta(text);return finish({bank:bank?bank.name:GENERIC.name,bankId:bank?bank.id:'generic',parser:used.id,meta:m,tx:tx})}
function r2(n){return Math.round(n*100)/100}
function finish(R){var tx=R.tx;
  // detect reverse-chronological order via balances
  if(tx.length>1&&!chainOK(tx)&&chainOK(tx.slice().reverse())){tx.reverse();tx.forEach(function(t,i){t.id=i+1})}
  var f=tx[0],l=tx[tx.length-1];R.opening=r2(f.balance-f.credit+f.debit);R.closing=l.balance;
  R.totalCredit=r2(tx.reduce(function(s,t){return s+t.credit},0));R.totalDebit=r2(tx.reduce(function(s,t){return s+t.debit},0));R.count=tx.length;
  R.creditCount=tx.filter(function(t){return t.credit>0}).length;R.debitCount=tx.filter(function(t){return t.debit>0}).length;
  R.from=R.meta.from||f.date;R.to=R.meta.to||l.date;R.mismatches=[];var run=R.opening;
  tx.forEach(function(t){run=r2(run+t.credit-t.debit);if(Math.abs(run-t.balance)>0.01){R.mismatches.push({id:t.id,date:t.date,expected:run,actual:t.balance});run=t.balance}});
  if(Math.abs(r2(R.opening+R.totalCredit-R.totalDebit)-R.closing)>0.01)R.totalMismatch=true;
  return R}
function chainOK(tx){var ok=0;for(var i=1;i<tx.length;i++)if(Math.abs(r2(tx[i-1].balance+tx[i].credit-tx[i].debit)-tx[i].balance)<0.01)ok++;return ok>=(tx.length-1)*0.9}
function byMonth(tx){var o={};
  tx.forEach(function(t){var k=t.date.slice(0,7),m=o[k]||(o[k]={cr:0,dr:0,crN:0,drN:0,closing:0});if(t.credit){m.cr=r2(m.cr+t.credit);m.crN++}if(t.debit){m.dr=r2(m.dr+t.debit);m.drN++}m.closing=t.balance});return o}
function parties(tx){var o={};
  tx.forEach(function(t){var p=party(t.narration);if(!p)return;var x=o[p]||(o[p]={name:p,cr:0,dr:0,crN:0,drN:0});if(t.credit){x.cr=r2(x.cr+t.credit);x.crN++}if(t.debit){x.dr=r2(x.dr+t.debit);x.drN++}});
  var a=Object.keys(o).map(function(k){return o[k]});
  return{payers:a.filter(function(x){return x.cr}).sort(function(a,b){return b.cr-a.cr}).slice(0,10),payees:a.filter(function(x){return x.dr}).sort(function(a,b){return b.dr-a.dr}).slice(0,10)}}
function byCategory(tx){var o={};CATS.forEach(function(c){o[c]={cr:0,dr:0,crN:0,drN:0}});
  tx.forEach(function(t){var c=o[t.category]||(o[t.category]={cr:0,dr:0,crN:0,drN:0});if(t.credit){c.cr=r2(c.cr+t.credit);c.crN++}if(t.debit){c.dr=r2(c.dr+t.debit);c.drN++}});return o}

/* PDF extraction with pdf.js (lib injected). onPassword(retry) -> Promise<string|null> */
function pdfExtract(pdfjs,data,askPassword){
  return new Promise(function(res,rej){
    var task=pdfjs.getDocument({data:data,isEvalSupported:false});var tries=0;
    task.onPassword=function(update,reason){tries++;Promise.resolve(askPassword?askPassword(reason===2||tries>1):null).then(function(pw){if(pw==null){task.destroy();rej(new Error('PASSWORD_CANCELLED'))}else update(pw)})};
    task.promise.then(function(doc){var items=[],text=[],p=0;
      function next(){p++;if(p>doc.numPages){doc.destroy();return res({items:items,text:text.join('\n'),pages:doc.numPages})}
        doc.getPage(p).then(function(pg){return pg.getTextContent()}).then(function(tc){tc.items.forEach(function(it){if(it.str==null)return;items.push({str:it.str,x:it.transform[4],y:it.transform[5],w:it.width,page:p})});
          text.push(tc.items.map(function(i){return i.str}).join(' '));next()}).catch(rej)}
      next()},rej)})}

var API={CATS:CATS,register:register,banks:function(){return BANKS.slice()},GENERIC:GENERIC,parseDate:parseDate,parseAmt:parseAmt,categorize:categorize,
  linesFromItems:linesFromItems,gridFromLines:gridFromLines,parseGrid:parseGrid,analyze:analyze,finish:finish,byCategory:byCategory,byMonth:byMonth,parties:parties,party:party,pdfExtract:pdfExtract,meta:meta,detectBank:detectBank};
G.SKCBank=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof globalThis!=='undefined'?globalThis:this);

/* ---------- bank layouts ---------- */
/* HDFC Bank — savings/current statement (PDF & XLS): Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance */
SKCBank.register({id:'hdfc',name:'HDFC Bank',priority:1,
  detect:function(t){return /HDFC\s*BANK/i.test(t)||/IFSC\W{0,12}HDFC0\d{6}/i.test(t)},
  columns:{date:['date'],narr:['narration'],ref:['chq','ref'],valueDate:['value dt','value date'],debit:['withdrawal'],credit:['deposit'],balance:['closing balance','balance']}});
/* ICICI Bank — S No. | Value Date | Transaction Date | Cheque Number | Transaction Remarks | Withdrawal Amount (INR) | Deposit Amount (INR) | Balance (INR) */
SKCBank.register({id:'icici',name:'ICICI Bank',priority:2,
  detect:function(t){return /ICICI\s*BANK/i.test(t)||/IFSC\W{0,12}ICIC0\d{6}/i.test(t)},
  columns:{date:['transaction date','txn date'],valueDate:['value date'],narr:['transaction remarks','remarks','particulars'],ref:['cheque number','cheque','chq'],debit:['withdrawal'],credit:['deposit'],balance:['balance']}});
/* State Bank of India — Txn Date | Value Date | Description | Ref No./Cheque No. | Debit | Credit | Balance */
SKCBank.register({id:'sbi',name:'State Bank of India',priority:3,
  detect:function(t){return /STATE\s+BANK\s+OF\s+INDIA/i.test(t)||/IFSC\W{0,12}SBIN0\d{6}/i.test(t)},
  columns:{date:['txn date','transaction date'],valueDate:['value date'],narr:['description','particulars'],ref:['ref no','cheque no','ref'],debit:['debit'],credit:['credit'],balance:['balance']}});

/* ---------- page (route #/bank) ---------- */
(() => {
  "use strict";
  const B = window.SKCBank;
  let R = null;            // the statement on screen (kept while moving around the site)
  let holder = "personal"; // personal | business — changes which checks are shown
  let src = "";

  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v; else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return e;
  };
  const $ = (id) => document.getElementById(`bk-${id}`);
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const inr = (n) => (n < 0 ? "−" : "") + "₹" + Math.abs(+n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inr0 = (n) => (n < 0 ? "−" : "") + "₹" + Math.abs(Math.round(+n || 0)).toLocaleString("en-IN");
  const dmy = (d) => (d ? d.split("-").reverse().join("/") : "");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthName = (k) => `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
  const say = (msg, kind) => (window.GG?.toast ? window.GG.toast(msg, kind) : alert(msg));
  const loadScript = (s) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${s}"]`)) return resolve();
    const x = el("script", { src: s }); x.onload = resolve; x.onerror = () => reject(new Error(`couldn't load ${s}`)); document.head.append(x);
  });
  async function needPdf() {
    if (!window.pdfjsLib) await loadScript("vendor/pdf.min.js");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  }
  const needXlsx = async () => { if (!window.XLSX) await loadScript("vendor/xlsx.full.min.js"); };

  function status(text, cls) { const s = $("status"); if (s) s.replaceChildren(text ? el("p", { class: cls || "muted" }, text) : ""); }

  function render(root) {
    const drop = el("div", { id: "bk-drop", class: "bk-drop", tabindex: "0", role: "button", "aria-label": "Choose a bank statement file",
      onclick: () => $("file").click(), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } },
      ondragover: (e) => { e.preventDefault(); drop.classList.add("on"); }, ondragleave: () => drop.classList.remove("on"),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove("on"); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); } },
      el("b", null, "Drop a PDF, Excel (.xls / .xlsx) or CSV statement here"), el("br"),
      el("span", { class: "muted" }, "or tap to choose · HDFC, ICICI, SBI layouts plus automatic detection for other banks"));
    root.replaceChildren(
      el("h1", { class: "page-title" }, "Bank Statement Analyzer"),
      el("p", { class: "muted" }, "For individuals, proprietors, firms and companies — savings, current, OD and CC accounts. Summary, monthly cash flow, categories, counterparties and checks, with Excel and PDF export."),
      el("section", { class: "tax-card noprint", id: "bk-form" },
        el("div", { class: "tax-grid" },
          el("label", { class: "field" }, el("span", null, "Account holder"),
            el("select", { id: "bk-holder", onchange: (e) => { holder = e.target.value; if (R) renderOut(); } },
              el("option", { value: "personal" }, "Individual — savings account"),
              el("option", { value: "business" }, "Business — current / OD / CC account (proprietor, firm, company)")))),
        drop,
        el("input", { id: "bk-file", type: "file", accept: ".pdf,.xls,.xlsx,.csv", hidden: true, onchange: (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); } }),
        el("p", { class: "bk-ok" }, "🔒 Private: the statement is read and analysed only inside this browser tab. Nothing is uploaded or stored. Tap Clear to wipe it."),
        el("p", { class: "muted tax-note" }, "Tip: you can re-import an Excel file exported from here to carry on editing categories. Password-protected PDFs are unlocked on this device (the password never leaves it). Scanned / photo PDFs can't be read — download a text PDF, Excel or CSV from net banking, or attach the scan to Saarthi."),
        el("div", { id: "bk-status", role: "status", "aria-live": "polite" })),
      el("div", { id: "bk-out" }));
    // The page is put on screen right after render() returns; fill it in then.
    queueMicrotask(() => { if (!root.isConnected) return; $("holder").value = holder; if (R) renderOut(); });
  }

  async function loadFile(f) {
    status(`Reading ${f.name} …`);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      await loadBytes(f.name, buf);
    } catch (e) {
      status(e.message === "PASSWORD_CANCELLED" ? "Password not given — the PDF wasn't opened." : `Couldn't read this file: ${e.message || e}`, "bk-warn");
    }
  }
  async function loadBytes(name, buf) {
    const isPdf = /\.pdf$/i.test(name) || (buf[0] === 0x25 && buf[1] === 0x50);
    const res = isPdf ? await loadPdf(buf) : await loadSheet(buf, name);
    if (!res) return null;
    return show(res.r, res.src);
  }
  async function loadPdf(buf) {
    await needPdf();
    const ex = await B.pdfExtract(window.pdfjsLib, buf, (retry) => prompt(`${retry ? "Incorrect password. " : ""}This PDF is password-protected. Enter its password (used only in this browser):`));
    if (ex.text.replace(/\s/g, "").length < 40 * ex.pages) {
      status("This looks like a scanned (image) PDF — no text could be read. Download the statement as a text PDF or Excel / CSV from net banking, or attach it to Saarthi, who can read scans.", "bk-warn");
      return null;
    }
    return { r: B.analyze({ lines: B.linesFromItems(ex.items), text: ex.text }), src: `${ex.pages}-page PDF` };
  }
  async function loadSheet(buf, name) {
    await needXlsx();
    // CSV is read as plain text so dates like 07/03/2026 stay day-first (SheetJS would read them US-style).
    const X = window.XLSX, wb = /\.csv$/i.test(name) ? X.read(new TextDecoder().decode(buf), { type: "string", raw: true }) : X.read(buf, { type: "array", cellDates: true });
    if (wb.Sheets.Transactions && wb.Sheets.Summary) {   // our own export, re-imported
      const rows = X.utils.sheet_to_json(wb.Sheets.Transactions, { defval: "" });
      if (rows.length && "Category" in rows[0]) {
        const sm = {};
        X.utils.sheet_to_json(wb.Sheets.Summary, { header: 1 }).forEach((r) => { sm[r[0]] = r[1]; });
        const tx = rows.map((r, i) => ({ id: i + 1, date: B.parseDate(r.Date), valueDate: B.parseDate(r["Value Date"]) || "", narration: String(r.Narration), ref: String(r["Ref/Cheque No"]),
          debit: +r.Debit || 0, credit: +r.Credit || 0, balance: +r.Balance || 0, category: B.CATS.includes(r.Category) ? r.Category : "Other" }))
          .filter((t) => t.date);
        if (sm["Account holder"]) holder = /business/i.test(sm["Account holder"]) ? "business" : "personal";
        return { r: B.finish({ bank: sm.Bank || "Re-imported", bankId: "reimport", parser: "skc-export", meta: { account: sm.Account || "", from: B.parseDate(sm["Period from"]), to: B.parseDate(sm["Period to"]) }, tx }), src: "re-imported SKC export" };
      }
    }
    const ws = wb.Sheets[wb.SheetNames[0]], grid = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    return { r: B.analyze({ grid, text: grid.slice(0, 40).map((r) => r.join(" ")).join("\n") }), src: `${name.split(".").pop().toUpperCase()} file` };
  }

  function show(res, from) {
    if (res.error) { status(`${res.error} Supported: HDFC, ICICI, SBI and statements with clear Date / Debit / Credit / Balance columns.`, "bk-warn"); return { error: res.error }; }
    R = res; src = from;
    status(`Read ${R.count} transactions from the ${from}.`, "bk-ok");
    const page = $("out");
    if (page) { renderOut(); page.scrollIntoView({ behavior: "smooth" }); }
    return summary();
  }

  /* ---------- analysis ---------- */
  function analysis() {
    const tx = R.tx, months = B.byMonth(tx), keys = Object.keys(months).sort(), nM = Math.max(1, keys.length);
    const cat = B.byCategory(tx), sumCat = (c, side) => (cat[c] ? cat[c][side] : 0);
    const minRow = tx.reduce((m, t) => (t.balance < m.balance ? t : m), tx[0]);
    const maxCr = tx.reduce((m, t) => (t.credit > (m?.credit || 0) ? t : m), null);
    const maxDr = tx.reduce((m, t) => (t.debit > (m?.debit || 0) ? t : m), null);
    const returns = tx.filter((t) => /\b(RETURN|RTN|BOUNCE|INSUFF|DISHONOU?R|UNPAID)\b/i.test(t.narration) && !/REFUND/i.test(t.narration));
    const negative = tx.filter((t) => t.balance < 0);
    const cashDep = sumCat("Cash deposit", "cr"), cashWd = sumCat("ATM Cash", "dr");
    const avgBal = tx.reduce((s, t) => s + t.balance, 0) / tx.length;
    const notes = [];
    notes.push(`Average monthly credits ${inr0(R.totalCredit / nM)} and debits ${inr0(R.totalDebit / nM)} over ${keys.length} month${keys.length > 1 ? "s" : ""}; net ${R.totalCredit >= R.totalDebit ? "inflow" : "outflow"} ${inr0(Math.abs(R.totalCredit - R.totalDebit))}.`);
    notes.push(`Lowest balance ${inr(minRow.balance)} on ${dmy(minRow.date)}; average balance after each transaction ${inr0(avgBal)}.`);
    if (maxCr) notes.push(`Largest credit ${inr(maxCr.credit)} on ${dmy(maxCr.date)} — ${maxCr.narration.slice(0, 70)}.`);
    if (maxDr) notes.push(`Largest debit ${inr(maxDr.debit)} on ${dmy(maxDr.date)} — ${maxDr.narration.slice(0, 70)}.`);
    const ch = sumCat("Charges/Fees", "dr");
    if (ch) notes.push(`Bank charges and fees: ${inr(ch)} — worth checking against the bank's schedule.`);
    if (returns.length) notes.push(`⚠ ${returns.length} possible cheque / ECS / NACH return${returns.length > 1 ? "s" : ""} (first on ${dmy(returns[0].date)}). Returns cost charges and, for loan EMIs, hurt the credit score.`);
    if (negative.length) notes.push(`The balance was below zero on ${negative.length} transaction${negative.length > 1 ? "s" : ""} — overdraft / cash-credit limit in use.`);
    const emi = sumCat("EMI/Loan", "dr");
    if (emi) notes.push(`Loan / EMI payments: ${inr(emi)} (${inr0(emi / nM)} a month on average)${R.totalCredit ? `, ${Math.round(emi / R.totalCredit * 100)}% of credits` : ""}.`);
    if (holder === "business") {
      const gst = sumCat("GST", "dr"), tds = sumCat("Income tax / TDS", "dr"), pay = sumCat("Payroll", "dr");
      if (gst || tds) notes.push(`Taxes paid from this account: GST ${inr(gst)}, income tax / TDS ${inr(tds)}.`);
      if (pay) notes.push(`Salaries / wages paid: ${inr(pay)} (${inr0(pay / nM)} a month).`);
      if (cashDep) notes.push(`Cash deposits ${inr(cashDep)}. Banks report cash deposits of ₹50 lakh or more in a year in current accounts to the Income Tax Department (SFT).`);
      if (cashWd) notes.push(`Cash withdrawals ${inr(cashWd)}. TDS u/s 194N applies to cash withdrawals above ₹1 crore in a year (₹20 lakh if returns weren't filed for the last three years).`);
      const parties = B.parties(tx);
      if (parties.payers[0] && R.totalCredit) notes.push(`Top payer ${parties.payers[0].name} — ${Math.round(parties.payers[0].cr / R.totalCredit * 100)}% of credits${parties.payers[0].cr / R.totalCredit > 0.4 ? " (high dependence on one customer)" : ""}.`);
    } else {
      const sal = sumCat("Salary", "cr");
      if (sal) notes.push(`Salary credits: ${inr(sal)} (${cat.Salary.crN} credit${cat.Salary.crN > 1 ? "s" : ""}).`);
      if (cashDep) notes.push(`Cash deposits ${inr(cashDep)}. Banks report cash deposits of ₹10 lakh or more in a year in savings accounts to the Income Tax Department (SFT).`);
      const inv = sumCat("Investments", "dr");
      if (inv) notes.push(`Money put into investments (MF / SIP / deposits / demat): ${inr(inv)} — ${R.totalCredit ? Math.round(inv / R.totalCredit * 100) : 0}% of credits.`);
      const int = sumCat("Interest", "cr");
      if (int) notes.push(`Interest credited ${inr(int)} — taxable under "Other sources" (80TTA / 80TTB may apply in the old regime).`);
    }
    return { months, keys, cat, notes, parties: B.parties(tx) };
  }

  function renderOut() {
    const out = $("out");
    if (!out || !R) return;
    const A = analysis(), m = R.meta || {};
    const info = [`Bank: ${R.bank}`, m.account && `Account: ${m.account}`, m.holder && `Name: ${m.holder}`, m.ifsc && `IFSC: ${m.ifsc}`, `Period: ${dmy(R.from)} – ${dmy(R.to)}`, `Read from: ${src}`].filter(Boolean).join(" · ");
    const recon = R.mismatches.length || R.totalMismatch
      ? el("p", { class: "bk-warn" }, `⚠ Balance check: the running balance doesn't match the statement on ${R.mismatches.length} row(s)${R.mismatches.length ? ` (first: row ${R.mismatches[0].id} on ${dmy(R.mismatches[0].date)}, expected ${inr(R.mismatches[0].expected)}, statement shows ${inr(R.mismatches[0].actual)})` : ""}. Some rows may have been misread — please verify.`)
      : el("p", { class: "bk-ok" }, "✔ Balance check passed: opening + credits − debits = closing, and every running balance matches.");
    const tbl = (head, rows, foot) => el("div", { class: "bk-tw" }, el("table", { class: "tax-table bk-table" },
      el("thead", null, el("tr", null, head.map((x, i) => el("th", { class: i ? "n" : "" }, x)))), el("tbody", null, rows), foot ? el("tfoot", null, foot) : null));
    const catRows = Object.keys(A.cat).filter((c) => A.cat[c].crN || A.cat[c].drN).map((c) => { const v = A.cat[c];
      return el("tr", null, el("td", null, c), el("td", { class: "n bk-cr" }, v.cr ? inr(v.cr) : ""), el("td", { class: "n" }, v.crN || ""), el("td", { class: "n bk-dr" }, v.dr ? inr(v.dr) : ""), el("td", { class: "n" }, v.drN || "")); });
    const monRows = A.keys.map((k) => { const v = A.months[k];
      return el("tr", null, el("td", null, monthName(k)), el("td", { class: "n bk-cr" }, inr0(v.cr)), el("td", { class: "n bk-dr" }, inr0(v.dr)), el("td", { class: `n ${v.cr >= v.dr ? "bk-cr" : "bk-dr"}` }, inr0(v.cr - v.dr)), el("td", { class: "n" }, inr0(v.closing))); });
    const maxMon = Math.max(1, ...A.keys.map((k) => Math.max(A.months[k].cr, A.months[k].dr)));
    const bars = el("div", { class: "bk-bars", "aria-hidden": "true" }, A.keys.map((k) => el("div", { class: "bk-bar", title: `${monthName(k)}: in ${inr0(A.months[k].cr)}, out ${inr0(A.months[k].dr)}` },
      el("span", { class: "bk-in", style: `height:${A.months[k].cr / maxMon * 100}%` }), el("span", { class: "bk-outb", style: `height:${A.months[k].dr / maxMon * 100}%` }), el("small", null, MONTHS[+k.slice(5, 7) - 1]))));
    const partyTable = (list, side) => list.length ? tbl(["Name", "Amount", "#"], list.map((p) => el("tr", null, el("td", null, p.name), el("td", { class: `n ${side === "cr" ? "bk-cr" : "bk-dr"}` }, inr0(p[side])), el("td", { class: "n" }, p[side + "N"])))) : el("p", { class: "muted" }, "None identified.");
    out.replaceChildren(
      el("section", { class: "tax-card", id: "bk-result" },
        el("h2", null, "Statement summary ", el("span", { class: "bk-badge" }, R.bank)),
        el("p", { class: "muted" }, info), recon,
        el("div", { class: "bk-sum" }, [["Opening balance", inr(R.opening)], ["Closing balance", inr(R.closing)], [`Total credits (${R.creditCount})`, inr(R.totalCredit)], [`Total debits (${R.debitCount})`, inr(R.totalDebit)], ["Transactions", R.count]]
          .map(([l, v]) => el("div", null, l, el("b", null, v)))),
        el("p", { class: "tax-actions noprint" },
          el("button", { class: "btn primary", type: "button", onclick: exportXlsx }, "Export Excel"),
          el("button", { class: "btn", type: "button", onclick: () => window.print() }, "Print"),
          el("button", { class: "btn", type: "button", onclick: downloadPDF }, "Download PDF"),
          el("button", { class: "btn", type: "button", onclick: () => window.GG?.askSaarthi?.("Look at the bank statement I've loaded in the Bank Statement Analyzer and tell me what stands out — cash flow, risks and anything I should act on.") }, "🙏 Ask Saarthi about it"),
          el("button", { class: "btn", type: "button", onclick: clearAll }, "Clear"))),
      el("section", { class: "tax-card" }, el("h2", null, "What stands out"), el("ul", { class: "bk-notes" }, A.notes.map((t) => el("li", null, t)))),
      el("section", { class: "tax-card" }, el("h2", null, "Monthly cash flow"), bars,
        tbl(["Month", "Credits", "Debits", "Net", "Closing balance"], monRows)),
      el("section", { class: "tax-card" }, el("h2", null, "Category-wise summary"),
        tbl(["Category", "Credits", "#", "Debits", "#"], catRows,
          el("tr", { class: "t" }, el("td", null, "Total"), el("td", { class: "n" }, inr(R.totalCredit)), el("td", { class: "n" }, R.creditCount), el("td", { class: "n" }, inr(R.totalDebit)), el("td", { class: "n" }, R.debitCount)))),
      el("section", { class: "tax-card" }, el("h2", null, holder === "business" ? "Top customers and suppliers" : "Top senders and recipients"),
        el("p", { class: "muted tax-note" }, "Names are read from the narrations and are approximate."),
        el("div", { class: "tax-cmp" },
          el("div", null, el("h3", null, holder === "business" ? "Money received from" : "Received from"), partyTable(A.parties.payers, "cr")),
          el("div", null, el("h3", null, holder === "business" ? "Money paid to" : "Paid to"), partyTable(A.parties.payees, "dr")))),
      el("section", { class: "tax-card" }, el("h2", null, "Transactions"),
        el("div", { class: "tax-grid noprint" },
          el("label", { class: "field" }, el("span", null, "Search"), el("input", { id: "bk-q", type: "search", placeholder: "narration, ref, amount", oninput: renderTx })),
          el("label", { class: "field" }, el("span", null, "Category"), el("select", { id: "bk-fc", onchange: renderTx }, el("option", { value: "" }, "All"), B.CATS.map((c) => el("option", null, c)))),
          el("label", { class: "field" }, el("span", null, "Type"), el("select", { id: "bk-ft", onchange: renderTx }, el("option", { value: "" }, "All"), el("option", { value: "cr" }, "Credits"), el("option", { value: "dr" }, "Debits")))),
        el("p", { class: "muted", id: "bk-shown" }),
        el("div", { class: "bk-tw bk-txw" }, el("table", { class: "tax-table bk-table", id: "bk-tx" }))),
      el("p", { class: "tax-disc" }, "Categories and names are assigned automatically from the narration and may be wrong — review and change them. This is an aid, not advice; verify totals against the bank statement."));
    renderTx();
  }

  function renderTx() {
    const q = ($("q")?.value || "").toLowerCase(), fc = $("fc")?.value || "", ft = $("ft")?.value || "";
    let n = 0;
    const rows = [];
    R.tx.forEach((t, i) => {
      if (fc && t.category !== fc) return;
      if (ft === "cr" && !t.credit) return;
      if (ft === "dr" && !t.debit) return;
      if (q && `${t.narration} ${t.ref} ${t.debit} ${t.credit}`.toLowerCase().indexOf(q) < 0) return;
      n++;
      if (n > 1500) return;   // keep the page quick on very long statements; search to narrow
      rows.push(`<tr><td>${t.id}</td><td>${dmy(t.date)}</td><td class="bk-nr">${esc(t.narration)}</td><td>${esc(t.ref)}</td><td class="n bk-dr">${t.debit ? inr(t.debit) : ""}</td><td class="n bk-cr">${t.credit ? inr(t.credit) : ""}</td><td class="n">${inr(t.balance)}</td><td><select data-i="${i}" aria-label="Category for row ${t.id}">${B.CATS.map((c) => `<option${c === t.category ? " selected" : ""}>${c}</option>`).join("")}</select></td></tr>`);
    });
    const tbl = $("tx");
    tbl.innerHTML = `<thead><tr><th>#</th><th>Date</th><th>Narration</th><th>Ref</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th><th>Category</th></tr></thead><tbody>${rows.join("")}</tbody>`;
    tbl.onchange = (e) => { const i = e.target.getAttribute("data-i"); if (i == null) return; R.tx[+i].category = e.target.value; const y = scrollY; renderOut(); scrollTo(0, y); };
    $("shown").textContent = `Showing ${Math.min(n, 1500)} of ${R.count} transactions${n > 1500 ? " — search or filter to see the rest" : ""}`;
  }

  /* ---------- export ---------- */
  const fname = (ext) => `SKC-Bank-Statement-${R.bankId || "bank"}-${R.from || ""}_${R.to || ""}.${ext}`;
  async function exportXlsx() {
    try { await needXlsx(); } catch { say("Excel library didn't load.", "error"); return; }
    const X = window.XLSX, A = analysis(), m = R.meta || {};
    const s = [["SKC & CO. — Bank Statement Analysis"], ["Bank", R.bank], ["Account", m.account || ""], ["Account holder", holder === "business" ? "Business" : "Individual"], ["Period from", R.from], ["Period to", R.to],
      ["Opening balance", R.opening], ["Closing balance", R.closing], ["Total credits", R.totalCredit], ["Total debits", R.totalDebit], ["Transactions", R.count],
      ["Balance check", R.mismatches.length ? `MISMATCH on ${R.mismatches.length} rows` : "OK"], [], ["Category", "Credits", "# Credits", "Debits", "# Debits"]];
    Object.keys(A.cat).forEach((c) => { const v = A.cat[c]; if (v.crN || v.drN) s.push([c, v.cr, v.crN, v.dr, v.drN]); });
    s.push([], ["Month", "Credits", "Debits", "Net", "Closing balance"]);
    A.keys.forEach((k) => { const v = A.months[k]; s.push([monthName(k), v.cr, v.dr, Math.round((v.cr - v.dr) * 100) / 100, v.closing]); });
    s.push([], ["What stands out"], ...A.notes.map((t) => [t]));
    const t = R.tx.map((x) => ({ "S No": x.id, Date: x.date, "Value Date": x.valueDate, Narration: x.narration, "Ref/Cheque No": x.ref, Debit: x.debit, Credit: x.credit, Balance: x.balance, Category: x.category, Party: B.party(x.narration) }));
    const wb = X.utils.book_new(), ws1 = X.utils.aoa_to_sheet(s), ws2 = X.utils.json_to_sheet(t);
    ws1["!cols"] = [{ wch: 26 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 14 }];
    ws2["!cols"] = [{ wch: 6 }, { wch: 11 }, { wch: 11 }, { wch: 60 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 24 }];
    X.utils.book_append_sheet(wb, ws1, "Summary"); X.utils.book_append_sheet(wb, ws2, "Transactions");
    X.writeFile(wb, fname("xlsx"));
  }
  async function downloadPDF() {
    try {
      if (!window.jspdf?.jsPDF) { await loadScript("vendor/jspdf.umd.min.js"); await loadScript("vendor/jspdf.plugin.autotable.min.js"); }
    } catch { say("PDF library didn't load — use Print and choose “Save as PDF”.", "error"); return; }
    const rs = (t) => String(t).replace(/₹/g, "Rs. ").replace(/−/g, "-").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
    const A = analysis(), doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" }), hs = { fillColor: [180, 73, 15] };
    doc.setFontSize(14); doc.text("SKC & CO. - Bank Statement Analysis", 40, 40);
    doc.setFontSize(9); doc.text(rs(`${R.bank} · ${dmy(R.from)} – ${dmy(R.to)}${R.meta?.account ? " · A/c " + R.meta.account : ""}`), 40, 56, { maxWidth: 515 });
    doc.autoTable({ startY: 70, head: [["Summary", "Amount"]], body: [["Opening balance", rs(inr(R.opening))], ["Closing balance", rs(inr(R.closing))], [`Total credits (${R.creditCount})`, rs(inr(R.totalCredit))], [`Total debits (${R.debitCount})`, rs(inr(R.totalDebit))], ["Transactions", R.count], ["Balance check", R.mismatches.length ? `MISMATCH on ${R.mismatches.length} rows` : "OK"]], theme: "grid", styles: { fontSize: 8 }, columnStyles: { 1: { halign: "right" } }, headStyles: hs });
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 12, head: [["What stands out"]], body: A.notes.map((t) => [rs(t)]), theme: "grid", styles: { fontSize: 8 }, headStyles: hs });
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 12, head: [["Month", "Credits", "Debits", "Net", "Closing"]], body: A.keys.map((k) => { const v = A.months[k]; return [monthName(k), rs(inr0(v.cr)), rs(inr0(v.dr)), rs(inr0(v.cr - v.dr)), rs(inr0(v.closing))]; }), theme: "grid", styles: { fontSize: 8 }, columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } }, headStyles: hs });
    const body = Object.keys(A.cat).filter((c) => A.cat[c].crN || A.cat[c].drN).map((c) => { const v = A.cat[c]; return [c, v.cr ? rs(inr(v.cr)) : "", v.crN || "", v.dr ? rs(inr(v.dr)) : "", v.drN || ""]; });
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 12, head: [["Category", "Credits", "#", "Debits", "#"]], body, theme: "grid", styles: { fontSize: 8 }, columnStyles: { 1: { halign: "right" }, 3: { halign: "right" } }, headStyles: hs });
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 12, head: [["#", "Date", "Narration", "Debit", "Credit", "Balance", "Category"]], body: R.tx.map((t) => [t.id, dmy(t.date), rs(t.narration), t.debit ? rs(inr(t.debit)) : "", t.credit ? rs(inr(t.credit)) : "", rs(inr(t.balance)), t.category]), theme: "grid", styles: { fontSize: 6.5 }, columnStyles: { 2: { cellWidth: 170 }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } }, headStyles: hs });
    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) { doc.setPage(p); doc.setFontSize(8); doc.text(`(c) SKC & CO. - an aid, not advice - page ${p}/${n}`, 40, doc.internal.pageSize.getHeight() - 20); }
    doc.save(fname("pdf"));
  }
  function clearAll() {
    R = null; src = "";
    const f = $("file"); if (f) f.value = "";
    $("out")?.replaceChildren();
    status("Cleared. Load another statement.", "bk-ok");
    scrollTo(0, 0);
  }

  /* ---------- for Saarthi ---------- */
  function summary() {
    if (!R) return null;
    const A = analysis(), round = (x) => Math.round(x);
    return {
      bank: R.bank, account: R.meta?.account || "", period: { from: R.from, to: R.to }, account_holder: holder,
      opening_balance: R.opening, closing_balance: R.closing, total_credits: R.totalCredit, total_debits: R.totalDebit, transactions: R.count,
      balance_check: R.mismatches.length || R.totalMismatch ? `mismatch on ${R.mismatches.length} rows — some rows may be misread` : "ok",
      categories: Object.fromEntries(Object.entries(A.cat).filter(([, v]) => v.crN || v.drN).map(([k, v]) => [k, { credits: round(v.cr), debits: round(v.dr), count: v.crN + v.drN }])),
      monthly: A.keys.map((k) => ({ month: k, credits: round(A.months[k].cr), debits: round(A.months[k].dr), closing: round(A.months[k].closing) })),
      top_payers: A.parties.payers.slice(0, 5).map((p) => ({ name: p.name, amount: round(p.cr), count: p.crN })),
      top_payees: A.parties.payees.slice(0, 5).map((p) => ({ name: p.name, amount: round(p.dr), count: p.drN })),
      observations: A.notes,
      largest: R.tx.slice().sort((a, b) => Math.max(b.credit, b.debit) - Math.max(a.credit, a.debit)).slice(0, 8)
        .map((t) => ({ date: t.date, narration: t.narration.slice(0, 80), debit: t.debit, credit: t.credit, category: t.category })),
    };
  }
  function find({ query = "", category = "", type = "", limit = 25 } = {}) {
    if (!R) return null;
    const q = String(query).toLowerCase();
    const hits = R.tx.filter((t) => (!category || t.category === category) && (!type || (type === "credit" ? t.credit : t.debit)) && (!q || `${t.narration} ${t.ref} ${t.credit} ${t.debit}`.toLowerCase().includes(q)));
    return { matches: hits.length, total_credit: Math.round(hits.reduce((s, t) => s + t.credit, 0)), total_debit: Math.round(hits.reduce((s, t) => s + t.debit, 0)),
      rows: hits.slice(0, Math.min(60, limit)).map((t) => ({ date: t.date, narration: t.narration.slice(0, 90), debit: t.debit, credit: t.credit, balance: t.balance, category: t.category })) };
  }
  function setHolder(h) { holder = h === "business" ? "business" : "personal"; if ($("holder")) $("holder").value = holder; if (R && $("out")) renderOut(); }

  window.GGBank = { render, loadBytes, summary, find, setHolder, CATS: B.CATS };
})();
