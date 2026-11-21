#!/usr/bin/env python3
# SmartSetu S23-F-3 fit matrix (S23-F-1 rules a-d unchanged; rules f,g,h ADDED for zoom <= 1.3: tag in the logo row, heading <= 3 lines, first Why card top <= viewport height - 120; zoom emulation made repeatable after the guard acts) (AI sandbox tool, owner does not run it). ASCII only.
# Usage: python3 fit_matrix.py <path to www/index.html> <out dir> [chrome path]
# Renders the home screen at 6 widths x 4 text-zoom factors and checks the D-133 pass rule:
# (1) no horizontal page overflow, (2) no text outside the screen, (3) no text cut by ellipsis/clip,
# (4) no text overlapping the cart picture (.art). Exit code 1 if any case fails.
# Text zoom is EMULATED: every element computed font-size is multiplied, layout units are not.
# Android WebView textZoom is close to this but NOT identical, so zoom rows are APPROX (V-534).
import sys, json, os
from playwright.sync_api import sync_playwright
W=[320,360,375,393,412,430,434]; Z=[1,1.15,1.3,1.5]
page=os.path.abspath(sys.argv[1]); out=sys.argv[2]; chrome=sys.argv[3] if len(sys.argv)>3 else None
os.makedirs(out,exist_ok=True)
ZOOM="""z=>{window.__apply=()=>{const es=[document.documentElement,...document.querySelectorAll('body *')];es.forEach(e=>e.style.removeProperty('font-size'));const v=es.map(e=>parseFloat(getComputedStyle(e).fontSize));es.forEach((e,i)=>{e.style.setProperty('font-size',(v[i]*z)+'px','important')})};const r=document.documentElement;r.classList.remove('fitwrap');r.style.removeProperty('--fitk');window.__apply()}"""
JS="""()=>{
const vw=innerWidth,o={sw:document.documentElement.scrollWidth,fs:getComputedStyle(document.documentElement).fontSize};
o.overflowX=o.sw>vw;
const art=document.querySelector('.hero .art');const ar=art.getBoundingClientRect();
const off=[],clip=[],ovl=[];
const root=document.querySelector('.herobox');
const tw=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
let n;
while(n=tw.nextNode()){
 const t=n.textContent.trim();if(!t)continue;
 const el=n.parentElement;if(el.closest('.perks')||el.closest('.sr')||el.closest('svg')||el.closest('[hidden]'))continue;
 const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden')continue;
 const rg=document.createRange();rg.selectNodeContents(n);
 for(const r of rg.getClientRects()){
  if(!r.width||!r.height)continue;
  if(r.right>vw+0.5||r.left<-0.5)off.push(t.slice(0,16)+' '+Math.round(r.left)+'..'+Math.round(r.right));
  const ix=Math.min(r.right,ar.right)-Math.max(r.left,ar.left),iy=Math.min(r.bottom,ar.bottom)-Math.max(r.top,ar.top);
  if(ix>2&&iy>2)ovl.push(t.slice(0,16)+' '+Math.round(ix)+'x'+Math.round(iy));
 }
 let p=el;
 while(p&&p!==root){
  const c=getComputedStyle(p);
  if(p.scrollWidth>p.clientWidth+1&&(/hidden|clip/.test(c.overflowX)||c.textOverflow==='ellipsis')){clip.push((p.className||p.tagName)+' '+p.scrollWidth+'>'+p.clientWidth);break}
  p=p.parentElement}
}
const logo=document.querySelector('.top .logo').getBoundingClientRect(),tag=document.querySelector('.top .tag').getBoundingClientRect();
o.tagRow=(tag.top+tag.height/2)>=logo.top&&(tag.top+tag.height/2)<=logo.bottom;
const h1=document.querySelector('.hero h1'),lh=parseFloat(getComputedStyle(h1).lineHeight)||parseFloat(getComputedStyle(h1).fontSize);
o.h1lines=Math.round(h1.getBoundingClientRect().height/lh);
o.cardTop=Math.round(document.querySelector('.perks li').getBoundingClientRect().top);o.vh=innerHeight;
o.off=[...new Set(off)].slice(0,5);o.clip=[...new Set(clip)].slice(0,5);o.ovl=[...new Set(ovl)].slice(0,5);
return o}"""
rows=[];fails=0
with sync_playwright() as p:
  b=p.chromium.launch(executable_path=chrome,args=['--no-sandbox']) if chrome else p.chromium.launch(args=['--no-sandbox'])
  for w in W:
    for z in Z:
      c=b.new_context(viewport={'width':w,'height':(964 if w==434 else 780)},device_scale_factor=2,is_mobile=True,has_touch=True)
      pg=c.new_page();pg.goto('file://'+page);pg.wait_for_timeout(600)
      if z!=1:
        RS="()=>window.dispatchEvent(new Event('resize'))"
        pg.evaluate(ZOOM,z);pg.evaluate(RS);pg.evaluate("()=>window.__apply()");pg.wait_for_timeout(300)
      pg.wait_for_timeout(250)
      r=pg.evaluate(JS);r['w']=w;r['z']=z
      r['pass']=not(r['overflowX'] or r['off'] or r['clip'] or r['ovl'])
      r['pass2']=r['pass'] and r['tagRow'] and r['h1lines']<=3 and r['cardTop']<=r['vh']-120
      if not (r['pass2'] if z<=1.3 else r['pass']):fails+=1
      pg.screenshot(path=os.path.join(out,'fit_%d_%d.png'%(w,int(z*100))))
      rows.append(r);c.close()
  b.close()
for r in rows:
  print('%d x%.2f %s d133=%s tagRow=%s h1lines=%s cardTop=%s/%s fs=%s off=%s clip=%s ovl=%s'%(r['w'],r['z'],'PASS' if (r['pass2'] if r['z']<=1.3 else r['pass']) else 'FAIL',r['pass'],r['tagRow'],r['h1lines'],r['cardTop'],r['vh'],r['fs'],r['off'],r['clip'],r['ovl']))
print('FAILED CASES: %d of %d'%(fails,len(rows)))
json.dump(rows,open(os.path.join(out,'fit_result.json'),'w'),indent=1)
sys.exit(1 if fails else 0)
