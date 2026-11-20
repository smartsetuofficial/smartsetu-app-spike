#!/usr/bin/env python3
# SmartSetu S23-F-1 fit matrix (AI sandbox tool, owner does not run it). ASCII only.
# Usage: python3 fit_matrix.py <path to www/index.html> <out dir> [chrome path]
# Renders the home screen at 6 widths x 4 text-zoom factors and checks the D-133 pass rule:
# (1) no horizontal page overflow, (2) no text outside the screen, (3) no text cut by ellipsis/clip,
# (4) no text overlapping the cart picture (.art). Exit code 1 if any case fails.
# Text zoom is EMULATED: every element computed font-size is multiplied, layout units are not.
# Android WebView textZoom is close to this but NOT identical, so zoom rows are APPROX (V-534).
import sys, json, os
from playwright.sync_api import sync_playwright
W=[320,360,375,393,412,430]; Z=[1,1.15,1.3,1.5]
page=os.path.abspath(sys.argv[1]); out=sys.argv[2]; chrome=sys.argv[3] if len(sys.argv)>3 else None
os.makedirs(out,exist_ok=True)
ZOOM="z=>{const es=[document.documentElement,...document.querySelectorAll('body *')];const v=es.map(e=>parseFloat(getComputedStyle(e).fontSize));es.forEach((e,i)=>e.style.setProperty('font-size',(v[i]*z)+'px','important'))}"
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
o.off=[...new Set(off)].slice(0,5);o.clip=[...new Set(clip)].slice(0,5);o.ovl=[...new Set(ovl)].slice(0,5);
return o}"""
rows=[];fails=0
with sync_playwright() as p:
  b=p.chromium.launch(executable_path=chrome,args=['--no-sandbox']) if chrome else p.chromium.launch(args=['--no-sandbox'])
  for w in W:
    for z in Z:
      c=b.new_context(viewport={'width':w,'height':780},device_scale_factor=2,is_mobile=True,has_touch=True)
      pg=c.new_page();pg.goto('file://'+page);pg.wait_for_timeout(600)
      if z!=1:
        pg.evaluate(ZOOM,z);pg.evaluate("()=>window.dispatchEvent(new Event('resize'))")
      pg.wait_for_timeout(250)
      r=pg.evaluate(JS);r['w']=w;r['z']=z
      r['pass']=not(r['overflowX'] or r['off'] or r['clip'] or r['ovl'])
      if not r['pass']:fails+=1
      pg.screenshot(path=os.path.join(out,'fit_%d_%d.png'%(w,int(z*100))))
      rows.append(r);c.close()
  b.close()
for r in rows:
  print('%d x%.2f %s overflowX=%s off=%s clip=%s overlap=%s'%(r['w'],r['z'],'PASS' if r['pass'] else 'FAIL',r['overflowX'],r['off'],r['clip'],r['ovl']))
print('FAILED CASES: %d of %d'%(fails,len(rows)))
json.dump(rows,open(os.path.join(out,'fit_result.json'),'w'),indent=1)
sys.exit(1 if fails else 0)
